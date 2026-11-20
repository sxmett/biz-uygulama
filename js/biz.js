import {
  state,
  nowTime,
  showToast,
  saveState,
  syncDailyMissReset,
  clearDeviceRole
} from "./state.js";
import { openPasscodeLockOverlay, renderApp } from "./app.js";

let isEditingCouple = false;

export function clearBizClock() {
  if (state.bizClockInterval) {
    clearInterval(state.bizClockInterval);
    state.bizClockInterval = null;
  }
}

function getElapsedTime() {
  const parsed = new Date(state.startDate).getTime();
  const safeStart = Number.isNaN(parsed) ? Date.now() : parsed;
  const diffMs = Math.max(0, Date.now() - safeStart);
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function toDateTimeLocalValue(isoOrDateStr) {
  const d = new Date(isoOrDateStr);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function toDateInputValue(isoOrDateStr) {
  const d = new Date(isoOrDateStr);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getDaysUntilSpecialEvent() {
  const diffMs = new Date(state.specialEvent.date).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function renderAvatarWithCount(name, photoSrc, count, countId) {
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  const circleHtml = photoSrc
    ? `<div class="avatar-circle"><img src="${photoSrc}" alt="${name}" /></div>`
    : `<div class="avatar-circle">${initial}</div>`;

  return `
    <div class="avatar-badge-col">
      ${circleHtml}
      <span class="avatar-miss-count" id="${countId}">${count}</span>
    </div>
  `;
}

export function renderBiz(contentEl) {
  clearBizClock();
  syncDailyMissReset();

  const { days, hours, minutes, seconds } = getElapsedTime();
  const daysLeft = getDaysUntilSpecialEvent();

  const editPanelHtml = isEditingCouple
    ? `
      <div class="profile-edit-box">
        <div class="profile-edit-grid">
          <div class="profile-edit-col">
            <div class="label" style="margin:0;">Senin Adın ve Fotoğrafın</div>
            <input
              type="text"
              id="my-name-input"
              class="msg-input plain-input"
              placeholder="Adın"
              value="${state.myName}"
            />
            <div class="profile-photo-row">
              <label class="tool-btn" style="cursor:pointer;">
                Fotoğraf Seç
                <input type="file" id="my-avatar-input" accept="image/*" hidden />
              </label>
              ${
                state.myAvatar
                  ? `<button type="button" class="tool-btn" id="remove-my-avatar">Fotoğrafı Kaldır</button>`
                  : ""
              }
            </div>
          </div>

          <div class="profile-edit-col">
            <div class="label" style="margin:0;">Sevgilinin Adı ve Fotoğrafı</div>
            <input
              type="text"
              id="partner-name-input"
              class="msg-input plain-input"
              placeholder="Sevgilinin adı"
              value="${state.partnerName}"
            />
            <div class="profile-photo-row">
              <label class="tool-btn" style="cursor:pointer;">
                Fotoğraf Seç
                <input type="file" id="partner-avatar-input" accept="image/*" hidden />
              </label>
              ${
                state.partnerAvatar
                  ? `<button type="button" class="tool-btn" id="remove-partner-avatar">Fotoğrafı Kaldır</button>`
                  : ""
              }
            </div>
          </div>
        </div>

        <div class="date-edit-row">
          <label for="start-date-input" class="label" style="margin:0;">Sevgili Olduğumuz Tarih ve Saat</label>
          <input
            type="datetime-local"
            id="start-date-input"
            class="msg-input plain-input date-input"
            value="${toDateTimeLocalValue(state.startDate)}"
          />
        </div>

        <div class="profile-edit-grid">
          <div class="profile-edit-col">
            <label for="special-event-title-input" class="label" style="margin:0;">Yaklaşan Özel Gün Adı</label>
            <input
              type="text"
              id="special-event-title-input"
              class="msg-input plain-input"
              placeholder="Örn: Yıldönümü, Doğum Günü"
              value="${(state.specialEvent?.title || "").replace(/"/g, "&quot;")}"
            />
          </div>
          <div class="profile-edit-col">
            <label for="special-event-date-input" class="label" style="margin:0;">Yaklaşan Özel Gün Tarihi</label>
            <input
              type="date"
              id="special-event-date-input"
              class="msg-input plain-input date-input"
              value="${toDateInputValue(state.specialEvent?.date)}"
            />
          </div>
        </div>

        <div class="mini-row" style="justify-content:flex-end;">
          <button type="button" class="tool-btn" id="cancel-couple-edit">İptal</button>
          <button type="button" class="mini-btn" id="save-couple-edit">Kaydet</button>
        </div>
      </div>
    `
    : "";

  contentEl.innerHTML = `
    <div class="hero-card">
      <div class="hero-top">
        <div class="couple-avatars">
          ${renderAvatarWithCount(state.myName, state.myAvatar, state.myMissCount || 0, "my-miss-count")}
          <span class="couple-heart">♥</span>
          ${renderAvatarWithCount(
            state.partnerName,
            state.partnerAvatar,
            state.partnerMissCount || 0,
            "partner-miss-count"
          )}
          <div>
            <strong>${state.myName} & ${state.partnerName}</strong>
            <div class="peer-sub">Birlikte geçen zaman</div>
          </div>
        </div>
        <div class="hero-top-actions">
          <button type="button" class="tool-btn" id="toggle-couple-edit">${
            isEditingCouple ? "Kapat" : "Düzenle"
          }</button>
          <button type="button" class="tool-btn" id="logout-role-btn">Çıkış</button>
        </div>
      </div>

      ${editPanelHtml}

      <div>
        <div class="big-number" id="biz-days-count">${days} Gün</div>
        <div class="sub-metric" id="biz-live-clock">${hours} saat · ${minutes} dakika · ${seconds} saniye</div>
      </div>
    </div>

    <div class="grid-two">
      <div class="card">
        <div class="label">Onun Modu</div>
        <strong>${state.partnerMood}</strong>
        <div class="sub-metric">Mesafe: ${Number(state.distanceKm).toFixed(1)} km</div>
      </div>

      <div class="card">
        <div class="label">Yaklaşan Özel Gün</div>
        <strong>${state.specialEvent.title}</strong>
        <div class="sub-metric">${daysLeft} gün kaldı</div>
      </div>
    </div>

    <div class="card">
      <div class="label">Senin Notun</div>
      <strong>${state.myNote}</strong>
      <div class="mini-row">
        <input
          type="text"
          id="my-note-input"
          class="msg-input plain-input"
          placeholder="Kısa bir not bırak..."
          value="${state.myNote}"
        />
        <button type="button" class="mini-btn" id="save-note-btn">Kaydet</button>
      </div>
    </div>

    <div class="card">
      <div class="label">Modunu Seç</div>
      <div class="mood-grid">
        ${state.moods
          .map(
            (m) => `<button class="nav-btn ${state.partnerMood === m ? "active" : ""}" data-mood="${m}">${m}</button>`
          )
          .join("")}
      </div>
    </div>

    <button class="primary-btn" id="miss-btn">Özledim Sinyali Gönder</button>
    <div id="miss-feedback">
      ${state.lastMissTime ? `<div class="toast">Son sinyal: ${state.lastMissTime}</div>` : ""}
    </div>
  `;

  state.bizClockInterval = setInterval(() => {
    const daysEl = document.getElementById("biz-days-count");
    const clockEl = document.getElementById("biz-live-clock");
    if (!clockEl || !daysEl) {
      clearBizClock();
      return;
    }

    if (syncDailyMissReset()) {
      const myCountEl = document.getElementById("my-miss-count");
      const partnerCountEl = document.getElementById("partner-miss-count");
      if (myCountEl) myCountEl.textContent = "0";
      if (partnerCountEl) partnerCountEl.textContent = "0";
    }

    const t = getElapsedTime();
    daysEl.textContent = `${t.days} Gün`;
    clockEl.textContent = `${t.hours} saat · ${t.minutes} dakika · ${t.seconds} saniye`;
  }, 1000);

  document.getElementById("toggle-couple-edit").addEventListener("click", () => {
    isEditingCouple = !isEditingCouple;
    renderBiz(contentEl);
  });

  document.getElementById("logout-role-btn").addEventListener("click", () => {
    isEditingCouple = false;
    clearDeviceRole();
    renderApp();
    openPasscodeLockOverlay(() => {
      renderApp();
    });
  });

  if (isEditingCouple) {
    document.getElementById("my-avatar-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.myAvatar = reader.result;
        saveState({ pushCloud: true });
        renderBiz(contentEl);
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("partner-avatar-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.partnerAvatar = reader.result;
        saveState({ pushCloud: true });
        renderBiz(contentEl);
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("remove-my-avatar")?.addEventListener("click", () => {
      state.myAvatar = null;
      saveState({ pushCloud: true });
      renderBiz(contentEl);
    });

    document.getElementById("remove-partner-avatar")?.addEventListener("click", () => {
      state.partnerAvatar = null;
      saveState({ pushCloud: true });
      renderBiz(contentEl);
    });

    document.getElementById("cancel-couple-edit").addEventListener("click", () => {
      isEditingCouple = false;
      renderBiz(contentEl);
    });

    document.getElementById("save-couple-edit").addEventListener("click", () => {
      const myVal = document.getElementById("my-name-input").value.trim();
      const partnerVal = document.getElementById("partner-name-input").value.trim();
      const dateVal = document.getElementById("start-date-input").value;
      const eventTitleVal = document.getElementById("special-event-title-input").value.trim();
      const eventDateVal = document.getElementById("special-event-date-input").value;

      if (myVal) state.myName = myVal;
      if (partnerVal) state.partnerName = partnerVal;

      if (dateVal) {
        const parsedDate = new Date(dateVal);
        if (!Number.isNaN(parsedDate.getTime())) {
          state.startDate = parsedDate.toISOString();
        }
      }

      if (!state.specialEvent || typeof state.specialEvent !== "object") {
        state.specialEvent = { title: "Yıldönümü", date: state.startDate };
      }

      if (eventTitleVal) {
        state.specialEvent.title = eventTitleVal;
      }

      if (eventDateVal) {
        const parsedEventDate = new Date(`${eventDateVal}T00:00:00`);
        if (!Number.isNaN(parsedEventDate.getTime())) {
          state.specialEvent.date = parsedEventDate.toISOString();
        }
      }

      isEditingCouple = false;
      saveState({ pushCloud: true });
      renderBiz(contentEl);
      showToast("miss-feedback", "İsimler, fotoğraflar, tarih ve özel gün güncellendi.");
    });
  }

  document.getElementById("save-note-btn").addEventListener("click", () => {
    const val = document.getElementById("my-note-input").value.trim();
    if (!val) return;
    state.myNote = val;
    saveState({ pushCloud: true });
    renderBiz(contentEl);
    showToast("miss-feedback", "Notun güncellendi.");
  });

  document.querySelectorAll("[data-mood]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.partnerMood = btn.dataset.mood;
      saveState({ pushCloud: true });
      renderBiz(contentEl);
      showToast("miss-feedback", `Modun "${state.partnerMood}" olarak güncellendi.`);
    });
  });

  document.getElementById("miss-btn").addEventListener("click", () => {
    syncDailyMissReset();
    state.myMissCount = (state.myMissCount || 0) + 1;
    state.partnerMissCount = state.myMissCount;
    state.missCount = state.myMissCount;
    state.lastMissTime = nowTime();
    saveState({ pushCloud: true });
    renderBiz(contentEl);
    showToast("miss-feedback", `"Seni çok özledim" sinyali gönderildi (${state.lastMissTime}).`);
  });
}
