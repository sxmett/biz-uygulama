import { db, ref, set, onValue } from "./firebase.js";
import { getDeviceRole } from "./state.js";

export const VAPID_PUBLIC_KEY =
  "BPkDBt0hY4a7NfX8i-anz8C9Lc6F_jv1kNya-5kGI1n982zn09LqnZabrHqZXJArosWpCeNWIVp8vq6C5YsQXg";

function showInAppAlertBanner({ kind, title, body, onOpen }) {
  document.getElementById("in-app-alert-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "in-app-alert-banner";
  const isCall = kind === "voice_call" || kind === "video_call";

  banner.style.cssText = `
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    width: calc(100% - 28px);
    max-width: 420px;
    z-index: 10000;
    background: ${isCall ? "linear-gradient(135deg, #1f2937, #111827)" : "#ffffff"};
    color: ${isCall ? "#ffffff" : "#1c191d"};
    border: 1px solid ${isCall ? "rgba(255,255,255,0.16)" : "rgba(230,46,101,0.25)"};
    border-radius: 18px;
    padding: 14px 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
    font-family: inherit;
  `;

  banner.innerHTML = `
    <div style="min-width:0;flex:1;">
      <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${title || "Yeni Bildirim"}</div>
      <div style="font-size:12.5px;opacity:0.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${body || ""}</div>
    </div>
    <button type="button" id="close-in-app-alert" style="
      border:none;
      background:${isCall ? "rgba(255,255,255,0.14)" : "#fff0f5"};
      color:${isCall ? "#ffffff" : "#d61c4e"};
      border-radius:10px;
      padding:6px 10px;
      font-weight:700;
      cursor:pointer;
    ">Kapat</button>
  `;

  document.body.appendChild(banner);

  const timer = setTimeout(() => {
    banner.remove();
  }, isCall ? 15000 : 5000);

  banner.addEventListener("click", (e) => {
    if (e.target?.id === "close-in-app-alert") {
      clearTimeout(timer);
      banner.remove();
      return;
    }
    clearTimeout(timer);
    banner.remove();
    onOpen?.();
  });
}

export async function dispatchNotificationEvent({ kind = "message", title = "", body = "", callId = "" }) {
  const senderRole = getDeviceRole() || "userA";
  const targetRole = senderRole === "userA" ? "userB" : "userA";
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    await set(ref(db, `biz_room/push_queue/${id}`), {
      id,
      senderRole,
      targetRole,
      kind,
      title,
      body,
      callId,
      createdAt: Date.now()
    });
  } catch (err) {
    console.warn("Push kuyruğuna yazılamadı:", err);
  }
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  let swRegistration = null;

  try {
    if ("serviceWorker" in navigator) {
      swRegistration = await navigator.serviceWorker.register("/sw.js");
    }
  } catch (err) {
    console.warn("Service Worker kaydı yapılamadı:", err);
  }

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (err) {
    console.warn("Bildirim izni alınamadı:", err);
  }

  try {
    const firebaseAppMod = await import("./firebase.js");
    const messagingMod = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js"
    );

    const supported =
      firebaseAppMod.app &&
      typeof messagingMod.isSupported === "function" &&
      (await messagingMod.isSupported());

    if (
      supported &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      VAPID_PUBLIC_KEY &&
      !VAPID_PUBLIC_KEY.startsWith("BURAYA_")
    ) {
      const messaging = messagingMod.getMessaging(firebaseAppMod.app);
      const token = await messagingMod.getToken(messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: swRegistration || undefined
      });

      const myRole = getDeviceRole() || "userA";
      if (token) {
        await set(ref(db, `biz_room/push_tokens/${myRole}`), {
          token,
          updatedAt: Date.now()
        });
      }

      messagingMod.onMessage(messaging, (payload) => {
        const data = payload?.data || {};
        const kind = data.kind || "message";
        const title = payload?.notification?.title || data.title || "Yeni Bildirim";
        const body = payload?.notification?.body || data.body || "";

        if (document.visibilityState === "visible") {
          showInAppAlertBanner({
            kind,
            title,
            body,
            onOpen: () => onIncomingAlert?.(kind, data)
          });
        } else if (swRegistration?.showNotification) {
          swRegistration.showNotification(title, {
            body,
            tag: kind.includes("call") ? "biz-incoming-call" : `biz-fg-${Date.now()}`,
            renotify: true,
            requireInteraction: kind.includes("call"),
            data: { url: "/" }
          });
        }
      });
    }
  } catch (err) {
    console.warn("FCM bu ortamda desteklenmiyor veya atlandı:", err);
  }

  const myRole = getDeviceRole() || "userA";
  const seenIds = new Set();
  const bootTime = Date.now();

  onValue(ref(db, "biz_room/push_queue"), (snapshot) => {
    const val = snapshot.val();
    if (!val || typeof val !== "object") return;

    Object.values(val).forEach((item) => {
      if (!item || typeof item !== "object" || !item.id) return;
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);

      if (item.targetRole !== myRole) return;
      if (Number(item.createdAt || 0) < bootTime - 2000) return;

      if (document.visibilityState === "visible") {
        showInAppAlertBanner({
          kind: item.kind || "message",
          title: item.title || "Yeni Bildirim",
          body: item.body || "",
          onOpen: () => onIncomingAlert?.(item.kind, item)
        });
      }
    });
  });
}
