/* Firebase Messaging Service Worker (Netlify root: /firebase-messaging-sw.js)
   - Robust: works even if firebase importScripts fails
   - Shows notifications for BOTH:
     (a) FCM "data-only" messages (recommended)
     (b) plain Web Push payloads
*/

let _messaging = null;

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  firebase.initializeApp({
  "apiKey": "AIzaSyAU-gtZxzBOCIDYrqQ82Su8qslcWAcOE9o",
  "authDomain": "ladendetektiv-app.firebaseapp.com",
  "projectId": "ladendetektiv-app",
  "storageBucket": "ladendetektiv-app.firebasestorage.app",
  "messagingSenderId": "1039057164732",
  "appId": "1:1039057164732:web:0c7907a83bdbe21e95b3b9"
});
  _messaging = firebase.messaging();

  // FCM background handler (when Firebase libs loaded)
  _messaging.onBackgroundMessage((payload) => {
    try {
      const d = (payload && payload.data) ? payload.data : {};
      const title = d.title || "Neue Nachricht";
      const options = {
        body: d.body || "",
        icon: d.icon || "/icons/icon-192.png",
        badge: d.badge || "/icons/badge-96.png",
        data: { link: d.link || "/#chat", roomId: d.roomId || "global" },
        tag: "chat-" + String(d.roomId || "global"),
        renotify: true
      };
      self.registration.showNotification(title, options);
    } catch(e) {}
  });
} catch (e) {
  // If Firebase libraries can't be loaded, we still handle Push via the 'push' event below.
}

// Generic push handler (works for FCM data messages too)
self.addEventListener("push", (event) => {
  // Avoid duplicate notifications: when Firebase Messaging is available,
  // onBackgroundMessage() already calls showNotification().
  if (_messaging) { return; }
  try {
    const data = event.data ? event.data.json() : {};

    // FCM sometimes nests data in different shapes
    const d = data.data || data || {};
    const title = d.title || (data.notification && data.notification.title) || "Neue Nachricht";
    const body  = d.body  || (data.notification && data.notification.body)  || "";

    const options = {
      body,
      icon: d.icon || "/icons/icon-192.png",
      badge: d.badge || "/icons/badge-96.png",
      data: { link: d.link || "/#chat", roomId: d.roomId || "global" },
      tag: "chat-" + String(d.roomId || "global"),
      renotify: true
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // ignore
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification && event.notification.data && event.notification.data.link) ? event.notification.data.link : "/#chat";

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of allClients) {
      // Focus existing tab if possible
      if ("focus" in c) {
        try {
          await c.focus();
          // Try to navigate
          if ("navigate" in c) await c.navigate(link);
          return;
        } catch(e) {}
      }
    }
    // Otherwise open new
    if (clients.openWindow) {
      await clients.openWindow(link);
    }
  })());
});
