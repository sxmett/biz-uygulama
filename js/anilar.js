import { state, saveState } from "./state.js";

let activeAnilarLightboxSrc = null;

function openAnilarLightbox(src) {
  if (!src) return;
  activeAnilarLightboxSrc = src;

  document.getElementById("anilar-lightbox-overlay")?.remove();

  let scale = 1;

  const overlay = document.createElement("div");
  overlay.id = "anilar-lightbox-overlay";
  overlay.className = "anilar-lightbox";
  overlay.innerHTML = `
    <div class="anilar-lightbox-bar">
      <span class="status-pill" id="anilar-zoom-pill">100%</span>
      <div class="anilar-lightbox-controls">
        <button type="button" class="anilar-lightbox-btn" id="anilar-zoom-out">-</button>
        <button type="button" class="anilar-lightbox-btn" id="anilar-zoom-reset">1x</button>
        <button type="button" class="anilar-lightbox-btn" id="anilar-zoom-in">+</button>
        <button type="button" class="anilar-lightbox-btn" id="anilar-close-lightbox">Kapat</button>
      </div>
    </div>
    <div class="anilar-lightbox-stage" id="anilar-lightbox-stage">
      <img src="${src}" alt="Anı fotoğrafı" class="anilar-lightbox-img" id="anilar-lightbox-img" />
    </div>
  `;

  document.body.appendChild(overlay);

  const img = document.getElementById("anilar-lightbox-img");
  const stage = document.getElementById("anilar-lightbox-stage");
  const pill = document.getElementById("anilar-zoom-pill");

  const applyScale = (nextScale) => {
    scale = Math.min(4, Math.max(1, Number(nextScale.toFixed(2))));
    img.style.transform = `scale(${scale})`;
    img.classList.toggle("zoomed", scale > 1);
    pill.textContent = `${Math.round(scale * 100)}%`;
  };

  const closeLightbox = () => {
    activeAnilarLightboxSrc = null;
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") closeLightbox();
  };

  document.addEventListener("keydown", onKeyDown);

  document.getElementById("anilar-zoom-in").addEventListener("click", (e) => {
    e.stopPropagation();
    applyScale(scale + 0.5);
  });

  document.getElementById("anilar-zoom-out").addEventListener("click", (e) => {
    e.stopPropagation();
    applyScale(scale - 0.5);
  });

  document.getElementById("anilar-zoom-reset").addEventListener("click", (e) => {
    e.stopPropagation();
    applyScale(1);
  });

  document.getElementById("anilar-close-lightbox").addEventListener("click", closeLightbox);

  stage.addEventListener("click", (e) => {
    if (e.target === stage) closeLightbox();
  });

  img.addEventListener("click", (e) => {
    e.stopPropagation();
    applyScale(scale > 1 ? 1 : 2);
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      applyScale(scale + (e.deltaY < 0 ? 0.25 : -0.25));
    },
    { passive: false }
  );
}

export function renderAnilar(contentEl) {
  const prevTitle = document.getElementById("mem-title")?.value || "";
  const prevNote = document.getElementById("mem-note")?.value || "";

  const photoPreviewHtml = state.pendingMemoryPhoto
    ? `
      <div class="preview-box">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${state.pendingMemoryPhoto}" alt="Anı önizleme" class="preview-thumb" />
          <span class="muted-note">Anı fotoğrafı hazır</span>
        </div>
        <button type="button" class="tool-btn" id="clear-mem-photo">Kaldır</button>
      </div>
    `
    : "";

  const memoriesHtml =
    state.memories.length > 0
      ? state.memories
          .map((m) => {
            const isConfirming = state.confirmDeleteId === m.id;
            const confirmBoxHtml = isConfirming
              ? `
                <div class="confirm-box">
                  <span>Bu anıyı silmek istiyor musun?</span>
                  <div class="confirm-actions">
                    <button type="button" class="call-btn danger" data-confirm-del="${m.id}">Evet, Sil</button>
                    <button type="button" class="tool-btn" data-cancel-del>İptal</button>
                  </div>
                </div>
              `
              : "";

            return `
              <article class="card memory-card">
                <div class="memory-top">
                  <div class="memory-title">${m.title}</div>
                  <span class="status-pill">${m.date}</span>
                </div>
                ${
                  m.photo
                    ? `<img src="${m.photo}" alt="${m.title}" class="memory-photo" data-open-memory-photo="${m.photo}" />`
                    : ""
                }
                <p class="memory-note">${m.note}</p>
                <div class="memory-footer">
                  <span class="memory-author">Ekleyen: ${m.author || state.myName}</span>
                  <button type="button" class="delete-btn" data-ask-del="${m.id}">Sil</button>
                </div>
                ${confirmBoxHtml}
              </article>
            `;
          })
          .join("")
      : `
        <div class="card empty-memories-card">
          <strong>Henüz kayıtlı anı yok</strong>
          <p class="muted-note">İlk anını yukarıdan ekleyerek burayı doldurabilirsin.</p>
        </div>
      `;

  contentEl.innerHTML = `
    <div class="card">
      <div class="loc-card-top">
        <div class="label" style="margin:0;">Yeni Anı</div>
        <span class="status-pill">${state.memories.length} Anı</span>
      </div>

      <div class="form-stack">
        <input
          type="text"
          id="mem-title"
          class="msg-input plain-input"
          placeholder="Başlık (Örn: Gün batımı yürüyüşü)"
        />
        <textarea
          id="mem-note"
          class="msg-input mem-textarea"
          placeholder="Bu anı neden özeldi? Birkaç cümleyle yaz..."
        ></textarea>

        ${photoPreviewHtml}

        <div class="mem-form-footer">
          <label class="tool-btn" style="cursor:pointer;">
            Fotoğraf Ekle
            <input type="file" id="mem-photo-input" accept="image/*" hidden />
          </label>
          <span class="muted-note">Başlık ve not zorunlu</span>
        </div>

        <button type="button" class="primary-btn" id="add-mem-btn">Anıyı Kaydet</button>
      </div>
    </div>

    ${memoriesHtml}
  `;

  if (activeAnilarLightboxSrc) {
    openAnilarLightbox(activeAnilarLightboxSrc);
  }

  document.getElementById("mem-title").value = prevTitle;
  document.getElementById("mem-note").value = prevNote;

  document.querySelectorAll("[data-open-memory-photo]").forEach((photoEl) => {
    photoEl.addEventListener("click", () => {
      openAnilarLightbox(photoEl.dataset.openMemoryPhoto);
    });
  });

  document.getElementById("mem-photo-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingMemoryPhoto = reader.result;
      renderAnilar(contentEl);
    };
    reader.readAsDataURL(file);
  });

  const clearMemPhoto = document.getElementById("clear-mem-photo");
  if (clearMemPhoto) {
    clearMemPhoto.addEventListener("click", () => {
      state.pendingMemoryPhoto = null;
      renderAnilar(contentEl);
    });
  }

  document.getElementById("add-mem-btn").addEventListener("click", () => {
    const titleInput = document.getElementById("mem-title");
    const noteInput = document.getElementById("mem-note");
    const title = titleInput.value.trim();
    const note = noteInput.value.trim();
    if (!title || !note) return;

    state.memories.unshift({
      id: Date.now(),
      title,
      date: new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" }),
      author: state.myName,
      photo: state.pendingMemoryPhoto,
      note
    });

    state.pendingMemoryPhoto = null;
    state.confirmDeleteId = null;
    titleInput.value = "";
    noteInput.value = "";
    saveState();
    renderAnilar(contentEl);
  });

  document.querySelectorAll("[data-ask-del]").forEach((askBtn) => {
    askBtn.addEventListener("click", () => {
      state.confirmDeleteId = Number(askBtn.dataset.askDel);
      renderAnilar(contentEl);
    });
  });

  document.querySelectorAll("[data-confirm-del]").forEach((confBtn) => {
    confBtn.addEventListener("click", () => {
      const id = Number(confBtn.dataset.confirmDel);
      state.memories = state.memories.filter((m) => m.id !== id);
      state.confirmDeleteId = null;
      saveState();
      renderAnilar(contentEl);
    });
  });

  document.querySelectorAll("[data-cancel-del]").forEach((cancBtn) => {
    cancBtn.addEventListener("click", () => {
      state.confirmDeleteId = null;
      renderAnilar(contentEl);
    });
  });
}