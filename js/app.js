import {
  state,
  setAdminOwner,
  initRealtimeSync,
  initCallSignalListener,
  stopCallSignalListener,
  getDeviceRole,
  setDeviceRole,
  clearDeviceRole,
  resolveRoleFromPasscode,
  setMyPresence,
  setMyTypingStatus
} from "./state.js";
import { renderBiz, clearBizClock } from "./biz.js";
import {
  renderSohbet,
  markIncomingMessagesAsRead,
  refreshChatHeaderPresenceOnly,
  handleIncomingCallSignal
} from "./sohbet.js";
import { renderKonum } from "./konum.js";
import { renderAnilar } from "./anilar.js";
import { renderAdmin } from "./admin.js";
import {
  setupPushNotifications,
  teardownPushNotifications,
  showPhoneNotificationPanel
} from "./notifications.js";

let prevMessageCount = state.messages.length;
let lastNotifiedMsgId = null;
let lastNotifiedCallKey = null;

export function performFullLogout() {
  clearDeviceRole();
  teardownPushNotifications();
  stopCallSignalListener();
  document.getElementById("wa-call-screen-overlay")?.remove();
  state.activeTab = "biz";
  renderApp();
  openPasscodeLockOverlay(() => {
    startAppAfterRoleReady();
  });
}

export function openPasscodeLockOverlay(onUnlocked) {
  document.getElementById("passcode-lock-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "passcode-lock-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: radial-gradient(circle at top left, #ff9a9e 0%, #ff6a88 48%, #e84393 100%);
    backdrop-filter: blur(8px);
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%;
      max-width: 368px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 28px;
      padding: 30px 24px 26px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(120, 12, 68, 0.34);
      font-family: inherit;
    ">
      <div style="
        width: 54px;
        height: 54px;
        margin: 0 auto 14px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #ff5e8e, #ff2e63);
        color: #ffffff;
        font-size: 24px;
        box-shadow: 0 10px 24px rgba(255, 46, 99, 0.32);
      ">♥</div>

      <h2 style="
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
        color: #1c191d;
        letter-spacing: -0.3px;
      ">Parolayı Girin</h2>

      <p style="
        margin: 0 0 22px;
        font-size: 13.5px;
        color: #675d64;
        line-height: 1.5;
      ">Özel alanınıza giriş yapmak için size tanımlanan parolayı yazın.</p>

      <form id="passcode-unlock-form" style="display: flex; flex-direction: column; gap: 12px;">
        <div style="position: relative; width: 100%;">
          <input
            type="password"
            id="passcode-code-input"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="Parolanızı girin"
            style="
              width: 100%;
              box-sizing: border-box;
              padding: 15px 48px 15px 16px;
              border-radius: 16px;
              border: 1.5px solid #f1d5e1;
              background: #fff9fb;
              color: #1c191d;
              font-size: 16px;
              font-weight: 600;
              letter-spacing: 1.5px;
              text-align: center;
              outline: none;
              transition: border-color 0.2s ease, box-shadow 0.2s ease;
            "
          />

          <button
            type="button"
            id="toggle-passcode-visibility"
            aria-label="Parolayı göster veya gizle"
            title="Göster / Gizle"
            style="
              position: absolute;
              right: 10px;
              top: 50%;
              transform: translateY(-50%);
              width: 34px;
              height: 34px;
              border: none;
              border-radius: 10px;
              background: transparent;
              color: #8b5e75;
              font-size: 15px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
            "
          >👁</button>
        </div>

        <div
          id="passcode-error-msg"
          style="
            min-height: 18px;
            font-size: 12.5px;
            font-weight: 600;
            color: #d61c4e;
          "
        ></div>

        <button
          type="submit"
          id="passcode-submit-btn"
          style="
            width: 100%;
            padding: 15px 18px;
            border: none;
            border-radius: 16px;
            background: linear-gradient(135deg, #ff4d7d, #e62e65);
            color: #ffffff;
            font-size: 15.5px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 12px 24px rgba(230, 46, 101, 0.32);
            transition: transform 0.15s ease, opacity 0.15s ease;
          "
        >Giriş Yap</button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const inputEl = document.getElementById("passcode-code-input");
  const toggleBtn = document.getElementById("toggle-passcode-visibility");
  const errorEl = document.getElementById("passcode-error-msg");
  const formEl = document.getElementById("passcode-unlock-form");
  const submitBtn = document.getElementById("passcode-submit-btn");

  toggleBtn?.addEventListener("click", () => {
    if (!inputEl) return;
    const isHidden = inputEl.type === "password";
    inputEl.type = isHidden ? "text" : "password";
    toggleBtn.textContent = isHidden ? "🙈" : "👁";
    inputEl.focus();
  });

  inputEl?.addEventListener("focus", () => {
    inputEl.style.borderColor = "#ff4d7d";
    inputEl.style.boxShadow = "0 0 0 4px rgba(255, 77, 125, 0.14)";
  });

  inputEl?.addEventListener("blur", () => {
    inputEl.style.borderColor = "#f1d5e1";
    inputEl.style.boxShadow = "none";
  });

  inputEl?.addEventListener("input", () => {
    if (errorEl) errorEl.textContent = "";
  });

  setTimeout(() => inputEl?.focus(), 60);

  let isSubmitting = false;

  formEl?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const matchedRole = resolveRoleFromPasscode(inputEl?.value || "");

    if (!matchedRole) {
      if (errorEl) errorEl.textContent = "Hatalı parola. Lütfen tekrar deneyin.";
      inputEl?.focus();
      inputEl?.select();
      return;
    }

    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.75";
      submitBtn.textContent = "Giriş yapılıyor...";
    }

    try {
      await setDeviceRole(matchedRole);
      overlay.remove();
      onUnlocked?.();
    } catch {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.textContent = "Giriş Yap";
      }
      if (errorEl) errorEl.textContent = "Bağlantı sağlanamadı, lütfen tekrar deneyin.";
    }
  });
}

function getNavTabs() {
  const tabs = [
    { id: "biz", label: "Biz" },
    { id: "sohbet", label: "Sohbet" },
    { id: "konum", label: "Konum" },
    { id: "anilar", label: "Anılar" }
  ];

  if (state.isAdminOwner) {
    tabs.push({ id: "admin", label: "Admin" });
  }

  return tabs;
}

function renderNav(navEl) {
  const tabs = getNavTabs();
  navEl.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="nav-btn ${state.activeTab === t.id ? "active" : ""}" data-tab="${
          t.id
        }">${t.label}</button>`
    )
    .join("");

  navEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextTab = btn.dataset.tab;
      if (nextTab === "admin" && !state.isAdminOwner) return;
      state.activeTab = nextTab;
      renderApp();
    });
  });
}

export function renderApp() {
  const navEl = document.getElementById("bottom-nav") || document.querySelector("nav");
  const contentEl = document.getElementById("app-content") || document.getElementById("content");

  if (state.activeTab === "admin" && !state.isAdminOwner) {
    state.activeTab = "biz";
  }

  if (state.activeTab !== "biz") {
    clearBizClock();
  }

  if (getDeviceRole() && state.activeTab === "sohbet") {
    markIncomingMessagesAsRead();
  }

  if (navEl) {
    renderNav(navEl);
  }

  if (!contentEl) return;

  if (state.activeTab === "biz") {
    renderBiz(contentEl);
  } else if (state.activeTab === "sohbet") {
    renderSohbet(contentEl);
  } else if (state.activeTab === "konum") {
    renderKonum(contentEl);
  } else if (state.activeTab === "anilar") {
    renderAnilar(contentEl);
  } else if (state.activeTab === "admin") {
    renderAdmin(contentEl, () => renderApp());
  }

  prevMessageCount = state.messages.length;
}

function bindPresenceLifecycle() {
  setMyPresence(true);

  document.addEventListener("visibilitychange", () => {
    if (!getDeviceRole()) return;
    if (document.visibilityState === "visible") {
      setMyPresence(true);
    } else {
      setMyTypingStatus(false);
      setMyPresence(false);
    }
  });

  window.addEventListener("pagehide", () => {
    if (!getDeviceRole()) return;
    setMyTypingStatus(false);
    setMyPresence(false);
  });

  window.addEventListener("beforeunload", () => {
    if (!getDeviceRole()) return;
    setMyTypingStatus(false);
    setMyPresence(false);
  });
}

function notifyIfBackgroundMessage() {
  if (!getDeviceRole()) return;
  if (!Array.isArray(state.messages) || state.messages.length === 0) return;

  const latest = state.messages[state.messages.length - 1];
  if (!latest || latest.sender !== "them") return;

  const msgKey = String(latest.id ?? latest.createdAt ?? "");
  if (!msgKey || msgKey === lastNotifiedMsgId) return;
  lastNotifiedMsgId = msgKey;

  if (document.visibilityState === "visible" && state.activeTab === "sohbet") {
    return;
  }

  const senderTitle = state.partnerName || "Yeni Mesaj";
  const previewText =
    latest.type === "audio"
      ? "🎤 Sesli mesaj gönderdi"
      : latest.type === "image"
      ? "📷 Fotoğraf gönderdi"
      : latest.text || "Yeni bir mesajın var.";

  showPhoneNotificationPanel({
    title: senderTitle,
    body: previewText,
    kind: "message"
  });
}

function notifyIfBackgroundCall(signal) {
  if (!getDeviceRole() || !signal || typeof signal !== "object") return;
  const myRole = getDeviceRole();
  const isIncoming =
    signal.status === "ringing" &&
    signal.calleeRole === myRole &&
    signal.callerRole &&
    signal.callerRole !== myRole;
  if (!isIncoming) return;

  const callKey = String(signal.callId || signal.updatedAt || signal.ts || "");
  if (!callKey || callKey === lastNotifiedCallKey) return;
  lastNotifiedCallKey = callKey;

  const isVideo = signal.mode === "video" || signal.kind === "video_call";
  showPhoneNotificationPanel({
    title: isVideo ? "Görüntülü Arama" : "Sesli Arama",
    body: `${signal.callerName || state.partnerName || "Sevgilin"} seni arıyor...`,
    kind: isVideo ? "video_call" : "voice_call",
    callId: signal.callId || null
  });
}

let presenceBound = false;

function startAppAfterRoleReady() {
  if (!presenceBound) {
    presenceBound = true;
    bindPresenceLifecycle();
  } else {
    setMyPresence(true);
  }

  renderApp();

  setupPushNotifications({
    onIncomingAlert: () => {
      if (!getDeviceRole()) return;
      state.activeTab = "sohbet";
      renderApp();
    }
  });

  initCallSignalListener((signal) => {
    if (!getDeviceRole()) return;
    notifyIfBackgroundCall(signal);
    const contentEl = document.getElementById("app-content") || document.getElementById("content");
    handleIncomingCallSignal(signal, contentEl);
  });

  initRealtimeSync(() => {
    if (!getDeviceRole()) return;
    notifyIfBackgroundMessage();

    const contentEl = document.getElementById("app-content") || document.getElementById("content");
    if (!contentEl) return;

    const hasNewMessages = state.messages.length !== prevMessageCount;
    prevMessageCount = state.messages.length;

    if (state.activeTab === "sohbet") {
      markIncomingMessagesAsRead();
      const inputFocused = document.activeElement?.id === "msg-input";
      const panel = document.getElementById("messages-panel");

      if (!hasNewMessages && inputFocused && panel) {
        refreshChatHeaderPresenceOnly();
        return;
      }

      const nearBottom = panel
        ? panel.scrollHeight - panel.scrollTop - panel.clientHeight < 90
        : true;
      renderSohbet(contentEl, inputFocused, {
        scrollToBottom: nearBottom,
        preserveScroll: !nearBottom
      });
    } else if (state.activeTab === "biz") {
      const isTypingInBiz = ["my-note-input", "my-name-input", "special-event-title-input"].includes(
        document.activeElement?.id || ""
      );
      if (!isTypingInBiz) {
        renderBiz(contentEl);
      }
    } else if (state.activeTab === "konum") {
      const fetchingBtn = document.getElementById("btn-fetch-location");
      if (!fetchingBtn || !fetchingBtn.disabled) {
        renderKonum(contentEl);
      }
    } else {
      renderApp();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (window.location.hash === "#admin-owner") {
    setAdminOwner(true);
  }

  const existingRole = getDeviceRole();
  if (!existingRole) {
    renderApp();
    openPasscodeLockOverlay(() => {
      startAppAfterRoleReady();
    });
  } else {
    startAppAfterRoleReady();
  }
});
