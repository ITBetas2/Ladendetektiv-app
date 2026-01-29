// Firebase Messaging Service Worker (robust CDN import + notification display)
// NOTE: this file MUST be served at /firebase-messaging-sw.js (site root)

(function(){
  function tryImport(url){
    try { importScripts(url); return true; } catch(e) { return false; }
  }

  // Try multiple known-good Firebase CDN versions (some networks/blockers fail specific versions)
  var ok =
    tryImport("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js") &&
    tryImport("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  if(!ok){
    // fallback
    ok =
      tryImport("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js") &&
      tryImport("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
  }

  if(!ok){
    // last resort older major
    ok =
      tryImport("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js") &&
      tryImport("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");
  }

  if(!ok){
    // Without Firebase libs, we can't use messaging.onBackgroundMessage.
    // We still keep a generic push listener as fallback for Web Push payloads.
    self.addEventListener("push", function(event){
      var data = {};
      try { data = event.data ? event.data.json() : {}; } catch(e) {}
      var title = (data.notification && data.notification.title) || data.title || "Neue Nachricht";
      var body  = (data.notification && data.notification.body)  || data.body  || "";
      event.waitUntil(self.registration.showNotification(title, {
        body: body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { link: "/" }
      }));
    });
    return;
  }

  // >>> Fill in your Firebase config (same as in index.html)
  firebase.initializeApp({
    apiKey: "AIzaSyAU-gtZxzBOCIDYrqQ82Su8qslcWAcOE9o",
  authDomain: "ladendetektiv-app.firebaseapp.com",
  projectId: "ladendetektiv-app",
  storageBucket: "ladendetektiv-app.firebasestorage.app",
  messagingSenderId: "1039057164732",
  appId: "1:1039057164732:web:0c7907a83bdbe21e95b3b9"
}};

  var messaging = firebase.messaging();

  messaging.onBackgroundMessage(function(payload){
    // Prefer data payload (our netlify function sends data)
    var title = (payload && payload.data && payload.data.title) || (payload.notification && payload.notification.title) || "Neue Nachricht";
    var body  = (payload && payload.data && payload.data.body)  || (payload.notification && payload.notification.body)  || "";
    var link  = (payload && payload.data && payload.data.link)  || "/";

    self.registration.showNotification(title, {
      body: body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: link }
    });
  });

  self.addEventListener("notificationclick", function(event){
    event.notification.close();
    var urlToOpen = (event.notification && event.notification.data && event.notification.data.link) ? event.notification.data.link : "/";
    event.waitUntil((async function(){
      var allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (var i=0;i<allClients.length;i++){
        var client = allClients[i];
        if (client.url && "focus" in client){
          try { await client.navigate(urlToOpen); } catch(e) {}
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })());
  });
})();
