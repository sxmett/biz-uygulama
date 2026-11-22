import {
  state,
  nowTime,
  getLocalDayKey,
  saveState,
  getDeviceRole,
  getPartnerRole,
  setMyTypingStatus,
  isPartnerTyping,
  requestMediaPermissionSafe,
  openGalleryLightbox,
  writeCallSignal,
  initCallSignalListener
} from "./state.js";
import { dispatchNotificationEvent } from "./notifications.js";

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉",
  "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲",
  "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🫢", "🫣",
  "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "🫥", "😏",
  "😒", "🙄", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷",
  "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "🤠",
  "🥳", "🥸", "😎", "🤓", "🧐", "😕", "🫤", "😟", "🙁", "☹️",
  "😮", "😯", "😲", "😳", "🥺", "🥹", "😦", "😧", "😨", "😰",
  "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫",
  "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "💩", "🤡",
  "❤️", "🩷", "🧡", "💛", "💚", "💙", "💜", "🖤", "🩶", "🤍",
  "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💖", "💗", "💓", "💞", "💕", "💌",
  "💘", "💝", "💟", "🫶", "👍", "👎", "👏", "🙌", "👐", "🤲",
  "🤝", "🙏", "✌️", "🤞", "🫰", "🤟", "🤘", "👌", "🤌", "🤏",
  "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋",
  "🤙", "💪", "💋", "🌹", "🌷", "🌸", "🌺", "🌻", "✨", "⭐",
  "🌟", "💫", "🔥", "🎉", "🎊", "🥂", "☕", "🍓", "🍫", "🌙"
];

const QUICK_REACTIONS = ["❤️", "😂", "😍", "🥺", "🔥"];
const RING_TIMEOUT_SECONDS = 60;

let callStream = null;
let callPhase = null;
let callDirection = null;
let currentCallId = null;
let ringSecondsLeft = RING_TIMEOUT_SECONDS;
let ringTimer = null;
let isStartingCall = false;
let micMuted = false;
let camOff = false;
let callErrorMsg = "";
let replyingToMsgId = null;
let typingStopTimeout = null;
let handledSignalKey = "";
let activeAudioPlayer = null;
let activeAudioBtn = null;

let peerModalOpen = false;
let peerModalTab = "search";
let peerSearchQuery = "";

function formatWhatsAppDateLabel(dateKey) {
  const safeKey = dateKey || getLocalDayKey();
  const [yStr, mStr, dStr] = safeKey.split("-");
  const year = Number(yStr);
  const month = Number(mStr) - 1;
  const day = Number(dStr);
  const targetDate = new Date(year, month, day);
  if (Number.isNaN(targetDate.getTime())) return "Bugün";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = targetDate.getTime();
  const diffDays = Math.round((todayStart - targetStart) / 86400000);

  if (diffDays <= 0) return "Bugün";
  if (diffDays === 1) return "Dün";
  if (diffDays > 1 && diffDays < 7) {
    const weekdayNames = [
      "Pazar",
      "Pazartesi",
      "Salı",
      "Çarşamba",
      "Perşembe",
      "Cuma",
      "Cumartesi"
    ];
    return weekdayNames[targetDate.getDay()];
  }

  const dd = String(day).padStart(2, "0");
  const mm = String(month + 1).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

function getPresenceMeta() {
  if (isPartnerTyping()) {
    return {
      text: "Yazıyor...",
      className: "peer-presence-text typing"
    };
  }

  if (state.partnerOnline) {
    return {
      text: "Çevrimiçi",
      className: "peer-presence-text online"
    };
  }

  const lastSeenText =
    state.partnerLastSeen && state.partnerLastSeen !== "Henüz görülmedi"
      ? `Son görülme: ${state.partnerLastSeen}`
      : "Çevrimdışı";

  return {
    text: lastSeenText,
    className: "peer-presence-text"
  };
}

export function refreshChatHeaderPresenceOnly() {
  const subEl = document.getElementById("peer-live-sub");
  if (!subEl) return;
  const presence = getPresenceMeta();
  subEl.textContent = presence.text;
  subEl.className = presence.className;
}

export function markIncomingMessagesAsRead() {
  let updated = false;
  state.messages.forEach((msg) => {
    if (msg.sender === "them" && msg.status !== "read") {
      msg.status = "read";
      updated = true;
    }
  });
  if (updated) {
    saveState({ pushCloud: true });
  }
}

function formatCallTime(totalSec) {
  const safeSec = Math.max(0, Math.floor(totalSec));
  const mins = String(Math.floor(safeSec / 60)).padStart(2, "0");
  const secs = String(safeSec % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function addSystemCallNotice(text) {
  const now = Date.now();
  state.messages.push({
    id: now + Math.floor(Math.random() * 100),
    sender: "me",
    authorRole: getDeviceRole() || "userA",
    type: "call",
    text,
    time: nowTime(),
    createdAt: now,
    dateKey: getLocalDayKey(new Date(now)),
    status: "read",
    reaction: null
  });
  saveState({ pushCloud: true });
}

function appendCallLogMessage(mode, seconds, status = "ended") {
  const callLabel = mode === "video" ? "Görüntülü arama" : "Sesli arama";
  const text =
    status === "missed"
      ? `${callLabel} · Yanıtlanmadı`
      : status === "rejected"
      ? `${callLabel} · Reddedildi`
      : `${callLabel} · ${formatCallTime(seconds)} konuşuldu`;

  addSystemCallNotice(text);
}

function stopRingTimerOnly() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}

function stopConversationTimerOnly() {
  if (state.callTimer) {
    clearInterval(state.callTimer);
    state.callTimer = null;
  }
}

function stopCallMediaAndTimers() {
  stopRingTimerOnly();
  stopConversationTimerOnly();
  if (callStream) {
    callStream.getTracks().forEach((track) => track.stop());
    callStream = null;
  }
  state.callSeconds = 0;
  ringSecondsLeft = RING_TIMEOUT_SECONDS;
  callPhase = null;
  callDirection = null;
  currentCallId = null;
  micMuted = false;
  camOff = false;
}

function beginCallConversationTimer(contentEl) {
  stopRingTimerOnly();
  stopConversationTimerOnly();
  callPhase = "connected";
  state.callSeconds = 0;
  if (contentEl && state.activeTab === "sohbet") {
    renderSohbet(contentEl, false, { scrollToBottom: false, preserveScroll: true });
  }

  state.callTimer = setInterval(() => {
    state.callSeconds += 1;
    const durEl = document.getElementById("call-duration");
    if (durEl) {
      durEl.textContent = `Süre: ${formatCallTime(state.callSeconds)}${
        micMuted ? " · Mikrofon kapalı" : ""
      }`;
    }
  }, 1000);
}

function startRingingCountdown(contentEl, mode, callId) {
  stopRingTimerOnly();
  ringSecondsLeft = RING_TIMEOUT_SECONDS;

  ringTimer = setInterval(() => {
    ringSecondsLeft -= 1;
    const durEl = document.getElementById("call-duration");
    if (durEl && callPhase === "ringing") {
      durEl.textContent = `${state.partnerName || "Emine"} aranıyor... (${formatCallTime(
        ringSecondsLeft
      )})`;
    }

    const incSub = document.getElementById("incoming-call-sub");
    if (incSub && callPhase === "ringing") {
      incSub.textContent = `Seni ${mode === "video" ? "görüntülü" : "sesli"} arıyor... (${formatCallTime(
        ringSecondsLeft
      )})`;
    }

    if (ringSecondsLeft <= 0) {
      const myRole = getDeviceRole() || "userA";
      const partnerRole = getPartnerRole(myRole);
      stopCallMediaAndTimers();
      state.callMode = null;
      writeCallSignal({
        callId,
        callerRole: callDirection === "outgoing" ? myRole : partnerRole,
        calleeRole: callDirection === "outgoing" ? partnerRole : myRole,
        mode,
        status: "missed",
        updatedAt: Date.now()
      });
      if (callDirection === "outgoing") {
        appendCallLogMessage(mode, 0, "missed");
      }
      if (contentEl && state.activeTab === "sohbet") {
        renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
      }
    }
  }, 1000);
}

export function handleIncomingCallSignal(signal, contentEl) {
  const myRole = getDeviceRole();
  if (!myRole || !signal || typeof signal !== "object") return;

  const { callId, callerRole, calleeRole, mode, status, updatedAt } = signal;
  if (!callId || !mode || !status) return;

  const sigKey = `${callId}:${status}:${updatedAt || 0}`;
  if (handledSignalKey === sigKey) return;

  if (status === "ringing") {
    if (calleeRole === myRole && !state.callMode) {
      handledSignalKey = sigKey;
      state.callMode = mode;
      callPhase = "ringing";
      callDirection = "incoming";
      currentCallId = callId;
      state.activeTab = "sohbet";
      if (contentEl) {
        renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
        startRingingCountdown(contentEl, mode, callId);
      }
    }
    return;
  }

  if (status === "accepted") {
    if ((callerRole === myRole || calleeRole === myRole) && currentCallId === callId) {
      handledSignalKey = sigKey;
      beginCallConversationTimer(contentEl);
    }
    return;
  }

  if (status === "ended" || status === "rejected" || status === "missed") {
    if ((callerRole === myRole || calleeRole === myRole) && (currentCallId === callId || state.callMode)) {
      handledSignalKey = sigKey;
      const finishedMode = state.callMode || mode;
      const wasConnected = callPhase === "connected";
      const elapsed = state.callSeconds;
      stopCallMediaAndTimers();
      state.callMode = null;
      if (callerRole === myRole) {
        appendCallLogMessage(
          finishedMode,
          wasConnected ? elapsed : 0,
          status === "rejected" ? "rejected" : wasConnected ? "ended" : "missed"
        );
      }
      if (contentEl && state.activeTab === "sohbet") {
        renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
      }
    }
  }
}

function attachStreamToVideoEl() {
  const videoEl = document.getElementById("call-local-video");
  if (!videoEl) return;
  videoEl.srcObject = callStream && !camOff && state.callMode === "video" ? callStream : null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getSenderLabel(sender) {
  return sender === "me" ? state.myName || "Samet" : state.partnerName || "Emine";
}

function getMessagePreviewText(msg) {
  if (!msg) return "";
  if (msg.type === "text") return msg.text || "Mesaj";
  if (msg.type === "image") return msg.text ? `📷 ${msg.text}` : "📷 Fotoğraf";
  if (msg.type === "audio") return "🎤 Ses kaydı";
  if (msg.type === "call") return `📞 ${msg.text}`;
  return "Mesaj";
}

function buildReplyPayload(replyMsg) {
  if (!replyMsg) return null;
  return {
    id: replyMsg.id,
    author: getSenderLabel(replyMsg.sender),
    text: getMessagePreviewText(replyMsg)
  };
}

function scrollToAndHighlightMessage(msgId) {
  const bubble = document.querySelector(`[data-msg-bubble="${msgId}"]`);
  if (!bubble) return;
  bubble.scrollIntoView({ behavior: "smooth", block: "center" });
  bubble.classList.add("highlighted-flash");
  setTimeout(() => bubble.classList.remove("highlighted-flash"), 1400);
}

function renderReceipt(msg) {
  if (msg.sender !== "me") return "";

  if (msg.status === "read") {
    return `
      <svg class="tick-svg read" style="color:#38bdf8;" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" title="Okundu">
        <path d="M2 8.5L6.5 13L15 3.5" />
        <path d="M8.5 8.5L13 13L21.5 3.5" />
      </svg>
    `;
  }

  if (msg.status === "delivered") {
    return `
      <svg class="tick-svg delivered" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" title="İletildi">
        <path d="M2 8.5L6.5 13L15 3.5" />
        <path d="M8.5 8.5L13 13L21.5 3.5" />
      </svg>
    `;
  }

  return `
    <svg class="tick-svg sent" viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" title="Gönderildi">
      <path d="M3 8.5L7.5 13L17 3.5" />
    </svg>
  `;
}

function renderCustomAudioBubble(src, msgId) {
  if (!src) return `<span class="muted-note">Ses kaydı bulunamadı</span>`;
  return `
    <div class="wa-audio-player" data-audio-player="${msgId}">
      <button type="button" class="wa-audio-play-btn" data-audio-toggle="${msgId}" aria-label="Oynat">▶</button>
      <div class="wa-audio-track-col">
        <input type="range" min="0" max="100" value="0" class="wa-audio-slider" data-audio-seek="${msgId}" />
        <span class="wa-audio-time" data-audio-time="${msgId}">00:00</span>
      </div>
      <audio preload="metadata" src="${src}" data-audio-el="${msgId}" hidden></audio>
    </div>
  `;
}

function bindCustomAudioPlayers(container) {
  container.querySelectorAll("[data-audio-player]").forEach((playerEl) => {
    const id = playerEl.dataset.audioPlayer;
    const audioEl = container.querySelector(`[data-audio-el="${id}"]`);
    const playBtn = container.querySelector(`[data-audio-toggle="${id}"]`);
    const sliderEl = container.querySelector(`[data-audio-seek="${id}"]`);
    const timeEl = container.querySelector(`[data-audio-time="${id}"]`);
    if (!audioEl || !playBtn || !sliderEl || !timeEl) return;

    const updateDurationLabel = () => {
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        const cur = audioEl.currentTime > 0 ? audioEl.currentTime : audioEl.duration;
        timeEl.textContent = formatCallTime(cur);
      }
    };

    audioEl.addEventListener("loadedmetadata", updateDurationLabel);
    audioEl.addEventListener("durationchange", updateDurationLabel);

    audioEl.addEventListener("timeupdate", () => {
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        sliderEl.value = String(Math.min(100, (audioEl.currentTime / audioEl.duration) * 100));
      }
      timeEl.textContent = formatCallTime(audioEl.currentTime);
    });

    audioEl.addEventListener("ended", () => {
      playBtn.textContent = "▶";
      sliderEl.value = "0";
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        timeEl.textContent = formatCallTime(audioEl.duration);
      } else {
        timeEl.textContent = "00:00";
      }
    });

    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (activeAudioPlayer && activeAudioPlayer !== audioEl) {
        activeAudioPlayer.pause();
        if (activeAudioBtn) activeAudioBtn.textContent = "▶";
      }

      if (audioEl.paused) {
        activeAudioPlayer = audioEl;
        activeAudioBtn = playBtn;
        playBtn.textContent = "❚❚";
        audioEl.play().catch(() => {
          playBtn.textContent = "▶";
        });
      } else {
        audioEl.pause();
        playBtn.textContent = "▶";
      }
    });

    sliderEl.addEventListener("click", (e) => e.stopPropagation());
    sliderEl.addEventListener("input", () => {
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        audioEl.currentTime = (Number(sliderEl.value) / 100) * audioEl.duration;
        timeEl.textContent = formatCallTime(audioEl.currentTime);
      }
    });
  });
}

function openChatPreviewOnly() {
  if (!state.pendingPhoto) return;
  openGalleryLightbox(
    [{ src: state.pendingPhoto, title: "Sohbet fotoğraf önizlemesi" }],
    0
  );
}

function openSentChatPhotosGallery(clickedSrc) {
  const sentPhotos = state.messages
    .filter((m) => m.type === "image" && m.src)
    .map((m) => ({
      src: m.src,
      title: m.text || `Sohbet fotoğrafı · ${m.time || ""}`
    }));

  if (sentPhotos.length === 0) return;

  const idx = Math.max(
    0,
    sentPhotos.findIndex((item) => item.src === clickedSrc)
  );
  openGalleryLightbox(sentPhotos, idx);
}

function buildSearchResultsHtml(query) {
  const q = query.trim().toLowerCase();
  const candidates = state.messages.filter((m) => m.type !== "call");
  const matches = q
    ? candidates.filter((m) => getMessagePreviewText(m).toLowerCase().includes(q))
    : candidates.slice(-8).reverse();

  if (matches.length === 0) {
    return `<p class="muted-note">Eşleşen mesaj bulunamadı.</p>`;
  }

  return matches
    .map(
      (msg) => `
        <button type="button" class="peer-search-item" data-jump-msg="${msg.id}">
          <div class="peer-search-meta">
            <span>${getSenderLabel(msg.sender)}</span>
            <span>${msg.time}</span>
          </div>
          <div class="peer-search-snippet">${getMessagePreviewText(msg)}</div>
        </button>
      `
    )
    .join("");
}

function buildMediaContentHtml() {
  const photos = state.messages.filter((m) => m.type === "image" && m.src);
  const audios = state.messages.filter((m) => m.type === "audio" && m.src);

  const photoGridHtml =
    photos.length > 0
      ? `
        <div class="peer-media-grid">
          ${photos
            .map(
              (p) =>
                `<img src="${p.src}" alt="Paylaşılan fotoğraf" class="peer-media-thumb" data-open-media-photo="${p.src}" />`
            )
            .join("")}
        </div>
      `
      : `<p class="muted-note">Henüz fotoğraf paylaşılmamış.</p>`;

  const audioListHtml =
    audios.length > 0
      ? `
        <div class="peer-audio-list">
          ${audios
            .map(
              (a) => `
                <div class="peer-audio-row">
                  <div class="peer-search-meta">
                    <span>${getSenderLabel(a.sender)} · Ses kaydı</span>
                    <span>${a.time}</span>
                  </div>
                  ${renderCustomAudioBubble(a.src, `modal_${a.id}`)}
                </div>
              `
            )
            .join("")}
        </div>
      `
      : "";

  return `
    <div class="label" style="margin:0;">Fotoğraflar (${photos.length})</div>
    ${photoGridHtml}
    ${audios.length > 0 ? `<div class="label" style="margin:6px 0 0;">Ses Kayıtları (${audios.length})</div>${audioListHtml}` : ""}
  `;
}

function openPeerInfoModal(contentEl) {
  peerModalOpen = true;
  renderPeerInfoModal(contentEl);
}

function closePeerInfoModal() {
  peerModalOpen = false;
  document.getElementById("peer-info-modal")?.remove();
  document.removeEventListener("keydown", handlePeerModalEsc);
}

function handlePeerModalEsc(e) {
  if (e.key === "Escape") {
    closePeerInfoModal();
  }
}

function renderPeerInfoModal(contentEl) {
  if (!peerModalOpen) return;

  const partnerLabel = state.partnerName || "Emine";
  const bodyHtml =
    peerModalTab === "search"
      ? `
        <input
          type="text"
          id="peer-msg-search-input"
          class="msg-input plain-input"
          placeholder="Mesajlarda kelime ara..."
          value="${peerSearchQuery.replace(/"/g, "&quot;")}"
        />
        <div class="peer-search-results" id="peer-search-results">
          ${buildSearchResultsHtml(peerSearchQuery)}
        </div>
      `
      : buildMediaContentHtml();

  document.getElementById("peer-info-modal")?.remove();
  document.removeEventListener("keydown", handlePeerModalEsc);

  const modal = document.createElement("div");
  modal.id = "peer-info-modal";
  modal.className = "peer-sheet-backdrop";
  modal.innerHTML = `
    <div class="peer-sheet-card" role="dialog" aria-modal="true">
      <div class="peer-sheet-top">
        <span class="peer-sheet-title">${partnerLabel}</span>
        <button type="button" class="tool-btn" id="close-peer-modal-btn">✕</button>
      </div>

      <div class="peer-sheet-tabs">
        <button
          type="button"
          class="peer-sheet-tab ${peerModalTab === "search" ? "active" : ""}"
          id="peer-tab-search"
        >Mesaj Ara</button>
        <button
          type="button"
          class="peer-sheet-tab ${peerModalTab === "media" ? "active" : ""}"
          id="peer-tab-media"
        >Medya</button>
      </div>

      <div id="peer-modal-body">${bodyHtml}</div>
    </div>
  `;

  document.body.appendChild(modal);
  document.addEventListener("keydown", handlePeerModalEsc);

  if (peerModalTab === "media") {
    bindCustomAudioPlayers(modal);
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closePeerInfoModal();
  });

  document.getElementById("close-peer-modal-btn").addEventListener("click", closePeerInfoModal);

  document.getElementById("peer-tab-search").addEventListener("click", () => {
    peerModalTab = "search";
    renderPeerInfoModal(contentEl);
  });

  document.getElementById("peer-tab-media").addEventListener("click", () => {
    peerModalTab = "media";
    renderPeerInfoModal(contentEl);
  });

  const bindDynamicModalActions = () => {
    document.querySelectorAll("[data-jump-msg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = Number(btn.dataset.jumpMsg);
        closePeerInfoModal();
        scrollToAndHighlightMessage(targetId);
      });
    });

    document.querySelectorAll("[data-open-media-photo]").forEach((imgEl) => {
      imgEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openSentChatPhotosGallery(imgEl.dataset.openMediaPhoto);
      });
    });
  };

  bindDynamicModalActions();

  const searchInput = document.getElementById("peer-msg-search-input");
  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.addEventListener("input", () => {
      peerSearchQuery = searchInput.value;
      const resultsEl = document.getElementById("peer-search-results");
      if (resultsEl) {
        resultsEl.innerHTML = buildSearchResultsHtml(peerSearchQuery);
        bindDynamicModalActions();
      }
    });
  }
}

export function renderSohbet(
  contentEl,
  focusInputAfterRender = false,
  scrollOpts = { scrollToBottom: true, preserveScroll: false }
) {
  markIncomingMessagesAsRead();

  const prevInput = document.getElementById("msg-input");
  const draftText = prevInput ? prevInput.value : "";
  const prevPanel = document.getElementById("messages-panel");
  const prevScrollTop = prevPanel ? prevPanel.scrollTop : 0;

  const partnerLabel = state.partnerName || "Emine";
  const presence = getPresenceMeta();
  const todayKey = getLocalDayKey();

  const messagesHtml =
    state.messages.length > 0
      ? state.messages
          .map((msg) => {
            const msgDateKey = msg.dateKey || getLocalDayKey(new Date(msg.createdAt || msg.id || Date.now()));
            const dateAttr = `data-msg-date="${msgDateKey}"`;

            if (msg.type === "call") {
              return `
                <div class="call-log-item" ${dateAttr}>
                  <strong>${msg.text}</strong>
                  <span class="call-log-time">${msg.time}</span>
                </div>
              `;
            }

            let body = "";
            if (msg.type === "text") {
              body = `<span>${msg.text}</span>`;
            } else if (msg.type === "image") {
              body = `<img src="${msg.src}" alt="Gönderilen fotoğraf" class="msg-photo" style="cursor:pointer;" data-open-photo="${msg.src}" />${
                msg.text ? `<span>${msg.text}</span>` : ""
              }`;
            } else if (msg.type === "audio") {
              body = renderCustomAudioBubble(msg.src, `chat_${msg.id}`);
            }

            const replyQuoteHtml = msg.replyTo
              ? `
                <div class="msg-reply-quote">
                  <span class="msg-reply-author">${msg.replyTo.author}</span>
                  <span class="msg-reply-text">${msg.replyTo.text}</span>
                </div>
              `
              : "";

            const showPicker = state.activeReactionMsgId === msg.id;
            const popoverHtml = showPicker
              ? `
                <div class="reaction-popover" data-reaction-box="${msg.id}">
                  ${QUICK_REACTIONS.map(
                    (em) =>
                      `<button type="button" class="reaction-pick-btn ${
                        msg.reaction === em ? "active" : ""
                      }" data-react="${msg.id}|${em}">${em}</button>`
                  ).join("")}
                  <button type="button" class="reply-action-btn" data-reply-msg="${msg.id}">Yanıtla</button>
                </div>
              `
              : "";

            return `
              <div class="msg-wrap ${msg.sender}" data-msg-wrap="${msg.id}" ${dateAttr}>
                <div class="msg ${msg.sender}" data-msg-bubble="${msg.id}">
                  ${replyQuoteHtml}
                  ${body}
                  <div class="msg-meta-row">
                    <span>${msg.time}</span>
                    ${renderReceipt(msg)}
                  </div>
                </div>
                ${msg.reaction ? `<span class="reaction-chip">${msg.reaction}</span>` : ""}
                ${popoverHtml}
              </div>
            `;
          })
          .join("")
      : `
        <div class="card" style="margin:auto;text-align:center;max-width:320px;">
          <div class="label" style="margin-bottom:6px;">Sohbet Hazır</div>
          <strong>${partnerLabel} ile sohbetin hazır</strong>
          <p class="muted-note" style="margin-top:6px;">İlk mesajını göndererek sohbete başlayabilirsin.</p>
        </div>
      `;

  const activeReplyMsg = replyingToMsgId
    ? state.messages.find((m) => m.id === replyingToMsgId)
    : null;

  const replyPreviewHtml = activeReplyMsg
    ? `
      <div class="reply-preview-bar">
        <div class="reply-preview-content">
          <span class="reply-preview-title">${getSenderLabel(activeReplyMsg.sender)} kişisine yanıt veriliyor</span>
          <span class="reply-preview-snippet">${getMessagePreviewText(activeReplyMsg)}</span>
        </div>
        <button type="button" class="tool-btn" id="cancel-reply-btn">✕</button>
      </div>
    `
    : "";

  const isCallBusy = Boolean(state.callMode) || isStartingCall;
  const isRinging = state.callMode && callPhase === "ringing";
  const isConnected = state.callMode && callPhase === "connected";
  const isIncomingCall = isRinging && callDirection === "incoming";
  const callKindText = state.callMode === "video" ? "görüntülü" : "sesli";

  const incomingCardHtml = isIncomingCall
    ? `
      <div class="incoming-call-card">
        <div class="incoming-caller-meta">
          <span class="incoming-caller-name">${partnerLabel}</span>
          <span class="peer-sub" id="incoming-call-sub">Seni ${callKindText} arıyor... (${formatCallTime(
            ringSecondsLeft
          )})</span>
        </div>
        <div class="call-actions">
          <button type="button" class="call-btn accept" id="accept-call-btn">Katıl</button>
          <button type="button" class="call-btn danger" id="reject-call-btn">Reddet</button>
        </div>
      </div>
    `
    : "";

  const videoSectionHtml =
    isConnected && state.callMode === "video"
      ? `
        <div class="call-video-box">
          ${
            camOff
              ? `<div class="call-video-off">Kamera kapalı</div>`
              : `<video id="call-local-video" class="call-video-el" autoplay playsinline muted></video>`
          }
        </div>
      `
      : "";

  const callBannerHtml = state.callMode
    ? `
      <div class="active-call-card">
        <div class="call-header-row">
          <div>
            <strong>${
              state.callMode === "video" ? "Görüntülü Arama" : "Sesli Arama"
            } · ${partnerLabel}</strong>
            <div class="peer-sub" id="call-duration">
              ${
                isRinging
                  ? `${partnerLabel} aranıyor... (${formatCallTime(ringSecondsLeft)})`
                  : `Süre: ${formatCallTime(state.callSeconds)}${micMuted ? " · Mikrofon kapalı" : ""}`
              }
            </div>
          </div>
          <button type="button" class="call-btn danger" id="end-call-btn">Aramayı Kapat</button>
        </div>

        ${videoSectionHtml}

        ${
          isConnected
            ? `
              <div class="call-controls-row">
                <button
                  type="button"
                  class="call-btn ${micMuted ? "active-toggle" : ""}"
                  id="toggle-mic-btn"
                >${micMuted ? "Mikrofonu Aç" : "Mikrofonu Kapat"}</button>

                ${
                  state.callMode === "video"
                    ? `<button
                        type="button"
                        class="call-btn ${camOff ? "active-toggle" : ""}"
                        id="toggle-cam-btn"
                      >${camOff ? "Kamerayı Aç" : "Kamerayı Kapat"}</button>`
                    : ""
                }
              </div>
            `
            : ""
        }
      </div>
    `
    : callErrorMsg
    ? `<div class="toast">${callErrorMsg}</div>`
    : "";

  const photoPreviewHtml = state.pendingPhoto
    ? `
      <div class="preview-box">
        <div style="display:flex;align-items:center;gap:10px;">
          <img
            src="${state.pendingPhoto}"
            alt="Önizleme"
            id="chat-preview-thumb"
            class="preview-thumb"
            style="cursor:pointer;"
          />
          <span class="muted-note">Fotoğraf gönderilmeye hazır</span>
        </div>
        <button class="tool-btn" id="clear-photo-btn">İptal</button>
      </div>
    `
    : "";

  const emojiDrawerHtml = state.emojiPickerOpen
    ? `
      <div class="emoji-drawer">
        <div class="emoji-grid">
          ${EMOJIS.map((em) => `<button type="button" class="emoji-item" data-emoji="${em}">${em}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const avatarInitial = (partnerLabel || "E").trim()[0]?.toUpperCase() || "E";
  const avatarHtml = state.partnerAvatar
    ? `<div class="avatar-circle"><img src="${state.partnerAvatar}" alt="${partnerLabel}" /></div>`
    : `<div class="avatar-circle">${avatarInitial}</div>`;

  const lastMsg = state.messages[state.messages.length - 1];
  const initialDateLabel = formatWhatsAppDateLabel(
    lastMsg?.dateKey || todayKey
  );

  contentEl.innerHTML = `
    <div class="chat-layout">
      ${incomingCardHtml}

      <div class="chat-top-card">
        <div class="chat-peer">
          ${avatarHtml}
          <div>
            <span class="peer-name-trigger" id="open-peer-sheet-btn">${partnerLabel}</span>
            <div class="${presence.className}" id="peer-live-sub">${presence.text}</div>
          </div>
        </div>
        <div class="call-actions">
          <button class="call-btn" id="voice-call-btn" ${isCallBusy ? "disabled" : ""}>Sesli Ara</button>
          <button class="call-btn" id="video-call-btn" ${isCallBusy ? "disabled" : ""}>Görüntülü Ara</button>
        </div>
      </div>

      ${callBannerHtml}

      <div class="messages-wrapper">
        <div class="sticky-date-header" id="sticky-date-header">${initialDateLabel}</div>
        <div class="messages-panel" id="messages-panel">
          ${messagesHtml}
        </div>
      </div>

      <div class="composer-card">
        ${emojiDrawerHtml}
        ${photoPreviewHtml}
        ${replyPreviewHtml}

        <div class="composer-main">
          <div class="input-wrap">
            <input type="text" id="msg-input" class="msg-input" placeholder="Mesaj yaz..." />
            <button
              type="button"
              id="emoji-toggle-btn"
              class="emoji-trigger-btn ${state.emojiPickerOpen ? "active" : ""}"
              title="Emojiler"
            >😊</button>
          </div>
          <button type="button" class="send-btn" id="send-msg-btn">Gönder</button>
        </div>

        <div class="composer-tools">
          <label class="tool-btn" style="cursor:pointer;">
            Fotoğraf
            <input type="file" id="photo-input" accept="image/*" hidden />
          </label>
          <button type="button" class="tool-btn" id="record-btn">Ses Kaydet</button>
          <span id="record-status" class="muted-note"></span>
        </div>
      </div>
    </div>
  `;

  if (isConnected && state.callMode === "video" && !camOff) {
    attachStreamToVideoEl();
  }

  if (peerModalOpen) {
    renderPeerInfoModal(contentEl);
  }

  document.getElementById("open-peer-sheet-btn").addEventListener("click", () => {
    openPeerInfoModal(contentEl);
  });

  const inputEl = document.getElementById("msg-input");
  inputEl.value = draftText;

  if (focusInputAfterRender) {
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  }

  inputEl.addEventListener("input", () => {
    const hasText = inputEl.value.trim().length > 0;
    setMyTypingStatus(hasText);
    clearTimeout(typingStopTimeout);
    if (hasText) {
      typingStopTimeout = setTimeout(() => setMyTypingStatus(false), 3200);
    }
  });

  inputEl.addEventListener("blur", () => {
    clearTimeout(typingStopTimeout);
    setTimeout(() => {
      const cur = document.getElementById("msg-input");
      if (!cur || !cur.value.trim()) {
        setMyTypingStatus(false);
      }
    }, 1500);
  });

  const panel = document.getElementById("messages-panel");
  const stickyEl = document.getElementById("sticky-date-header");

  const syncStickyDateOnScroll = () => {
    if (!panel || !stickyEl) return;
    const datedItems = Array.from(panel.querySelectorAll("[data-msg-date]"));
    if (datedItems.length === 0) return;
    const panelTop = panel.getBoundingClientRect().top;
    let activeKey = datedItems[0].dataset.msgDate;
    for (const item of datedItems) {
      const rect = item.getBoundingClientRect();
      if (rect.top <= panelTop + 44) {
        activeKey = item.dataset.msgDate;
      } else {
        break;
      }
    }
    stickyEl.textContent = formatWhatsAppDateLabel(activeKey);
  };

  panel.addEventListener("scroll", syncStickyDateOnScroll, { passive: true });

  if (scrollOpts.preserveScroll) {
    panel.scrollTop = prevScrollTop;
  } else if (scrollOpts.scrollToBottom) {
    panel.scrollTop = panel.scrollHeight;
  }
  syncStickyDateOnScroll();

  bindCustomAudioPlayers(panel);

  document.getElementById("chat-preview-thumb")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openChatPreviewOnly();
  });

  document.querySelectorAll("[data-open-photo]").forEach((photoEl) => {
    photoEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openSentChatPhotosGallery(photoEl.dataset.openPhoto);
    });
  });

  const triggerReplyTo = (msgId) => {
    if (!state.messages.some((m) => m.id === msgId)) return;
    replyingToMsgId = msgId;
    state.activeReactionMsgId = null;
    renderSohbet(contentEl, true, { scrollToBottom: false, preserveScroll: true });
  };

  let pressTimer = null;
  let longPressTriggered = false;

  const openReactionMenu = (msgId) => {
    state.activeReactionMsgId = state.activeReactionMsgId === msgId ? null : msgId;
    renderSohbet(contentEl, false, { scrollToBottom: false, preserveScroll: true });
  };

  document.querySelectorAll("[data-msg-bubble]").forEach((bubble) => {
    const msgId = Number(bubble.dataset.msgBubble);

    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openReactionMenu(msgId);
    });

    let touchStartX = 0;
    let touchStartY = 0;
    let swipeDeltaX = 0;
    let isHorizontalSwipe = false;

    bubble.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeDeltaX = 0;
        isHorizontalSwipe = false;
      },
      { passive: true }
    );

    bubble.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;

        if (!isHorizontalSwipe && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          isHorizontalSwipe = true;
          clearTimeout(pressTimer);
          bubble.classList.add("swiping");
        }

        if (isHorizontalSwipe && dx > 0) {
          swipeDeltaX = Math.min(90, dx);
          bubble.style.transform = `translateX(${swipeDeltaX}px)`;
        }
      },
      { passive: true }
    );

    const finishTouchSwipe = () => {
      bubble.classList.remove("swiping");
      bubble.style.transform = "";
      if (isHorizontalSwipe && swipeDeltaX >= 52) {
        triggerReplyTo(msgId);
      }
      swipeDeltaX = 0;
      isHorizontalSwipe = false;
    };

    bubble.addEventListener("touchend", finishTouchSwipe);
    bubble.addEventListener("touchcancel", finishTouchSwipe);

    bubble.addEventListener("pointerdown", (e) => {
      if (
        e.pointerType === "touch" ||
        e.button === 2 ||
        e.target.closest("[data-open-photo]") ||
        e.target.closest("[data-audio-player]")
      ) {
        return;
      }
      longPressTriggered = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        openReactionMenu(msgId);
      }, 480);
    });

    bubble.addEventListener("pointerup", () => clearTimeout(pressTimer));
    bubble.addEventListener("pointerleave", () => clearTimeout(pressTimer));
    bubble.addEventListener("pointercancel", () => clearTimeout(pressTimer));

    bubble.addEventListener("click", () => {
      if (longPressTriggered) longPressTriggered = false;
    });
  });

  document.querySelectorAll("[data-reply-msg]").forEach((repBtn) => {
    repBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerReplyTo(Number(repBtn.dataset.replyMsg));
    });
  });

  document.getElementById("cancel-reply-btn")?.addEventListener("click", () => {
    replyingToMsgId = null;
    renderSohbet(contentEl, true, { scrollToBottom: false, preserveScroll: true });
  });

  document.querySelectorAll("[data-react]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [idStr, emoji] = btn.dataset.react.split("|");
      const msg = state.messages.find((m) => m.id === Number(idStr));
      if (!msg) return;
      msg.reaction = msg.reaction === emoji ? null : emoji;
      state.activeReactionMsgId = null;
      saveState({ pushCloud: true });
      renderSohbet(contentEl, false, { scrollToBottom: false, preserveScroll: true });
    });
  });

  document.getElementById("emoji-toggle-btn").addEventListener("click", () => {
    state.emojiPickerOpen = !state.emojiPickerOpen;
    renderSohbet(contentEl, true, { scrollToBottom: false, preserveScroll: true });
  });

  document.querySelectorAll("[data-emoji]").forEach((emBtn) => {
    emBtn.addEventListener("click", () => {
      const input = document.getElementById("msg-input");
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const em = emBtn.dataset.emoji;
      input.value = input.value.slice(0, start) + em + input.value.slice(end);
      setMyTypingStatus(input.value.trim().length > 0);
      clearTimeout(typingStopTimeout);
      typingStopTimeout = setTimeout(() => setMyTypingStatus(false), 3200);
      input.focus();
      input.setSelectionRange(start + em.length, start + em.length);
    });
  });

  const startOutgoingCall = async (mode) => {
    if (state.callMode || isStartingCall) return;
    isStartingCall = true;
    callErrorMsg = "";
    stopCallMediaAndTimers();

    document.getElementById("voice-call-btn")?.setAttribute("disabled", "true");
    document.getElementById("video-call-btn")?.setAttribute("disabled", "true");

    const mediaRes = await requestMediaPermissionSafe(mode);
    if (!mediaRes.ok || !mediaRes.stream) {
      isStartingCall = false;
      stopCallMediaAndTimers();
      state.callMode = null;
      callErrorMsg =
        mediaRes.reason === "unsupported"
          ? "Bu cihazda ses/görüntü araması desteklenmiyor."
          : mode === "video"
          ? "Kamera veya mikrofon izni verilmedi."
          : "Mikrofon izni verilmedi.";
      appendCallLogMessage(mode, 0, "missed");
      renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
      return;
    }

    const myRole = getDeviceRole() || "userA";
    const partnerRole = getPartnerRole(myRole);
    const callId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    callStream = mediaRes.stream;
    state.callMode = mode;
    state.callSeconds = 0;
    callPhase = "ringing";
    callDirection = "outgoing";
    currentCallId = callId;
    micMuted = false;
    camOff = false;

    const callLabel = mode === "video" ? "Görüntülü arama" : "Sesli arama";
    const senderName = state.myName || "Samet";

    await writeCallSignal({
      callId,
      callerRole: myRole,
      calleeRole: partnerRole,
      mode,
      status: "ringing",
      callerName: senderName,
      updatedAt: Date.now()
    });

    dispatchNotificationEvent({
      kind: mode === "video" ? "video_call" : "voice_call",
      title: callLabel,
      body: `${senderName} seni ${mode === "video" ? "görüntülü" : "sesli"} arıyor...`,
      callId
    });

    isStartingCall = false;
    renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
    startRingingCountdown(contentEl, mode, callId);
  };

  document.getElementById("voice-call-btn")?.addEventListener("click", () => startOutgoingCall("voice"));
  document.getElementById("video-call-btn")?.addEventListener("click", () => startOutgoingCall("video"));

  document.getElementById("accept-call-btn")?.addEventListener("click", async () => {
    const mode = state.callMode || "voice";
    const mediaRes = await requestMediaPermissionSafe(mode);
    if (mediaRes.ok && mediaRes.stream) {
      callStream = mediaRes.stream;
    }
    const myRole = getDeviceRole() || "userB";
    const partnerRole = getPartnerRole(myRole);
    const activeId = currentCallId || `${Date.now()}`;

    await writeCallSignal({
      callId: activeId,
      callerRole: partnerRole,
      calleeRole: myRole,
      mode,
      status: "accepted",
      updatedAt: Date.now()
    });

    beginCallConversationTimer(contentEl);
  });

  document.getElementById("reject-call-btn")?.addEventListener("click", async () => {
    const mode = state.callMode || "voice";
    const myRole = getDeviceRole() || "userB";
    const partnerRole = getPartnerRole(myRole);
    const activeId = currentCallId || `${Date.now()}`;

    stopCallMediaAndTimers();
    state.callMode = null;

    await writeCallSignal({
      callId: activeId,
      callerRole: partnerRole,
      calleeRole: myRole,
      mode,
      status: "rejected",
      updatedAt: Date.now()
    });

    renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
  });

  document.getElementById("end-call-btn")?.addEventListener("click", async () => {
    const mode = state.callMode || "voice";
    const wasConnected = callPhase === "connected";
    const elapsed = state.callSeconds;
    const myRole = getDeviceRole() || "userA";
    const partnerRole = getPartnerRole(myRole);
    const activeId = currentCallId || `${Date.now()}`;

    stopCallMediaAndTimers();
    state.callMode = null;

    await writeCallSignal({
      callId: activeId,
      callerRole: callDirection === "outgoing" ? myRole : partnerRole,
      calleeRole: callDirection === "outgoing" ? partnerRole : myRole,
      mode,
      status: "ended",
      updatedAt: Date.now()
    });

    if (callDirection === "outgoing") {
      appendCallLogMessage(mode, wasConnected ? elapsed : 0, wasConnected ? "ended" : "missed");
    }
    renderSohbet(contentEl, false, { scrollToBottom: true, preserveScroll: false });
  });

  const toggleCallTrack = (kind) => {
    if (kind === "mic") {
      micMuted = !micMuted;
      callStream?.getAudioTracks().forEach((t) => {
        t.enabled = !micMuted;
      });
    } else {
      camOff = !camOff;
      callStream?.getVideoTracks().forEach((t) => {
        t.enabled = !camOff;
      });
    }
    renderSohbet(contentEl, false, { scrollToBottom: false, preserveScroll: true });
  };

  document.getElementById("toggle-mic-btn")?.addEventListener("click", () => toggleCallTrack("mic"));
  document.getElementById("toggle-cam-btn")?.addEventListener("click", () => toggleCallTrack("cam"));

  document.getElementById("photo-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingPhoto = reader.result;
      renderSohbet(contentEl, true, { scrollToBottom: false, preserveScroll: true });
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("clear-photo-btn")?.addEventListener("click", () => {
    state.pendingPhoto = null;
    renderSohbet(contentEl, true, { scrollToBottom: false, preserveScroll: true });
  });

  const recordBtn = document.getElementById("record-btn");
  const recordStatus = document.getElementById("record-status");

  recordBtn?.addEventListener("click", async () => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
      return;
    }

    const mediaRes = await requestMediaPermissionSafe("voice");
    if (!mediaRes.ok || !mediaRes.stream) {
      if (recordStatus) {
        recordStatus.textContent =
          mediaRes.reason === "unsupported" ? "Mikrofon desteklenmiyor." : "Mikrofon izni verilmedi.";
      }
      return;
    }

    const stream = mediaRes.stream;
    const preferredMime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported(m) : false
    );
    const recorderOptions = preferredMime
      ? { mimeType: preferredMime, audioBitsPerSecond: 128000 }
      : { audioBitsPerSecond: 128000 };

    let recorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch {
      recorder = new MediaRecorder(stream);
    }

    state.audioChunks = [];
    state.mediaRecorder = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.audioChunks.push(ev.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" });
      state.audioChunks = [];
      state.mediaRecorder = null;

      if (blob.size > 0) {
        const audioDataUrl = await blobToDataUrl(blob);
        const senderName = state.myName || "Samet";
        const now = Date.now();
        state.messages.push({
          id: now + Math.floor(Math.random() * 100),
          sender: "me",
          authorRole: getDeviceRole() || "userA",
          type: "audio",
          src: audioDataUrl,
          time: nowTime(),
          createdAt: now,
          dateKey: getLocalDayKey(new Date(now)),
          status: "sent",
          reaction: null,
          replyTo: buildReplyPayload(activeReplyMsg)
        });
        replyingToMsgId = null;
        clearTimeout(typingStopTimeout);
        setMyTypingStatus(false);
        await saveState({ pushCloud: true });
        dispatchNotificationEvent({
          kind: "message",
          title: `${senderName} ses kaydı gönderdi`,
          body: "🎤 Yeni sesli mesaj"
        });
        renderSohbet(contentEl, true, { scrollToBottom: true, preserveScroll: false });
      }
    };

    recorder.start();
    if (recordStatus) recordStatus.textContent = "Kaydediliyor...";
    recordBtn.textContent = "Kaydı Durdur";
  });

  const sendCurrentMessage = async () => {
    const currentInput = document.getElementById("msg-input");
    const text = (currentInput ? currentInput.value : "").trim();
    const hasPhoto = Boolean(state.pendingPhoto);

    if (!text && !hasPhoto) return;

    const now = Date.now();
    const newMsg = {
      id: now + Math.floor(Math.random() * 100),
      sender: "me",
      authorRole: getDeviceRole() || "userA",
      type: hasPhoto ? "image" : "text",
      text: text || "",
      src: hasPhoto ? state.pendingPhoto : null,
      time: nowTime(),
      createdAt: now,
      dateKey: getLocalDayKey(new Date(now)),
      status: "sent",
      reaction: null,
      replyTo: buildReplyPayload(activeReplyMsg)
    };

    clearTimeout(typingStopTimeout);
    state.messages.push(newMsg);
    state.pendingPhoto = null;
    replyingToMsgId = null;
    if (currentInput) currentInput.value = "";
    setMyTypingStatus(false);

    await saveState({ pushCloud: true });

    const senderName = state.myName || "Samet";
    dispatchNotificationEvent({
      kind: "message",
      title: `${senderName} mesaj gönderdi`,
      body: hasPhoto ? (text ? `📷 ${text}` : "📷 Fotoğraf gönderdi") : text
    });

    renderSohbet(contentEl, true, { scrollToBottom: true, preserveScroll: false });
  };

  document.getElementById("send-msg-btn")?.addEventListener("click", sendCurrentMessage);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });
}
