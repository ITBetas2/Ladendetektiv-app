/* Firebase Messaging Service Worker
 * MUST be served at: /firebase-messaging-sw.js
 * Works with FCM + also contains a generic push fallback.
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Generic fallback (shows notifications for any Push payload)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch (_) {}
  }

  const title = (data.notification && data.notification.title) || data.title || (data.data && data.data.title) || "Neue Nachricht";
  const body  = (data.notification && data.notification.body)  || data.body  || (data.data && data.data.body)  || "";
  const link  = (data.fcmOptions && data.fcmOptions.link) || (data.data && data.data.link) || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = (event.notification && event.notification.data && event.notification.data.link) ? event.notification.data.link : "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        try { await client.navigate(urlToOpen); } catch (_) {}
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(urlToOpen);
  })());
});

// Try to load Firebase compat libs for proper onBackgroundMessage support.
// If blocked/offline, generic 'push' handler above will still show notifications for incoming pushes.
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  firebase.initializeApp({"apiKey": "AIzaSyAU-gtZxzBOCIDYrqQ82Su8qslcWAcOE9o", "authDomain": "ladendetektiv-app.firebaseapp.com", "projectId": "ladendetektiv-app", "storageBucket": "ladendetektiv-app.firebasestorage.app", "messagingSenderId": "1039057164732", "appId": "1:1039057164732:web:0c7907a83bdbe21e95b3b9"});

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload && payload.data && payload.data.title) || (payload.notification && payload.notification.title) || "Neue Nachricht";
    const body  = (payload && payload.data && payload.data.body)  || (payload.notification && payload.notification.body)  || "";
    const link  = (payload && payload.data && payload.data.link)  || "/";

    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link }
    });
  });
} catch (e) {
  // ignore - fallback push handler remains active
}
