import {
  db,
  ref,
  set,
  push,
  getMessaging,
  getToken,
  onMessage
} from "./firebase.js";
import {
  getDeviceRole,
  getPartnerRole,
  requestNotificationPermissionSafe
} from "./state.js";

const SW_REGISTRATION_TIMEOUT_MS = 4000;
const VAPID_PUBLIC_KEY = "BPkDBt0hY4a7NfX8i-anz8C9Lc6F_jv1kNya-5kGI1n982zn09LQnZabrHqZXJArosWpCeNWIVp8vq6C5YsXQXg";

let activeAlertCallback = null;
let pushSetupDone = false;

function isSecurePushContext() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    window.isSecureContext ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

function withTimeout(promise, ms, fallbackValue = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallbackValue);
      }
    }, ms);

    promise
      .then((res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallbackValue);
        }
      });
  });
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
    // Ses çalma engellenirse sessiz geç
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

async function registerSwAndSaveToken() {
  const myRole = getDeviceRole();
  if (!myRole || !isSecurePushContext() || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const reg = await withTimeout(
      navigator.serviceWorker.register("./sw.js", { scope: "./" }),
      SW_REGISTRATION_TIMEOUT_MS,
      null
    );
    if (!reg) return;

    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }

    const messaging = getMessaging();
    if (!messaging || !VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("BURAYA_")) {
      return;
    }

    const token = await withTimeout(
      getToken(messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: reg
      }),
      SW_REGISTRATION_TIMEOUT_MS,
      null
    );

    if (token) {
      await set(ref(db, `biz_room/push_tokens/${myRole}`), {
        token,
        updatedAt: Date.now()
      });
    }
  } catch {
    // Sessiz geç
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

  // Worker'ın dinlediği kuyruğa push isteği gönder
  enqueuePushToPartner(payload);

  const appVisible = document.visibilityState === "visible" && document.hasFocus();
  if (appVisible) {
    showInAppAlertBanner({
      title,
      body,
      kind,
      onOpen: () => {
        if (typeof activeAlertCallback === "function") {
          activeAlertCallback(payload);
        }
      }
    });
  }
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  activeAlertCallback = onIncomingAlert || null;
  if (!getDeviceRole()) return;

  if (isSecurePushContext() && typeof Notification !== "undefined") {
    if (Notification.permission === "default") {
      await requestNotificationPermissionSafe();
    }
  }

  await registerSwAndSaveToken();

  if (!pushSetupDone) {
    pushSetupDone = true;

    try {
      const messaging = getMessaging();
      onMessage(messaging, (payload) => {
        if (!getDeviceRole()) return;
        const data = payload.data || {};
        const notif = payload.notification || {};
        const title = data.title || notif.title || "Yeni Bildirim";
        const body = data.body || notif.body || "";
        const kind = data.kind || "message";

        showInAppAlertBanner({
          title,
          body,
          kind,
          onOpen: () => {
            if (typeof activeAlertCallback === "function") {
              activeAlertCallback({ kind, title, body, callId: data.callId || "" });
            }
          }
        });
      });
    } catch {
      // Sessiz geç
    }
  }
}

export function teardownPushNotifications() {
  activeAlertCallback = null;
  document.getElementById("in-app-alert-banner")?.remove();
}
