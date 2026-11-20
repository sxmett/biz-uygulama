import {
  state,
  setAdminOwner,
  initRealtimeSync,
  getDeviceRole,
  setDeviceRole,
  requestNotificationPermissionSafe
} from "./state.js";
import { renderBiz, clearBizClock } from "./biz.js";
import { renderSohbet, markIncomingMessagesAsRead } from "./sohbet.js";
import { renderKonum } from "./konum.js";
import { renderAnilar } from "./anilar.js";
import { renderAdmin } from "./admin.js";

function renderRoleOnboardingOverlay(onSelected) {
  document.getElementById("role-onboarding-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "role-onboarding-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(160deg, #ff758c 0%, #ff7eb3 50%, #f857a6 100%);
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%;
      max-width: 360px;
      background: rgba(255, 255, 255, 0.96);
      border-radius: 24px;
      padding: 28px 22px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(136, 14, 79, 0.28);
    ">
      <div style="font-size: 28px; margin-bottom: 6px;">♥</div>
      <h2 style="margin: 0 0 8px; font-size: 21px; color: #1f1f24;">Hoş Geldin</h2>
      <p style="margin: 0 0 22px; font-size: 14px; color: #555562; line-height: 1.45;">
        Bu cihaz kime ait? Seçimini yap, her şey birlikte senkronize çalışsın.
      </p>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button
          type="button"
          id="pick-role-samet"
          style="
            padding: 15px 18px;
            border: none;
            border-radius: 16px;
            background: #ff4d79;
            color: #ffffff;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 8px 20px rgba(255, 77, 121, 0.35);
          "
        >Samet</button>

        <button
          type="button"
          id="pick-role-emine"
          style="
            padding: 15px 18px;
            border: 2px solid #ff4d79;
            border-radius: 16px;
            background: #fff0f5;
            color: #d81b60;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
          "
        >Emine</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("pick-role-samet")?.addEventListener("click", () => {
    setDeviceRole("userA");
    overlay.remove();
    onSelected?.();
  });

  document.getElementById("pick-role-emine")?.addEventListener("click", () => {
    setDeviceRole("userB");
    overlay.remove();
    onSelected?.();
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

  if (state.activeTab === "sohbet") {
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
}

function startAppAfterRoleReady() {
  renderApp();

  initRealtimeSync(() => {
    if (state.activeTab === "sohbet") {
      markIncomingMessagesAsRead();
      const contentEl = document.getElementById("app-content") || document.getElementById("content");
      if (contentEl) {
        const keepFocus = document.activeElement?.id === "msg-input";
        renderSohbet(contentEl, keepFocus, { scrollToBottom: true, preserveScroll: false });
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
    renderRoleOnboardingOverlay(() => {
      startAppAfterRoleReady();
    });
  } else {
    startAppAfterRoleReady();
  }
});
