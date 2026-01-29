/* Firebase Messaging Service Worker
   Must be served from site root: /firebase-messaging-sw.js
*/
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAU-gtZxzBOCIDYrqQ82Su8qslcWAcOE9o",
  authDomain: "ladendetektiv-app.firebaseapp.com",
  projectId: "ladendetektiv-app",
  storageBucket: "ladendetektiv-app.firebasestorage.app",
  messagingSenderId: "1039057164732",
  appId: "1:1039057164732:web:0c7907a83bdbe21e95b3b9"
});

const messaging = firebase.messaging();

// Background push handler (FCM)
// Works best with data-only messages (payload.data)
messaging.onBackgroundMessage((payload) => {
  const d = payload?.data || {};
  const title = payload?.notification?.title || d.title || "Projekt TAS – Chat";
  const body = payload?.notification?.body || d.body || "Neue Nachricht";
  const icon = payload?.notification?.icon || d.icon || "/icons/icon-192x192.png";

  const link = d.link || "/";
  const tag = d.roomId ? `chat-${d.roomId}` : "chat";

  self.registration.showNotification(title, {
    body,
    icon,
    badge: "/icons/icon-192x192.png",
    tag,
    renotify: true,
    data: {
      ...d,
      link
    }
  });
});

// Click -> focus/open app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = (event.notification?.data && event.notification.data.link) ? event.notification.data.link : "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url && client.url.includes(self.location.origin) && "focus" in client) {
        await client.focus();
        try{ await client.navigate(urlToOpen); }catch(_e){}
        return;
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(urlToOpen);
    }
  })());
});
