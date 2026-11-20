import { state, showToast, saveState } from "./state.js";

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
  const photoPreviewHtml = state.pendingMemoryPhoto
    ? `
      <div class="preview-box">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${state.pendingMemoryPhoto}" alt="Anı önizleme" class="preview-thumb" />
          <span class="muted-note">Fotoğraf anıya eklenecek</span>
        </div>
        <button type="button" class="tool-btn" id="clear-memory-photo-btn">Kaldır</button>
      </div>
    `
    : "";

  const memoriesHtml =
    Array.isArray(state.memories) && state.memories.length > 0
      ? state.memories
          .map((item) => {
            const isConfirming = state.confirmDeleteId === item.id;
            const photoHtml = item.photo
              ? `<img src="${item.photo}" alt="${item.title}" class="memory-photo" data-open-memory-photo="${item.photo}" />`
              : "";

            const actionHtml = isConfirming
              ? `
                <div class="confirm-row">
                  <span class="confirm-text">Bu anıyı silmek istediğine emin misin?</span>
                  <button type="button" class="tool-btn" data-cancel-delete="${item.id}">İptal</button>
                  <button type="button" class="danger-btn" data-confirm-delete="${item.id}">Evet, Sil</button>
                </div>
              `
              : `<button type="button" class="delete-memory-btn" data-ask-delete="${item.id}">Sil</button>`;

            return `
              <div class="memory-card" data-memory-id="${item.id}">
                <div class="memory-top">
                  <strong>${item.title}</strong>
                  <span class="memory-date">${item.date}</span>
                </div>
                ${photoHtml}
                <p class="memory-note">${item.note}</p>
                <div class="memory-footer">
                  <span class="memory-author">Ekleyen: ${item.author || state.myName || "Sen"}</span>
                  ${actionHtml}
                </div>
              </div>
            `;
          })
          .join("")
      : `
        <div class="card" style="text-align:center;">
          <div class="label" style="margin-bottom:6px;">Anı Defteri Boş</div>
          <strong>Henüz anı eklenmemiş</strong>
          <p class="muted-note" style="margin-top:6px;">İlk özel anını yukarıdaki alandan ekleyerek burada saklayabilirsin.</p>
        </div>
      `;

  contentEl.innerHTML = `
    <div class="memories-layout">
      <div class="card">
        <div class="label">Yeni Anı Ekle</div>
        <div class="memory-form">
          <input type="text" id="mem-title" class="msg-input plain-input" placeholder="Anı başlığı (Örn: İlk buluşma)" />
          <input type="text" id="mem-date" class="msg-input plain-input" placeholder="Tarih (Örn: 15 Haziran)" />
          <textarea id="mem-note" class="msg-input plain-input memory-textarea" placeholder="Bu anı hakkında kısa bir not yaz..."></textarea>

          <div class="memory-form-actions">
            <label class="tool-btn" style="cursor:pointer;">
              Fotoğraf Ekle
              <input type="file" id="mem-photo-input" accept="image/*" hidden />
            </label>
            <button type="button" class="send-btn" id="add-memory-btn">Anıyı Kaydet</button>
          </div>

          ${photoPreviewHtml}
          <div id="memory-feedback"></div>
        </div>
      </div>

      ${memoriesHtml}
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
    const date = (dateEl?.value || "").trim() || new Date().toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long"
    });
    const note = (noteEl?.value || "").trim();

    if (!title) {
      titleEl?.focus();
      showToast("memory-feedback", "Lütfen anı başlığı gir.");
      return;
    }

    state.memories.unshift({
      id: Date.now() + Math.floor(Math.random() * 100),
      title,
      date,
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
