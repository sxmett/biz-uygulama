import { db, ref, set, onValue } from "./firebase.js";
import { getDeviceRole, getPartnerRole } from "./state.js";

// Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates
export const VAPID_PUBLIC_KEY = "BPkDBt0hY4a7NfX8i-anz8C9Lc6F_jv1kNya-5kGI1n982zn09LQnZabrHqZXJArosWpCeNWIVp8vq6C5YsXQXg";

let alertBannerTimer = null;

export function showInAppAlertBanner({ kind = "message", title = "", body = "", onOpen = null }) {
  document.getElementById("biz-live-alert-banner")?.remove();
  if (alertBannerTimer) {
    clearTimeout(alertBannerTimer);
    alertBannerTimer = null;
  }

  const isCall = kind === "voice_call" || kind === "video_call";
  const badgeText =
    kind === "video_call"
      ? "GÖRÜNTÜLÜ ARAMA"
      : kind === "voice_call"
      ? "SESLİ ARAMA"
      : "YENİ MESAJ";

  const banner = document.createElement("div");
  banner.id = "biz-live-alert-banner";
  banner.style.cssText = `
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    width: min(92vw, 430px);
    z-index: 100000;
    background: rgba(22, 20, 26, 0.96);
    border: 1px solid rgba(230, 46, 101, 0.55);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    border-radius: 16px;
    padding: 13px 14px;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
  `;

  banner.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="
          font-size:10.5px;
          font-weight:700;
          letter-spacing:0.4px;
          background:#e62e65;
          color:#fff;
          padding:2px 8px;
          border-radius:999px;
        ">${badgeText}</span>
        <strong style="font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</strong>
      </div>
      <span style="
        font-size:12.5px;
        color:#e6dce2;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      ">${body}</span>
    </div>
    <button type="button" id="biz-alert-dismiss" style="
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      color: #fff;
      border-radius: 10px;
      height: 32px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
    ">Kapat</button>
  `;

  document.body.appendChild(banner);

  const dismiss = () => {
    if (alertBannerTimer) {
      clearTimeout(alertBannerTimer);
      alertBannerTimer = null;
    }
    banner.remove();
  };

  banner.addEventListener("click", (e) => {
    if (e.target.closest("#biz-alert-dismiss")) {
      dismiss();
      return;
    }
    dismiss();
    onOpen?.();
  });

  document.getElementById("biz-alert-dismiss")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  alertBannerTimer = setTimeout(dismiss, isCall ? 12000 : 5000);
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  let swRegistration = null;

  try {
    if ("serviceWorker" in navigator) {
      swRegistration = await navigator.serviceWorker.register("/sw.js");
    }
  } catch {
    // Service worker kayıt hatası sessiz geçilir
  }

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    // İzin penceresi engellenirse sessiz geçilir
  }

  try {
    const firebaseAppMod = await import("./firebase.js");
    const messagingMod = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js"
    );

    if (
      firebaseAppMod.app &&
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
        }).catch(() => {});
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
  } catch {
    // Messaging henüz yapılandırılmadıysa uygulama akışı etkilenmez
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

export async function dispatchNotificationEvent({ kind, title, body, callId = null }) {
  const senderRole = getDeviceRole() || "userA";
  const targetRole = getPartnerRole(senderRole);
  const eventId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await set(ref(db, `biz_room/push_queue/${eventId}`), {
    id: eventId,
    senderRole,
    targetRole,
    kind, // "message" | "voice_call" | "video_call"
    title,
    body,
    callId,
    createdAt: Date.now()
  }).catch(() => {});
}
