import { state, showToast, saveState } from "./state.js";

function getTodayDateInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTurkishDateFromInput(dateStr) {
  if (!dateStr) {
    return new Date().toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    const dt = new Date(year, month, day);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }
  }
  return dateStr;
}

function openMemoryLightbox(src) {
  if (!src) return;
  document.getElementById("memory-lightbox-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "memory-lightbox-overlay";
  overlay.className = "photo-lightbox";
  overlay.innerHTML = `
    <div class="lightbox-bar">
      <span class="status-pill">Anı Fotoğrafı</span>
      <div class="lightbox-controls">
        <button type="button" class="lightbox-btn" id="close-memory-lightbox">Kapat</button>
      </div>
    </div>
    <div class="lightbox-stage" id="memory-lightbox-stage">
      <img src="${src}" alt="Anı fotoğrafı" class="lightbox-img" />
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById("close-memory-lightbox")?.addEventListener("click", close);
  document.getElementById("memory-lightbox-stage")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) close();
  });
}

export function renderAnilar(contentEl) {
  const defaultDateVal = getTodayDateInputValue();

  const photoPreviewHtml = state.pendingMemoryPhoto
    ? `
      <div class="anilar-preview-box">
        <div class="anilar-preview-left">
          <img src="${state.pendingMemoryPhoto}" alt="Anı önizleme" class="anilar-preview-thumb" />
          <span class="anilar-preview-text">Fotoğraf anıya eklenecek</span>
        </div>
        <button type="button" class="anilar-ghost-btn" id="clear-memory-photo-btn">Kaldır</button>
      </div>
    `
    : "";

  const memoriesHtml =
    Array.isArray(state.memories) && state.memories.length > 0
      ? state.memories
          .map((item) => {
            const isConfirming = state.confirmDeleteId === item.id;
            const photoHtml = item.photo
              ? `<img src="${item.photo}" alt="${item.title}" class="anilar-card-photo" data-open-memory-photo="${item.photo}" />`
              : "";

            const actionHtml = isConfirming
              ? `
                <div class="anilar-confirm-box">
                  <span class="anilar-confirm-text">Bu anıyı silmek istediğine emin misin?</span>
                  <div class="anilar-confirm-actions">
                    <button type="button" class="anilar-ghost-btn" data-cancel-delete="${item.id}">İptal</button>
                    <button type="button" class="anilar-danger-btn" data-confirm-delete="${item.id}">Evet, Sil</button>
                  </div>
                </div>
              `
              : `<button type="button" class="anilar-delete-btn" data-ask-delete="${item.id}">Sil</button>`;

            return `
              <article class="anilar-item-card" data-memory-id="${item.id}">
                <div class="anilar-item-header">
                  <strong class="anilar-item-title">${item.title}</strong>
                  <span class="anilar-item-date">${item.date}</span>
                </div>
                ${photoHtml}
                <p class="anilar-item-note">${item.note}</p>
                <div class="anilar-item-footer">
                  <span class="anilar-item-author">Ekleyen: ${item.author || state.myName || "Sen"}</span>
                  ${actionHtml}
                </div>
              </article>
            `;
          })
          .join("")
      : `
        <div class="anilar-empty-card">
          <span class="anilar-empty-badge">Anı Defteri</span>
          <h3 class="anilar-empty-title">Henüz anı eklenmemiş</h3>
          <p class="anilar-empty-desc">İlk özel anını yukarıdaki alandan ekleyerek burada güzel bir koleksiyon oluşturabilirsin.</p>
        </div>
      `;

  contentEl.innerHTML = `
    <div class="anilar-page">
      <section class="anilar-form-card">
        <div class="anilar-section-title">Yeni Anı Ekle</div>

        <div class="anilar-form-stack">
          <div class="anilar-field">
            <label for="mem-title" class="anilar-field-label">Anı Başlığı</label>
            <input
              type="text"
              id="mem-title"
              class="anilar-input"
              placeholder="Örn: İlk kahve buluşması"
            />
          </div>

          <div class="anilar-field">
            <label for="mem-date" class="anilar-field-label">Tarih Seç</label>
            <input
              type="date"
              id="mem-date"
              class="anilar-input anilar-date-input"
              value="${defaultDateVal}"
            />
          </div>

          <div class="anilar-field">
            <label for="mem-note" class="anilar-field-label">Notun</label>
            <textarea
              id="mem-note"
              class="anilar-textarea"
              placeholder="Bu anı hakkında kısa bir not yaz..."
            ></textarea>
          </div>

          <div class="anilar-actions-row">
            <label class="anilar-secondary-btn" style="cursor:pointer;">
              Fotoğraf Seç
              <input type="file" id="mem-photo-input" accept="image/*" hidden />
            </label>
            <button type="button" class="anilar-primary-btn" id="add-memory-btn">Anıyı Kaydet</button>
          </div>

          ${photoPreviewHtml}
          <div id="memory-feedback"></div>
        </div>
      </section>

      <section class="anilar-list-section">
        ${memoriesHtml}
      </section>
    </div>
  `;

  document.getElementById("mem-photo-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingMemoryPhoto = reader.result;
      renderAnilar(contentEl);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("clear-memory-photo-btn")?.addEventListener("click", () => {
    state.pendingMemoryPhoto = null;
    renderAnilar(contentEl);
  });

  document.getElementById("add-memory-btn")?.addEventListener("click", () => {
    const titleEl = document.getElementById("mem-title");
    const dateEl = document.getElementById("mem-date");
    const noteEl = document.getElementById("mem-note");

    const title = (titleEl?.value || "").trim();
    const formattedDate = formatTurkishDateFromInput(dateEl?.value || "");
    const note = (noteEl?.value || "").trim();

    if (!title) {
      titleEl?.focus();
      showToast("memory-feedback", "Lütfen bir anı başlığı gir.");
      return;
    }

    state.memories.unshift({
      id: Date.now() + Math.floor(Math.random() * 100),
      title,
      date: formattedDate,
      author: state.myName || "Sen",
      photo: state.pendingMemoryPhoto || null,
      note: note || "Özel bir an."
    });

    state.pendingMemoryPhoto = null;
    state.confirmDeleteId = null;
    saveState({ pushCloud: true });
    renderAnilar(contentEl);
    showToast("memory-feedback", "Yeni anı kaydedildi.");
  });

  document.querySelectorAll("[data-open-memory-photo]").forEach((imgEl) => {
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openMemoryLightbox(imgEl.dataset.openMemoryPhoto);
    });
  });

  document.querySelectorAll("[data-ask-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.confirmDeleteId = Number(btn.dataset.askDelete);
      renderAnilar(contentEl);
    });
  });

  document.querySelectorAll("[data-cancel-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.confirmDeleteId = null;
      renderAnilar(contentEl);
    });
  });

  document.querySelectorAll("[data-confirm-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = Number(btn.dataset.confirmDelete);
      state.memories = state.memories.filter((m) => m.id !== targetId);
      state.confirmDeleteId = null;
      saveState({ pushCloud: true });
      renderAnilar(contentEl);
      showToast("memory-feedback", "Anı silindi.");
    });
  });
}
