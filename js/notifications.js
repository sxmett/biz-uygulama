import { db, ref, set, push } from "./firebase.js";
import { getDeviceRole, getPartnerRole } from "./state.js";

let activeAlertCallback = null;
let nativeListenersBound = false;

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
    if (!isNativeAndroid()) return null;
    const ln = getCapacitor()?.Plugins?.LocalNotifications;
    return ln && typeof ln.schedule === "function" ? ln : null;
  } catch {
    return null;
  }
}

function getCapacitorPushNotifications() {
  try {
    if (!isNativeAndroid()) return null;
    const pn = getCapacitor()?.Plugins?.PushNotifications;
    return pn && typeof pn.register === "function" ? pn : null;
  } catch {
    return null;
  }
}

export async function savePushTokenToDb(token) {
  if (!isNativeAndroid()) return;
  const myRole = getDeviceRole();
  if (!myRole || !token || typeof token !== "string") return;
  const cleanToken = token.trim();
  if (!cleanToken) return;

  try {
    await set(ref(db, `biz_room/push_tokens/${myRole}`), {
      token: cleanToken,
      role: myRole,
      platform: "android",
      updatedAt: Date.now()
    });
  } catch {
    // Sessiz geç
  }
}

async function ensureAndroidNotificationChannels(localNotif, pushNotif) {
  if (!isNativeAndroid()) return;
  const channels = [
    {
      id: "biz_messages_channel",
      name: "Mesajlar",
      description: "Yeni sohbet mesajı bildirimleri",
      importance: 4,
      visibility: 1,
      vibration: true
    },
    {
      id: "biz_calls_channel",
      name: "Sesli ve Görüntülü Aramalar",
      description: "Gelen arama bildirimleri",
      importance: 5,
      visibility: 1,
      vibration: true
    }
  ];

  for (const ch of channels) {
    if (localNotif && typeof localNotif.createChannel === "function") {
      try {
        await localNotif.createChannel(ch);
      } catch {}
    }
    if (pushNotif && typeof pushNotif.createChannel === "function") {
      try {
        await pushNotif.createChannel(ch);
      } catch {}
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

    if (isNativeAndroid() && navigator.vibrate) {
      navigator.vibrate(isCall ? [300, 120, 300, 120, 350] : [140, 60, 140]);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 950);
  } catch {}
}

export function showInAppAlertBanner({ title, body, kind = "message", callId = null, onOpen }) {
  if (!getDeviceRole()) return;

  document.getElementById("in-app-alert-banner")?.remove();

  const isCall = kind === "voice_call" || kind === "video_call";
  const badgeIcon = kind === "video_call" ? "📹" : kind === "voice_call" ? "📞" : "💬";
  const cleanTitle = String(title || "Yeni Bildirim").replace(/^(💬|📞|📹)\s*/, "");

  const banner = document.createElement("div");
  banner.id = "in-app-alert-banner";
  banner.className = "in-app-alert";
  banner.style.cssText = `
    position: fixed;
    top: max(12px, env(safe-area-inset-top));
    left: 12px;
    right: 12px;
    z-index: 99998;
    background: rgba(24, 24, 28, 0.94);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 20px;
    padding: 12px 14px;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    gap: 12px;
    color: #ffffff;
    font-family: inherit;
    animation: slideDownToast 0.22s ease-out;
  `;

  if (!document.getElementById("biz-toast-anim-style")) {
    const style = document.createElement("style");
    style.id = "biz-toast-anim-style";
    style.textContent = `
      @keyframes slideDownToast {
        from { opacity: 0; transform: translateY(-14px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  banner.innerHTML = `
    <div style="
      width: 42px;
      height: 42px;
      border-radius: 14px;
      background: ${isCall ? "linear-gradient(135deg, #22c55e, #16a34a)" : "linear-gradient(135deg, #ff4d7d, #e11d48)"};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 19px;
      flex-shrink: 0;
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    ">${badgeIcon}</div>
    <div style="min-width:0;flex:1;cursor:pointer;" id="alert-body-click">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-weight:700;font-size:13.5px;color:#ffffff;letter-spacing:-0.2px;">${cleanTitle}</span>
        <span style="font-size:11px;color:rgba(255,255,255,0.55);font-weight:600;">şimdi</span>
      </div>
      <div style="font-size:12.5px;color:rgba(255,255,255,0.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${body || ""}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <button type="button" id="alert-open-btn" style="
        border:none;
        border-radius:12px;
        padding:7px 11px;
        font-size:12px;
        font-weight:700;
        background:#ff4d7d;
        color:#fff;
        cursor:pointer;
      ">${isCall ? "Yanıtla" : "Aç"}</button>
      <button type="button" id="alert-dismiss-btn" aria-label="Kapat" style="
        border:none;
        border-radius:12px;
        width:30px;
        height:30px;
        font-size:13px;
        font-weight:700;
        background:rgba(255,255,255,0.1);
        color:rgba(255,255,255,0.8);
        cursor:pointer;
      ">✕</button>
    </div>
  `;

  document.body.appendChild(banner);
  playIncomingTone(kind);

  const dismiss = () => banner.remove();
  const openAction = () => {
    dismiss();
    if (typeof onOpen === "function") {
      onOpen({ kind, title: cleanTitle, body, callId });
    } else if (typeof activeAlertCallback === "function") {
      activeAlertCallback({ kind, title: cleanTitle, body, callId });
    }
  };

  document.getElementById("alert-dismiss-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });
  document.getElementById("alert-open-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openAction();
  });
  document.getElementById("alert-body-click")?.addEventListener("click", openAction);

  setTimeout(() => {
    if (document.getElementById("in-app-alert-banner") === banner) {
      banner.remove();
    }
  }, isCall ? 12000 : 5500);
}

export async function showPhoneNotificationPanel({ title, body, kind = "message", callId = null }) {
  if (!getDeviceRole()) return;

  // PC/Web tarayıcıda Windows bildirim paneli basma; sadece uygulama içi şık kart göster
  if (!isNativeAndroid()) {
    if (document.visibilityState === "visible") {
      showInAppAlertBanner({
        title,
        body,
        kind,
        callId,
        onOpen: (info) => activeAlertCallback?.(info)
      });
    }
    return;
  }

  const isCall = kind === "voice_call" || kind === "video_call";
  const safeTitle =
    title ||
    (kind === "video_call"
      ? "Görüntülü Arama"
      : kind === "voice_call"
      ? "Sesli Arama"
      : "Yeni Mesaj");
  const safeBody = body || (isCall ? "Seni arıyor..." : "Yeni bir mesajın var.");

  if (document.visibilityState === "visible") {
    showInAppAlertBanner({
      title: safeTitle,
      body: safeBody,
      kind,
      callId,
      onOpen: (info) => activeAlertCallback?.(info)
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
    } catch {}
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
  } catch {}
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

  // Sadece gerçek Android APK üzerinde push token al ve kaydet
  if (!isNativeAndroid()) return;

  const localNotif = getCapacitorLocalNotifications();
  const pushNotif = getCapacitorPushNotifications();

  await ensureAndroidNotificationChannels(localNotif, pushNotif);

  if (pushNotif) {
    try {
      if (
        typeof pushNotif.checkPermissions === "function" &&
        typeof pushNotif.requestPermissions === "function"
      ) {
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
            } catch {}
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

      await pushNotif.register();
    } catch {}
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
    } catch {}
  }
}

export function teardownPushNotifications() {
  activeAlertCallback = null;
  document.getElementById("in-app-alert-banner")?.remove();
}
