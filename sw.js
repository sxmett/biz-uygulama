self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Yeni Bildirim", body: event.data.text() };
  }

  const kind = payload.kind || "message"; // "message" | "voice_call" | "video_call"
  const isCall = kind === "voice_call" || kind === "video_call";
  const title =
    payload.title ||
    (kind === "video_call"
      ? "Görüntülü Arama"
      : kind === "voice_call"
      ? "Sesli Arama"
      : "Yeni Mesaj");
  const body = payload.body || "";

  const options = {
    body,
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/badge-72.png",
    tag: isCall ? "biz-incoming-call" : `biz-msg-${payload.id || Date.now()}`,
    renotify: true,
    requireInteraction: isCall,
    vibrate: isCall ? [300, 150, 300, 150, 300] : [120, 60, 120],
    data: {
      url: payload.url || "/",
      kind,
      callId: payload.callId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

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