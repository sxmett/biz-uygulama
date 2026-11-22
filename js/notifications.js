import { db, ref, set, push } from "./firebase.js";
import {
  getDeviceRole,
  getPartnerRole,
  requestNotificationPermissionSafe
} from "./state.js";

let activeAlertCallback = null;
let nativeListenersBound = false;

function getCapacitorLocalNotifications() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return null;
    }
    const ln = cap.Plugins?.LocalNotifications;
    if (!ln || typeof ln.schedule !== "function") {
      return null;
    }
    return ln;
  } catch {
    return null;
  }
}

function playIncomingTone(kind = "message") {
  if (!getDeviceRole()) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const isCall = kind === "voice_call" || kind === "video_call";
    const notes = isCall ? [587.33, 783.99, 587.33, 880] : [659.25, 880];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);

      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.13);
    });

    if (navigator.vibrate) {
      navigator.vibrate(isCall ? [200, 100, 200, 100, 250] : [120, 60, 120]);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Sessiz geç
  }
}

export function showInAppAlertBanner({ title, body, kind = "message", onOpen }) {
  if (!getDeviceRole()) return;

  document.getElementById("in-app-alert-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "in-app-alert-banner";
  banner.className = "in-app-alert";
  banner.innerHTML = `
    <div class="in-app-alert-text">
      <div class="in-app-alert-title">${title}</div>
      <div class="in-app-alert-body">${body}</div>
    </div>
    <div class="in-app-alert-actions">
      <button type="button" class="in-app-alert-btn primary" id="alert-open-btn">Aç</button>
      <button type="button" class="in-app-alert-btn" id="alert-dismiss-btn">Kapat</button>
    </div>
  `;

  document.body.appendChild(banner);
  playIncomingTone(kind);

  const dismiss = () => banner.remove();

  document.getElementById("alert-dismiss-btn")?.addEventListener("click", dismiss);
  document.getElementById("alert-open-btn")?.addEventListener("click", () => {
    dismiss();
    if (typeof onOpen === "function") {
      onOpen();
    } else if (typeof activeAlertCallback === "function") {
      activeAlertCallback({ kind, title, body });
    }
  });

  setTimeout(() => {
    if (document.getElementById("in-app-alert-banner") === banner) {
      banner.remove();
    }
  }, 6500);
}

export async function showPhoneNotificationPanel({ title, body, kind = "message", callId = null }) {
  if (!getDeviceRole()) return;
  const isCall = kind === "voice_call" || kind === "video_call";
  const safeTitle =
    title ||
    (kind === "video_call"
      ? "📹 Görüntülü Arama"
      : kind === "voice_call"
      ? "📞 Sesli Arama"
      : "💬 Yeni Mesaj");
  const safeBody = body || (isCall ? "Seni arıyor..." : "Yeni bir mesajın var.");

  const localNotif = getCapacitorLocalNotifications();
  if (localNotif) {
    try {
      await localNotif.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483000),
            title: safeTitle,
            body: safeBody,
            schedule: { at: new Date(Date.now() + 100) },
            sound: isCall ? "beep.wav" : undefined,
            extra: {
              kind,
              callId: callId || "",
              tab: "sohbet"
            }
          }
        ]
      });
      return;
    } catch {
      // Yerel bildirim hatasında sessiz geç
    }
  }

  // Telefon tarayıcısında/PWA'da açıksa ve uygulama görünür değilse uygulama içi/sistem uyarısı
  if (document.visibilityState !== "visible") {
    showInAppAlertBanner({
      title: safeTitle,
      body: safeBody,
      kind,
      onOpen: () => {
        if (typeof activeAlertCallback === "function") {
          activeAlertCallback({ kind, title: safeTitle, body: safeBody, callId });
        }
      }
    });
  }
}

async function enqueuePushToPartner(payload) {
  const myRole = getDeviceRole();
  if (!myRole) return;
  const targetRole = getPartnerRole(myRole);

  try {
    const queueRef = push(ref(db, "biz_room/push_queue"));
    await set(queueRef, {
      targetRole,
      fromRole: myRole,
      kind: payload.kind || "message",
      title: payload.title || "Yeni Bildirim",
      body: payload.body || "",
      callId: payload.callId || "",
      createdAt: Date.now()
    });
  } catch {
    // Sessiz geç
  }
}

export function dispatchNotificationEvent({ kind = "message", title, body, callId = null }) {
  if (!getDeviceRole()) return;

  const payload = {
    kind,
    title,
    body,
    callId,
    ts: Date.now()
  };

  // Sadece karşı tarafa kuyruk yaz (kendine veya Google'a bildirim basma)
  enqueuePushToPartner(payload);
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  activeAlertCallback = onIncomingAlert || null;
  if (!getDeviceRole()) return;

  const localNotif = getCapacitorLocalNotifications();
  if (localNotif) {
    try {
      if (typeof localNotif.checkPermissions === "function" && typeof localNotif.requestPermissions === "function") {
        const perm = await localNotif.checkPermissions();
        if (perm?.display !== "granted") {
          await localNotif.requestPermissions();
        }
      }
    } catch {
      // Sessiz geç
    }

    if (!nativeListenersBound && typeof localNotif.addListener === "function") {
      nativeListenersBound = true;
      localNotif.addListener("localNotificationActionPerformed", (event) => {
        if (!getDeviceRole()) return;
        const extra = event?.notification?.extra || {};
        if (typeof activeAlertCallback === "function") {
          activeAlertCallback({
            kind: extra.kind || "message",
            callId: extra.callId || ""
          });
        }
      });
    }
    return;
  }

  // Tarayıcı ortamındaysa yalnızca izin durumunu kontrol et (Google/Web Push aboneliği açma)
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    await requestNotificationPermissionSafe();
  }
}

export function teardownPushNotifications() {
  activeAlertCallback = null;
  document.getElementById("in-app-alert-banner")?.remove();
}
