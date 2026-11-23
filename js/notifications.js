import { db, ref, set, push } from "./firebase.js";
import {
  getDeviceRole,
  getPartnerRole,
  requestNotificationPermissionSafe
} from "./state.js";

let activeAlertCallback = null;
let nativeListenersBound = false;
let currentFcmToken = null;

function getCapacitor() {
  return typeof window !== "undefined" ? window.Capacitor || null : null;
}

function isNativeAndroid() {
  const cap = getCapacitor();
  return Boolean(
    cap &&
      typeof cap.isNativePlatform === "function" &&
      cap.isNativePlatform() &&
      typeof cap.getPlatform === "function" &&
      cap.getPlatform() === "android"
  );
}

function getCapacitorLocalNotifications() {
  try {
    const cap = getCapacitor();
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

function getCapacitorPushNotifications() {
  try {
    const cap = getCapacitor();
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return null;
    }
    return cap.Plugins?.PushNotifications || null;
  } catch {
    return null;
  }
}

export async function savePushTokenToDb(token) {
  const myRole = getDeviceRole();
  if (!myRole || !token || typeof token !== "string") return;
  currentFcmToken = token.trim();
  if (!currentFcmToken) return;

  try {
    await set(ref(db, `biz_room/push_tokens/${myRole}`), {
      token: currentFcmToken,
      role: myRole,
      platform: "android",
      updatedAt: Date.now()
    });
  } catch {
    // Sessiz geç
  }
}

async function ensureAndroidNotificationChannels(localNotif, pushNotif) {
  const channels = [
    {
      id: "biz_messages_channel",
      name: "Mesajlar",
      description: "Yeni sohbet mesajı bildirimleri",
      importance: 4, // HIGH
      visibility: 1,
      vibration: true
    },
    {
      id: "biz_calls_channel",
      name: "Sesli ve Görüntülü Aramalar",
      description: "Gelen arama bildirimleri",
      importance: 5, // MAX
      visibility: 1,
      vibration: true
    }
  ];

  for (const ch of channels) {
    if (localNotif && typeof localNotif.createChannel === "function") {
      try {
        await localNotif.createChannel(ch);
      } catch {
        // Kanal zaten varsa geç
      }
    }
    if (pushNotif && typeof pushNotif.createChannel === "function") {
      try {
        await pushNotif.createChannel(ch);
      } catch {
        // Kanal zaten varsa geç
      }
    }
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
      navigator.vibrate(isCall ? [300, 120, 300, 120, 350] : [140, 60, 140]);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 950);
  } catch {
    // Sessiz geç
  }
}

export function showInAppAlertBanner({ title, body, kind = "message", callId = null, onOpen }) {
  if (!getDeviceRole()) return;

  document.getElementById("in-app-alert-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "in-app-alert-banner";
  banner.className = "in-app-alert";
  banner.style.cssText = `
    position: fixed;
    top: 14px;
    left: 14px;
    right: 14px;
    z-index: 99998;
    background: #ffffff;
    border: 1px solid #f0dce2;
    border-left: 4px solid #e11d48;
    border-radius: 16px;
    padding: 12px 14px;
    box-shadow: 0 14px 32px rgba(24, 16, 24, 0.18);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  `;

  banner.innerHTML = `
    <div style="min-width:0;flex:1;">
      <div style="font-weight:800;font-size:0.9rem;color:#22222b;">${title}</div>
      <div style="font-size:0.82rem;color:#6e7180;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${body}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button type="button" class="mini-btn" id="alert-open-btn" style="background:#e11d48;color:#fff;border-color:#e11d48;">Aç</button>
      <button type="button" class="mini-btn" id="alert-dismiss-btn">Kapat</button>
    </div>
  `;

  document.body.appendChild(banner);
  playIncomingTone(kind);

  const dismiss = () => banner.remove();

  document.getElementById("alert-dismiss-btn")?.addEventListener("click", dismiss);
  document.getElementById("alert-open-btn")?.addEventListener("click", () => {
    dismiss();
    if (typeof onOpen === "function") {
      onOpen({ kind, title, body, callId });
    } else if (typeof activeAlertCallback === "function") {
      activeAlertCallback({ kind, title, body, callId });
    }
  });

  setTimeout(() => {
    if (document.getElementById("in-app-alert-banner") === banner) {
      banner.remove();
    }
  }, 7000);
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

  // Uygulama ön planda görünürse uygulama içi banner + ses/titreşim ver
  if (document.visibilityState === "visible") {
    showInAppAlertBanner({
      title: safeTitle,
      body: safeBody,
      kind,
      callId,
      onOpen: (info) => {
        if (typeof activeAlertCallback === "function") {
          activeAlertCallback(info);
        }
      }
    });
    return;
  }

  const localNotif = getCapacitorLocalNotifications();
  if (localNotif) {
    try {
      await ensureAndroidNotificationChannels(localNotif, null);
      await localNotif.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483000),
            title: safeTitle,
            body: safeBody,
            channelId: isCall ? "biz_calls_channel" : "biz_messages_channel",
            schedule: { at: new Date(Date.now() + 100) },
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
      // Sessiz geç
    }
  }

  showInAppAlertBanner({
    title: safeTitle,
    body: safeBody,
    kind,
    callId,
    onOpen: (info) => {
      if (typeof activeAlertCallback === "function") {
        activeAlertCallback(info);
      }
    }
  });
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

  enqueuePushToPartner({
    kind,
    title,
    body,
    callId,
    ts: Date.now()
  });
}

export async function setupPushNotifications({ onIncomingAlert } = {}) {
  activeAlertCallback = onIncomingAlert || null;
  if (!getDeviceRole()) return;

  const localNotif = getCapacitorLocalNotifications();
  const pushNotif = getCapacitorPushNotifications();

  if (isNativeAndroid()) {
    await ensureAndroidNotificationChannels(localNotif, pushNotif);
  }

  if (pushNotif) {
    try {
      if (typeof pushNotif.checkPermissions === "function" && typeof pushNotif.requestPermissions === "function") {
        const perm = await pushNotif.checkPermissions();
        if (perm?.receive !== "granted") {
          await pushNotif.requestPermissions();
        }
      }

      if (!nativeListenersBound && typeof pushNotif.addListener === "function") {
        nativeListenersBound = true;

        pushNotif.addListener("registration", async (tokenObj) => {
          const tokenValue = tokenObj?.value || tokenObj?.token || "";
          if (tokenValue) {
            await savePushTokenToDb(tokenValue);
          }
        });

        pushNotif.addListener("registrationError", () => {
          // Sessiz geç
        });

        pushNotif.addListener("pushNotificationReceived", async (notification) => {
          if (!getDeviceRole()) return;
          const data = notification?.data || {};
          const kind = data.kind || "message";
          const title = notification?.title || data.title || "Yeni Bildirim";
          const body = notification?.body || data.body || "";
          const callId = data.callId || null;

          if (document.visibilityState === "visible") {
            showInAppAlertBanner({
              title,
              body,
              kind,
              callId,
              onOpen: (info) => activeAlertCallback?.(info)
            });
          } else if (localNotif) {
            const isCall = kind === "voice_call" || kind === "video_call";
            try {
              await localNotif.schedule({
                notifications: [
                  {
                    id: Math.floor(Date.now() % 2147483000),
                    title,
                    body,
                    channelId: isCall ? "biz_calls_channel" : "biz_messages_channel",
                    schedule: { at: new Date(Date.now() + 100) },
                    extra: { kind, callId: callId || "", tab: "sohbet" }
                  }
                ]
              });
            } catch {
              // Sessiz geç
            }
          }
        });

        pushNotif.addListener("pushNotificationActionPerformed", (event) => {
          if (!getDeviceRole()) return;
          const data = event?.notification?.data || {};
          activeAlertCallback?.({
            kind: data.kind || "message",
            callId: data.callId || ""
          });
        });
      }

      if (typeof pushNotif.register === "function") {
        await pushNotif.register();
      }
    } catch {
      // Sessiz geç
    }
  }

  if (localNotif && typeof localNotif.addListener === "function") {
    try {
      localNotif.addListener("localNotificationActionPerformed", (event) => {
        if (!getDeviceRole()) return;
        const extra = event?.notification?.extra || {};
        activeAlertCallback?.({
          kind: extra.kind || "message",
          callId: extra.callId || ""
        });
      });
    } catch {
      // Sessiz geç
    }
  }

  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    await requestNotificationPermissionSafe();
  }
}

export function teardownPushNotifications() {
  activeAlertCallback = null;
  document.getElementById("in-app-alert-banner")?.remove();
}
