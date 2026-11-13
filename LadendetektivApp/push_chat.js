/**
 * Netlify Function: push_chat
 * Sends an FCM push notification to ALL users with tokens in Firestore: users/{uid}.fcmTokens
 * Excludes the sender (based on verified Firebase ID token + uid).
 *
 * Setup on Netlify:
 * 1) Add Environment Variable: FIREBASE_SERVICE_ACCOUNT_JSON  (paste full service account JSON)
 *    - Firebase Console -> Project settings -> Service accounts -> Generate new private key
 * 2) Deploy this file at: netlify/functions/push_chat.js
 */

const admin = require("firebase-admin");

let _inited = false;
function initAdmin(){
  if(_inited) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON env var");
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  _inited = true;
}

exports.handler = async (event) => {
  try{
    initAdmin();

    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Verify caller (prevents anonymous abuse)
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if(!m){
      return { statusCode: 401, body: "Missing Authorization" };
    }

    const decoded = await admin.auth().verifyIdToken(m[1]);
    const senderUid = decoded.uid;

    const { roomId, text, user, uid } = JSON.parse(event.body || "{}");
    if(!text || typeof text !== "string"){
      return { statusCode: 400, body: "Missing text" };
    }

    // sender uid must match token uid (simple integrity check)
    if(uid && uid !== senderUid){
      return { statusCode: 403, body: "UID mismatch" };
    }

    // Collect all tokens
    const usersSnap = await admin.firestore().collection("users").get();
    let tokens = [];
    let senderTokens = new Set();

    usersSnap.forEach((d) => {
      const u = d.data() || {};
      const tMap = u.fcmTokens || {};
      const tList = Object.keys(tMap);
      if(d.id === senderUid){
        tList.forEach((t)=> senderTokens.add(t));
      } else {
        tokens.push(...tList);
      }
    });

    tokens = tokens.filter(t => !senderTokens.has(t));
    tokens = [...new Set(tokens)];
    if(tokens.length === 0){
      return { statusCode: 200, body: JSON.stringify({ ok:true, sent:0 }) };
    }

    const title = "Ladendetektiv – Chat";
    const preview = text.length > 140 ? (text.slice(0,137) + "...") : text;
    const body = preview ? `${user || "Jemand"}: ${preview}` : `${user || "Jemand"} hat geschrieben`;

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
        // DATA-ONLY: notification rendered in SW
data: { roomId: String(roomId || "global"), title: title, body: body, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", link: "/#chat" }
    });

    // Cleanup invalid tokens
    const invalid = [];
    res.responses.forEach((r, i) => {
      if(!r.success){
        const code = r.error?.code || "";
        if(code.includes("registration-token-not-registered") || code.includes("invalid-argument")){
          invalid.push(tokens[i]);
        }
      }
    });

    if(invalid.length){
      const invalidSet = new Set(invalid);
      const batch = admin.firestore().batch();
      usersSnap.forEach((d) => {
        const u = d.data() || {};
        const tMap = u.fcmTokens || {};
        let changed = false;
        for(const bad of invalidSet){
          if(tMap[bad]){
            delete tMap[bad];
            changed = true;
          }
        }
        if(changed) batch.set(d.ref, { fcmTokens: tMap }, { merge:true });
      });
      await batch.commit();
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, sent: res.successCount || 0 }) };
  }catch(e){
    console.error(e);
    return { statusCode: 500, body: "Error: " + (e?.message || e) };
  }
};
