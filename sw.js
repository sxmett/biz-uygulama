importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDzW2RmlLRRCcqouzGSO22leYv59kZjNjc",
  authDomain: "biz-uygulama-d798c.firebaseapp.com",
  databaseURL: "https://biz-uygulama-d798c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "biz-uygulama-d798c",
  storageBucket: "biz-uygulama-d798c.firebasestorage.app",
  messagingSenderId: "672568758665",
  appId: "1:672568758665:web:413a60b0d61426e28dd158"
});

const messaging = firebase.messaging();

function buildNotificationPayload(raw = {}) {
  const data = raw.data || raw || {};
  const notif = raw.notification || {};

  const kind = data.kind || "message";
  const isCall = kind === "voice_call" || kind === "video_call";

  const title =
    data.title ||
    notif.title ||
    (kind === "video_call"
      ? "📹 Görüntülü Arama"
      : kind === "voice_call"
      ? "📞 Sesli Arama"
      : "💬 Yeni Mesaj");

  const body =
    data.body ||
    notif.body ||
    (isCall ? "Seni arıyor, dokun ve yanıtla." : "Yeni bir mesajın var.");

  const url = data.url || "./index.html?tab=sohbet";

  return {
    title,
    options: {
      body,
      icon: data.icon || notif.icon || "./icons/icon-192.png",
      badge: data.badge || "./icons/icon-192.png",
      tag: isCall ? "biz-incoming-call" : `biz-msg-${data.callId || Date.now()}`,
      renotify: true,
      requireInteraction: isCall,
      silent: false,
      vibrate: isCall ? [350, 150, 350, 150, 400] : [160, 70, 160],
      data: {
        url,
        kind,
        callId: data.callId || ""
      }
    }
  };
}

messaging.onBackgroundMessage((payload) => {
  const { title, options } = buildNotificationPayload(payload);
  return self.registration.showNotification(title, options);
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let parsed = {};
  try {
    parsed = event.data.json();
  } catch {
    parsed = { data: { title: "Yeni Bildirim", body: event.data.text() } };
  }

  // Firebase FCM otomatik notification payload gönderdiyse çift bildirim önle
  if (parsed.notification && !parsed.data) {
    return;
  }

  const { title, options } = buildNotificationPayload(parsed);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "./index.html?tab=sohbet";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
