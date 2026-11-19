import { state, setAdminOwner, initRealtimeSync } from "./state.js";
import { renderBiz, clearBizClock } from "./biz.js";
import { renderSohbet, markIncomingMessagesAsRead } from "./sohbet.js";
import { renderKonum } from "./konum.js";
import { renderAnilar } from "./anilar.js";
import { renderAdmin } from "./admin.js";

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

window.addEventListener("DOMContentLoaded", () => {
  if (window.location.hash === "#admin-owner") {
    setAdminOwner(true);
  }
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
});
