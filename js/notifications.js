import { getDeviceRole, requestNotificationPermissionSafe } from "./state.js";

const SW_REGISTRATION_TIMEOUT_MS = 3500;
const PUSH_SERVER_ENDPOINT = "/api/push/send";

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

async function triggerSystemNotification({ title, body, tag, data }) {
  if (!getDeviceRole()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }

  try {
    if ("serviceWorker" in navigator) {
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration(),
        SW_REGISTRATION_TIMEOUT_MS,
        null
      );
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(title, {
          body,
          tag: tag || "biz-app-alert",
          renotify: true,
          data: data || {}
        });
        return;
      }
    }
  } catch {
    // Fallback olarak doğrudan Notification API kullan
  }

  try {
    const n = new Notification(title, {
      body,
      tag: tag || "biz-app-alert"
    });
    n.onclick = () => {
      window.focus();
      if (typeof activeAlertCallback === "function") {
        activeAlertCallback(data || {});
      }
      n.close();
    };
  } catch {
    // Sessiz geç
  }
}

async function sendBackgroundPushToServer(payload) {
  if (!getDeviceRole()) return;
  try {
    await withTimeout(
      fetch(PUSH_SERVER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }),
      2500,
      null
    );
  } catch {
    // Sunucu endpointi yoksa sessiz geç
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

  sendBackgroundPushToServer(payload);

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
  } else {
    triggerSystemNotification({
      title,
      body,
      tag: kind === "message" ? "biz-chat-msg" : `biz-call-${callId || Date.now()}`,
      data: payload
    });
  }
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  activeAlertCallback = onIncomingAlert || null;
  if (!getDeviceRole()) return;

  if (!pushSetupDone) {
    pushSetupDone = true;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (!getDeviceRole()) return;
        const msg = event.data;
        if (msg && msg.type === "PUSH_CLICK" && typeof activeAlertCallback === "function") {
          activeAlertCallback(msg.payload || {});
        }
      });
    }
  }

  if (isSecurePushContext() && typeof Notification !== "undefined") {
    if (Notification.permission === "default") {
      await requestNotificationPermissionSafe();
    }
  }
}

export function teardownPushNotifications() {
  activeAlertCallback = null;
  document.getElementById("in-app-alert-banner")?.remove();
}
