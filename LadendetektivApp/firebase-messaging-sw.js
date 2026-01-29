/* Firebase Messaging Service Worker
   Must be served from site root: /firebase-messaging-sw.js
*/
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

const messaging = firebase.messaging();

// Background push handler
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Projekt TAS – Chat";
  const body = payload?.notification?.body || "Neue Nachricht";
  const icon = payload?.notification?.icon || "/icons/icon-192x192.png";
  const data = payload?.data || {};

  self.registration.showNotification(title, {
    body,
    icon,
    badge: "/icons/icon-192x192.png",
    data
  });
});

// Click -> focus/open app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        client.focus();
        client.navigate(urlToOpen);
        return;
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(urlToOpen);
    }
  })());
});
