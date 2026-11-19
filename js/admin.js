import {
  state,
  buildPersistPayload,
  applyImportedBackup,
  resetAllPersistedData,
  saveState,
  setAdminOwner,
  showToast
} from "./state.js";

let pendingAction = null; // { type, question, backupData?, fileName? }

function clearAdminHashFromUrl() {
  if (window.location.hash === "#admin-owner") {
    try {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    } catch {
      window.location.hash = "";
    }
  }
}

function downloadJsonBackup() {
  const backupEnvelope = {
    app: "biz_dashboard",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: buildPersistPayload()
  };

  const jsonStr = JSON.stringify(backupEnvelope, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `biz-yedek-${dateStamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderAdmin(contentEl, onTabChange) {
  if (!state.isAdminOwner) {
    state.activeTab = "biz";
    onTabChange?.("biz");
    return;
  }

  const confirmCardHtml = pendingAction
    ? `
      <div class="card" style="border-color: var(--accent);">
        <div class="label" style="color: var(--accent);">Onay Sorusu</div>
        <p style="margin: 8px 0 14px; font-weight: 700;">${pendingAction.question}</p>
        <div class="mini-row" style="justify-content: flex-end;">
          <button type="button" class="tool-btn" id="admin-cancel-btn">Hayır, İptal Et</button>
          <button type="button" class="call-btn danger" id="admin-confirm-btn">Evet, Onaylıyorum</button>
        </div>
      </div>
    `
    : "";

  contentEl.innerHTML = `
    <div class="card">
      <div class="loc-card-top">
        <div class="label" style="margin:0;">Admin Paneli</div>
        <span class="status-pill">Yalnızca Sen</span>
      </div>
      <p class="muted-note">
        Bu sekme yalnızca senin ekranında görünür. Her işlem öncesi onay istenir.
      </p>
      <div id="admin-feedback" style="margin-top:10px;"></div>
    </div>

    ${confirmCardHtml}

    <div class="card">
      <div class="label">Yedekleme ve Geri Yükleme</div>
      <div class="loc-actions">
        <button type="button" class="call-btn" id="export-backup-btn">Yedek Al (JSON)</button>
        <label class="tool-btn" style="cursor:pointer;">
          Yedekten Geri Yükle
          <input type="file" id="import-backup-input" accept="application/json,.json" hidden />
        </label>
      </div>
    </div>

    <div class="card">
      <div class="label">Veri Yönetimi</div>
      <div class="loc-actions">
        <button type="button" class="tool-btn" id="ask-clear-chat">Sohbeti Temizle</button>
        <button type="button" class="tool-btn" id="ask-clear-memories">Anıları Temizle</button>
        <button type="button" class="call-btn danger" id="ask-reset-all">Tüm Verileri Sıfırla</button>
      </div>
    </div>

    <div class="card">
      <div class="label">Cihaz Yetkisi</div>
      <div class="loc-actions">
        <button type="button" class="tool-btn" id="ask-disable-admin">Bu Cihazda Admin Sekmesini Kapat</button>
      </div>
    </div>
  `;

  document.getElementById("export-backup-btn").addEventListener("click", () => {
    downloadJsonBackup();
    showToast("admin-feedback", "JSON yedek dosyası indirildi.");
  });

  document.getElementById("import-backup-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const isValid =
          parsed &&
          typeof parsed === "object" &&
          (Array.isArray(parsed.messages) ||
            Array.isArray(parsed.memories) ||
            (parsed.data &&
              typeof parsed.data === "object" &&
              (Array.isArray(parsed.data.messages) || Array.isArray(parsed.data.memories))));

        if (!isValid) {
          showToast("admin-feedback", "Seçilen dosya geçerli bir yedek değil.");
          return;
        }

        pendingAction = {
          type: "restore_backup",
          backupData: parsed,
          fileName: file.name,
          question: `Bu eylemi onaylıyor musunuz? "${file.name}" yedeğindeki veriler mevcut verilerin üzerine yazılacak.`
        };
        renderAdmin(contentEl, onTabChange);
      } catch {
        showToast("admin-feedback", "JSON dosyası okunamadı veya bozuk.");
      }
    };
    reader.readAsText(file, "utf-8");
  });

  document.getElementById("ask-clear-chat").addEventListener("click", () => {
    pendingAction = {
      type: "clear_chat",
      question: "Bu eylemi onaylıyor musunuz? Tüm sohbet mesajları silinecek."
    };
    renderAdmin(contentEl, onTabChange);
  });

  document.getElementById("ask-clear-memories").addEventListener("click", () => {
    pendingAction = {
      type: "clear_memories",
      question: "Bu eylemi onaylıyor musunuz? Kayıtlı tüm anılar silinecek."
    };
    renderAdmin(contentEl, onTabChange);
  });

  document.getElementById("ask-reset-all").addEventListener("click", () => {
    pendingAction = {
      type: "reset_all",
      question: "Bu eylemi onaylıyor musunuz? Tüm veriler ve ayarlar varsayılana sıfırlanacak."
    };
    renderAdmin(contentEl, onTabChange);
  });

  document.getElementById("ask-disable-admin").addEventListener("click", () => {
    pendingAction = {
      type: "disable_admin",
      question: "Bu eylemi onaylıyor musunuz? Bu tarayıcıda Admin sekmesi kapatılacak."
    };
    renderAdmin(contentEl, onTabChange);
  });

  document.getElementById("admin-cancel-btn")?.addEventListener("click", () => {
    pendingAction = null;
    renderAdmin(contentEl, onTabChange);
  });

  document.getElementById("admin-confirm-btn")?.addEventListener("click", () => {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = null;

    if (action.type === "restore_backup") {
      try {
        const savedOk = applyImportedBackup(action.backupData);
        renderAdmin(contentEl, onTabChange);
        showToast(
          "admin-feedback",
          savedOk
            ? `"${action.fileName}" yedeği başarıyla geri yüklendi.`
            : "Yedek belleğe yazıldı ancak depolama sınırına yaklaşıldı."
        );
      } catch {
        renderAdmin(contentEl, onTabChange);
        showToast("admin-feedback", "Yedek geri yüklenirken bir hata oluştu.");
      }
      return;
    }

    if (action.type === "clear_chat") {
      state.messages = [];
      saveState();
      renderAdmin(contentEl, onTabChange);
      showToast("admin-feedback", "Sohbet mesajları temizlendi.");
      return;
    }

    if (action.type === "clear_memories") {
      state.memories = [];
      state.confirmDeleteId = null;
      saveState();
      renderAdmin(contentEl, onTabChange);
      showToast("admin-feedback", "Tüm anılar temizlendi.");
      return;
    }

    if (action.type === "reset_all") {
      resetAllPersistedData();
      renderAdmin(contentEl, onTabChange);
      showToast("admin-feedback", "Tüm veriler varsayılana sıfırlandı.");
      return;
    }

    if (action.type === "disable_admin") {
      setAdminOwner(false);
      clearAdminHashFromUrl();
      state.activeTab = "biz";
      onTabChange?.("biz");
    }
  });
}