import {
  state,
  saveState,
  writeMyProfileChanges,
  syncDeviceBatteryLevel
} from "./state.js";
import { performFullLogout } from "./app.js";

let isEditingProfile = false;
let isEditingTogetherDate = false;
let isEditingSpecialEvent = false;
let isEditingMyNote = false;
let pendingMyAvatarDataUrl = null;

export function clearBizClock() {
  if (state.bizClockInterval) {
    clearInterval(state.bizClockInterval);
    state.bizClockInterval = null;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDurationParts(startIsoString) {
  const start = new Date(startIsoString);
  const now = new Date();
  if (Number.isNaN(start.getTime())) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const diffMs = Math.max(0, now.getTime() - start.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function formatCountdownParts(targetIsoString) {
  const target = new Date(targetIsoString);
  const now = new Date();
  if (Number.isNaN(target.getTime())) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, passed: false };
  }
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, passed: true };
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, passed: false };
}

function isSpecialEventConfigured() {
  const ev = state.specialEvent;
  if (!ev || typeof ev !== "object") return false;
  if (ev.isSet === false) return false;
  return Boolean(
    typeof ev.date === "string" &&
      ev.date.trim().length > 0 &&
      (ev.isSet === true || !ev.date.startsWith("2026-12-12"))
  );
}

function formatDistanceLabel(km) {
  const num = Number(km);
  if (!Number.isFinite(num) || num <= 0) {
    return "Mesafe bilgisi yok";
  }
  if (num < 1) {
    return `${Math.round(num * 1000)} m`;
  }
  return `${num.toFixed(1)} km`;
}

function getGenitiveNotLabel(name) {
  const clean = (name || "").trim();
  if (!clean) return "Notu";
  const lastChar = clean.slice(-1).toLowerCase();
  const vowels = ["a", "e", "ı", "i", "o", "ö", "u", "ü"];
  if (!vowels.includes(lastChar)) {
    return `${clean} Notu`;
  }
  return `${clean}'nin Notu`;
}

function getPartnerStatusText(partnerName) {
  if (state.partnerOnline) {
    return `${partnerName}: Çevrimiçi`;
  }
  if (state.partnerLastSeen && state.partnerLastSeen !== "Henüz görülmedi") {
    return `${partnerName} son görülme: ${state.partnerLastSeen}`;
  }
  return `${partnerName} son görülme: Bilinmiyor`;
}

function getPartnerBatteryText(partnerName) {
  if (typeof state.partnerBatteryLevel === "number") {
    const chargeTag = state.partnerBatteryCharging ? " (Şarjda)" : "";
    return `${partnerName} pil: %${state.partnerBatteryLevel}${chargeTag}`;
  }
  return `${partnerName} pil: Bilgi yok`;
}

function openLogoutConfirmModal() {
  document.getElementById("biz-logout-confirm-modal")?.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "biz-logout-confirm-modal";
  backdrop.className = "biz-confirm-backdrop";
  backdrop.innerHTML = `
    <div class="biz-confirm-card" role="dialog" aria-modal="true" aria-labelledby="biz-logout-title">
      <div id="biz-logout-title" class="biz-confirm-title">Çıkış Yap</div>
      <p class="biz-confirm-desc">Çıkış yapmak istiyor musunuz?</p>
      <div class="biz-confirm-actions">
        <button type="button" class="biz-btn biz-btn-ghost" id="biz-logout-cancel-btn">İptal</button>
        <button type="button" class="biz-btn biz-btn-primary" id="biz-logout-confirm-btn">Çıkış Yap</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => {
    document.removeEventListener("keydown", onEsc);
    backdrop.remove();
  };

  const onEsc = (e) => {
    if (e.key === "Escape") closeModal();
  };

  document.addEventListener("keydown", onEsc);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.getElementById("biz-logout-cancel-btn")?.addEventListener("click", closeModal);

  document.getElementById("biz-logout-confirm-btn")?.addEventListener("click", () => {
    closeModal();
    clearBizClock();
    performFullLogout();
  });
}

function updateLiveClocksInDom() {
  if (document.visibilityState !== "visible") return;

  const together = formatDurationParts(state.startDate);
  const togetherEl = document.getElementById("biz-together-live");
  if (togetherEl) {
    const nextText = `${together.days} gün ${pad2(together.hours)}:${pad2(
      together.minutes
    )}:${pad2(together.seconds)}`;
    if (togetherEl.textContent !== nextText) {
      togetherEl.textContent = nextText;
    }
  }

  const countdownEl = document.getElementById("biz-event-countdown-live");
  if (countdownEl && isSpecialEventConfigured() && state.specialEvent?.date) {
    const countdown = formatCountdownParts(state.specialEvent.date);
    const nextCountdown = countdown.passed
      ? "Bugün!"
      : `${countdown.days} gün ${pad2(countdown.hours)}:${pad2(countdown.minutes)}:${pad2(
          countdown.seconds
        )}`;
    if (countdownEl.textContent !== nextCountdown) {
      countdownEl.textContent = nextCountdown;
    }
  }
}

function toDateInputValue(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function renderBiz(contentEl) {
  clearBizClock();

  const myLabel = state.myName || "Samet";
  const partnerLabel = state.partnerName || "Emine";
  const myInitial = (myLabel || "S").trim()[0]?.toUpperCase() || "S";
  const partnerInitial = (partnerLabel || "E").trim()[0]?.toUpperCase() || "E";

  const myAvatarHtml = state.myAvatar
    ? `<div class="biz-avatar"><img src="${state.myAvatar}" alt="${myLabel}" /></div>`
    : `<div class="biz-avatar">${myInitial}</div>`;

  const partnerAvatarHtml = state.partnerAvatar
    ? `<div class="biz-avatar sm"><img src="${state.partnerAvatar}" alt="${partnerLabel}" /></div>`
    : `<div class="biz-avatar sm">${partnerInitial}</div>`;

  const partnerNoteTitle = getGenitiveNotLabel(partnerLabel);
  const distanceText = formatDistanceLabel(state.distanceKm);
  const eventConfigured = isSpecialEventConfigured();
  const eventTitle = eventConfigured ? state.specialEvent?.title || "Özel Gün" : "Özel Gün";
  const eventDate = eventConfigured ? state.specialEvent?.date || "" : "";

  const profileEditorHtml = isEditingProfile
    ? `
      <div class="biz-card biz-editor">
        <div class="biz-field">
          <label class="biz-label" for="my-name-input">Adın</label>
          <input
            type="text"
            id="my-name-input"
            class="biz-input"
            value="${myLabel.replace(/"/g, "&quot;")}"
            placeholder="Adını yaz..."
          />
        </div>
        <div class="biz-field">
          <span class="biz-label">Profil Fotoğrafı</span>
          <div class="biz-actions-row">
            <label class="biz-btn biz-btn-ghost" style="cursor:pointer;">
              Fotoğraf Seç
              <input type="file" id="my-avatar-input" accept="image/*" hidden />
            </label>
            ${
              pendingMyAvatarDataUrl || state.myAvatar
                ? `<button type="button" class="biz-btn biz-btn-ghost" id="remove-my-avatar-btn">Kaldır</button>`
                : ""
            }
          </div>
          ${
            pendingMyAvatarDataUrl
              ? `<img src="${pendingMyAvatarDataUrl}" alt="Yeni profil" class="biz-thumb" />`
              : ""
          }
        </div>
        <div class="biz-editor-actions">
          <button type="button" class="biz-btn biz-btn-ghost" id="cancel-profile-btn">İptal</button>
          <button type="button" class="biz-btn biz-btn-primary" id="save-profile-btn">Kaydet</button>
        </div>
      </div>
    `
    : "";

  const togetherEditorHtml = isEditingTogetherDate
    ? `
      <div class="biz-inline-edit">
        <input
          type="date"
          id="together-start-date-input"
          class="biz-input"
          value="${toDateInputValue(state.startDate)}"
        />
        <button type="button" class="biz-btn biz-btn-primary" id="save-together-date-btn">Kaydet</button>
        <button type="button" class="biz-btn biz-btn-ghost" id="cancel-together-date-btn">İptal</button>
      </div>
    `
    : "";

  const eventEditorHtml = isEditingSpecialEvent
    ? `
      <div class="biz-editor" style="margin-top:10px;">
        <div class="biz-field">
          <label class="biz-label" for="special-event-title-input">Başlık</label>
          <input
            type="text"
            id="special-event-title-input"
            class="biz-input"
            value="${eventConfigured ? (state.specialEvent?.title || "").replace(/"/g, "&quot;") : ""}"
            placeholder="Örn: Yıldönümü, Doğum Günü..."
          />
        </div>
        <div class="biz-field">
          <label class="biz-label" for="special-event-date-input">Tarih</label>
          <input
            type="date"
            id="special-event-date-input"
            class="biz-input"
            value="${toDateInputValue(eventDate)}"
          />
        </div>
        <div class="biz-editor-actions">
          ${
            eventConfigured
              ? `<button type="button" class="biz-btn biz-btn-ghost" id="clear-special-event-btn">Temizle</button>`
              : ""
          }
          <button type="button" class="biz-btn biz-btn-ghost" id="cancel-event-btn">İptal</button>
          <button type="button" class="biz-btn biz-btn-primary" id="save-event-btn">Kaydet</button>
        </div>
      </div>
    `
    : "";

  const myNoteContentHtml = isEditingMyNote
    ? `
      <div class="biz-inline-edit">
        <input
          type="text"
          id="my-note-input"
          class="biz-input"
          value="${(state.myNote || "").replace(/"/g, "&quot;")}"
          placeholder="Notunu yaz..."
        />
        <button type="button" class="biz-btn biz-btn-primary" id="save-my-note-btn">Kaydet</button>
        <button type="button" class="biz-btn biz-btn-ghost" id="cancel-my-note-btn">İptal</button>
      </div>
    `
    : `
      <p class="biz-note-text ${state.myNote ? "" : "muted"}">
        ${state.myNote ? state.myNote : "Henüz not eklemedin."}
      </p>
    `;

  contentEl.innerHTML = `
    <div class="biz-wrap">
      <section class="biz-card biz-top-card">
        <div class="biz-user-row">
          ${myAvatarHtml}
          <div>
            <div class="biz-kicker">PROFİLİM</div>
            <div class="biz-title">${myLabel}</div>
          </div>
        </div>
        <div class="biz-actions-row">
          <button type="button" class="biz-btn biz-btn-ghost" id="refresh-biz-btn">Yenile</button>
          <button type="button" class="biz-btn biz-btn-ghost" id="edit-my-profile-btn">Düzenle</button>
          <button type="button" class="biz-btn biz-btn-soft" id="logout-app-btn">Çıkış Yap</button>
        </div>
      </section>

      ${profileEditorHtml}

      <section class="biz-card">
        <div class="biz-card-top">
          <div class="biz-title">Birlikte Geçen Süre</div>
          <button type="button" class="biz-btn biz-btn-ghost" id="edit-together-date-btn">Düzenle</button>
        </div>
        <div id="biz-together-live" class="biz-metric accent"></div>
        ${togetherEditorHtml}
      </section>

      <section class="biz-card">
        <div class="biz-card-top">
          <div class="biz-title">${eventConfigured ? eventTitle : "Özel Gün"}</div>
          <button type="button" class="biz-btn biz-btn-ghost" id="edit-special-event-btn">
            ${eventConfigured ? "Düzenle" : "Ayarla"}
          </button>
        </div>
        ${
          eventConfigured
            ? `<div id="biz-event-countdown-live" class="biz-metric"></div>`
            : `<p class="biz-note-text muted">Henüz özel gün ayarlanmadı.</p>`
        }
        ${eventEditorHtml}
      </section>

      <section class="biz-card">
        <div class="biz-card-top">
          <div class="biz-title">Senin Notun</div>
          ${
            !isEditingMyNote
              ? `<button type="button" class="biz-btn biz-btn-ghost" id="edit-my-note-btn">Düzenle</button>`
              : ""
          }
        </div>
        ${myNoteContentHtml}
      </section>

      <section class="biz-card">
        <div class="biz-card-top">
          <div class="biz-user-row">
            ${partnerAvatarHtml}
            <div class="biz-title">${partnerNoteTitle}</div>
          </div>
          <span class="biz-distance-pill">Mesafe: ${distanceText}</span>
        </div>
        <p class="biz-note-text ${state.partnerNote ? "" : "muted"}">
          ${state.partnerNote ? state.partnerNote : `${partnerLabel} henüz not yazmadı.`}
        </p>
      </section>

      <section class="biz-card biz-footer-status-card">
        <div class="biz-status-line ${state.partnerOnline ? "online" : ""}">
          ${getPartnerStatusText(partnerLabel)}
        </div>
        <div class="biz-battery-line" id="biz-battery-text">
          ${getPartnerBatteryText(partnerLabel)}
        </div>
      </section>
    </div>
  `;

  updateLiveClocksInDom();
  state.bizClockInterval = setInterval(updateLiveClocksInDom, 1000);

  syncDeviceBatteryLevel({ pushCloud: true });

  document.getElementById("refresh-biz-btn")?.addEventListener("click", async () => {
    await syncDeviceBatteryLevel({ pushCloud: true });
    renderBiz(contentEl);
  });

  document.getElementById("logout-app-btn")?.addEventListener("click", () => {
    openLogoutConfirmModal();
  });

  document.getElementById("edit-my-profile-btn")?.addEventListener("click", () => {
    isEditingProfile = !isEditingProfile;
    pendingMyAvatarDataUrl = state.myAvatar || null;
    renderBiz(contentEl);
  });

  document.getElementById("cancel-profile-btn")?.addEventListener("click", () => {
    isEditingProfile = false;
    pendingMyAvatarDataUrl = null;
    renderBiz(contentEl);
  });

  document.getElementById("my-avatar-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingMyAvatarDataUrl = reader.result;
      renderBiz(contentEl);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("remove-my-avatar-btn")?.addEventListener("click", () => {
    pendingMyAvatarDataUrl = null;
    writeMyProfileChanges({ avatar: null });
    saveState({ pushCloud: true, immediate: true });
    renderBiz(contentEl);
  });

  document.getElementById("save-profile-btn")?.addEventListener("click", () => {
    const nameInput = document.getElementById("my-name-input");
    const nextName = (nameInput?.value || "").trim() || myLabel;
    writeMyProfileChanges({
      name: nextName,
      avatar: pendingMyAvatarDataUrl !== null ? pendingMyAvatarDataUrl : state.myAvatar
    });
    saveState({ pushCloud: true, immediate: true });
    isEditingProfile = false;
    pendingMyAvatarDataUrl = null;
    renderBiz(contentEl);
  });

  document.getElementById("edit-together-date-btn")?.addEventListener("click", () => {
    isEditingTogetherDate = !isEditingTogetherDate;
    renderBiz(contentEl);
  });

  document.getElementById("cancel-together-date-btn")?.addEventListener("click", () => {
    isEditingTogetherDate = false;
    renderBiz(contentEl);
  });

  document.getElementById("save-together-date-btn")?.addEventListener("click", () => {
    const dateVal = document.getElementById("together-start-date-input")?.value;
    if (dateVal) {
      state.startDate = `${dateVal}T00:00:00`;
      saveState({ pushCloud: true, immediate: true });
    }
    isEditingTogetherDate = false;
    renderBiz(contentEl);
  });

  document.getElementById("edit-special-event-btn")?.addEventListener("click", () => {
    isEditingSpecialEvent = !isEditingSpecialEvent;
    renderBiz(contentEl);
  });

  document.getElementById("cancel-event-btn")?.addEventListener("click", () => {
    isEditingSpecialEvent = false;
    renderBiz(contentEl);
  });

  document.getElementById("clear-special-event-btn")?.addEventListener("click", () => {
    state.specialEvent = {
      title: "",
      date: "",
      isSet: false
    };
    saveState({ pushCloud: true, immediate: true });
    isEditingSpecialEvent = false;
    renderBiz(contentEl);
  });

  document.getElementById("save-event-btn")?.addEventListener("click", () => {
    const titleVal = (document.getElementById("special-event-title-input")?.value || "").trim();
    const dateVal = document.getElementById("special-event-date-input")?.value;
    if (!dateVal) return;

    state.specialEvent = {
      title: titleVal || "Özel Gün",
      date: `${dateVal}T00:00:00`,
      isSet: true
    };
    saveState({ pushCloud: true, immediate: true });
    isEditingSpecialEvent = false;
    renderBiz(contentEl);
  });

  document.getElementById("edit-my-note-btn")?.addEventListener("click", () => {
    isEditingMyNote = true;
    renderBiz(contentEl);
    const inp = document.getElementById("my-note-input");
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });

  document.getElementById("cancel-my-note-btn")?.addEventListener("click", () => {
    isEditingMyNote = false;
    renderBiz(contentEl);
  });

  const saveMyNote = () => {
    const inp = document.getElementById("my-note-input");
    writeMyProfileChanges({ note: (inp?.value || "").trim() });
    saveState({ pushCloud: true, immediate: true });
    isEditingMyNote = false;
    renderBiz(contentEl);
  };

  document.getElementById("save-my-note-btn")?.addEventListener("click", saveMyNote);
  document.getElementById("my-note-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveMyNote();
    }
  });
}
