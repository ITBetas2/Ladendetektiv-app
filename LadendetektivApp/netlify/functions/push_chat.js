/**
 * Netlify Function: push_chat (optimized)
 * - Faster token loading (select only fcmTokens)
 * - Caches token list in warm function instances (reduces Firestore reads)
 * - Cleans up invalid tokens only for affected users (no 2nd full scan)
 * - Adds high-urgency webpush / high-priority android + apns (where applicable)
 *
 * NOTE: Current token storage is users/{uid}.fcmTokens (map token->true or token->meta).
 *       For even better scale, move tokens to a dedicated collection (see notes below).
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

/** Simple in-memory cache (works on warm Netlify instances). */
let _tokenCache = {
  at: 0,
  ttlMs: 60 * 1000, // refresh every 60s
  // tokens excluding sender are computed per-request; cache stores token->ownerUid
  tokenOwners: new Map(), // token -> uid
};

async function loadTokenOwners(){
  const now = Date.now();
  if(_tokenCache.tokenOwners.size && (now - _tokenCache.at) < _tokenCache.ttlMs){
    return _tokenCache.tokenOwners;
  }

  // Only fetch the field we need to reduce payload
  const snap = await admin.firestore().collection("users").select("fcmTokens").get();

  const map = new Map();
  snap.forEach((d) => {
    const u = d.data() || {};
    const tMap = u.fcmTokens || {};
    for(const token of Object.keys(tMap)){
      map.set(token, d.id);
    }
  });

  _tokenCache = { ..._tokenCache, at: now, tokenOwners: map };
  return map;
}

function chunk(arr, size){
  const out = [];
  for(let i=0; i<arr.length; i+=size) out.push(arr.slice(i, i+size));
  return out;
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

    const tokenOwners = await loadTokenOwners();

    // Build token list excluding sender's tokens
    const tokens = [];
    tokenOwners.forEach((ownerUid, token) => {
      if(ownerUid !== senderUid) tokens.push(token);
    });

    if(tokens.length === 0){
      return { statusCode: 200, body: JSON.stringify({ ok:true, sent:0 }) };
    }

    const title = "Ladendetektiv – Chat";
    const preview = text.length > 140 ? (text.slice(0,137) + "...") : text;
    const body = preview ? `${user || "Jemand"}: ${preview}` : `${user || "Jemand"} hat geschrieben`;

    // FCM limit: max 500 tokens per multicast request
    const groups = chunk(tokens, 500);

    let successCount = 0;
    const invalidByOwner = new Map(); // ownerUid -> Set(tokens)

    for(const group of groups){
      const res = await admin.messaging().sendEachForMulticast({
        tokens: group,
        notification: { title, body },
        data: { roomId: String(roomId || "global") },

        // Best-effort: request faster delivery
        android: { priority: "high" },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default" } }
        },
        webpush: {
          headers: {
            // "high" isn't a standard for WebPush; use Urgency
            "Urgency": "high",
            // Reduce caching
            "TTL": "60"
          }
        }
      });

      successCount += (res.successCount || 0);

      // Collect invalid tokens for targeted cleanup
      res.responses.forEach((r, i) => {
        if(!r.success){
          const code = r.error?.code || "";
          if(code.includes("registration-token-not-registered") || code.includes("invalid-argument")){
            const token = group[i];
            const ownerUid = tokenOwners.get(token);
            if(ownerUid){
              if(!invalidByOwner.has(ownerUid)) invalidByOwner.set(ownerUid, new Set());
              invalidByOwner.get(ownerUid).add(token);
            }
          }
        }
      });
    }

    // Cleanup invalid tokens (only affected users)
    if(invalidByOwner.size){
      const batch = admin.firestore().batch();
      for(const [ownerUid, setTokens] of invalidByOwner.entries()){
        const ref = admin.firestore().collection("users").doc(ownerUid);
        const docSnap = await ref.get();
        const data = docSnap.data() || {};
        const tMap = data.fcmTokens || {};
        let changed = false;
        setTokens.forEach((tok)=>{
          if(tMap[tok] !== undefined){
            delete tMap[tok];
            changed = true;
          }
          // also remove from cache
          tokenOwners.delete(tok);
          _tokenCache.tokenOwners.delete(tok);
        });
        if(changed){
          batch.set(ref, { fcmTokens: tMap }, { merge:true });
        }
      }
      await batch.commit();
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, sent: successCount }) };
  }catch(e){
    console.error(e);
    return { statusCode: 500, body: "Error: " + (e?.message || e) };
  }
};
