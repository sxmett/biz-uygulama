import { db, ref, set, onValue } from "./firebase.js";

const STORAGE_KEY = "biz_app_state_v3";
const LEGACY_KEYS = ["biz_app_state_v1", "biz_app_state_v2"];
const ADMIN_OWNER_KEY = "biz_admin_owner_v1";
const DEVICE_ROLE_KEY = "biz_device_role_v1";
const SHARED_ROOM_PATH = "biz_room/shared_state";

export function getLocalDayKey(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createEmptyUserProfile(role) {
  return {
    name: role === "userB" ? "Emine" : "Samet",
    avatar: null,
    mood: "Uyuyor",
    note: "",
    location: {
      lat: null,
      lon: null,
      label: "Henüz paylaşılmadı",
      updatedAt: "Henüz güncellenmedi"
    },
    missCount: 0
  };
}

export const defaultState = {
  activeTab: "biz",
  startDate: "2025-12-12T00:00:00",
  specialEvent: {
    title: "Yıldönümü",
    date: "2026-12-12T00:00:00"
  },
  userProfiles: {
    userA: createEmptyUserProfile("userA"),
    userB: createEmptyUserProfile("userB")
  },
  myName: "Samet",
  partnerName: "Emine",
  myAvatar: null,
  partnerAvatar: null,
  partnerMood: "Uyuyor",
  partnerNote: "",
  myNote: "",
  moods: ["Uyuyor", "Seni özledi", "Derste / Çalışıyor", "Yolda"],
  missCount: 0,
  myMissCount: 0,
  partnerMissCount: 0,
  missDayKey: getLocalDayKey(),
  lastMissTime: null,
  bizClockInterval: null,
  myLocation: {
    lat: null,
    lon: null,
    label: "Henüz paylaşılmadı",
    updatedAt: "Henüz güncellenmedi"
  },
  partnerLocation: {
    lat: null,
    lon: null,
    label: "Henüz paylaşılmadı",
    updatedAt: "Henüz güncellenmedi"
  },
  distanceKm: 0,
  emojiPickerOpen: false,
  pendingPhoto: null,
  callMode: null,
  callSeconds: 0,
  callTimer: null,
  activeReactionMsgId: null,
  typingByRole: {
    userA: false,
    userB: false
  },
  messages: [],
  pendingMemoryPhoto: null,
  confirmDeleteId: null,
  memories: [],
  mediaRecorder: null,
  audioChunks: [],
  isAdminOwner: false
};

function readAdminOwnerFlag() {
  try {
    return localStorage.getItem(ADMIN_OWNER_KEY) === "true";
  } catch {
    return false;
  }
}

export function getDeviceRole() {
  try {
    const r = localStorage.getItem(DEVICE_ROLE_KEY);
    return r === "userA" || r === "userB" ? r : null;
  } catch {
    return null;
  }
}

export function getPartnerRole(role = getDeviceRole()) {
  return role === "userB" ? "userA" : "userB";
}

function ensureProfilesExist(source) {
  const baseA = createEmptyUserProfile("userA");
  const baseB = createEmptyUserProfile("userB");
  const rawA = source?.userProfiles?.userA || {};
  const rawB = source?.userProfiles?.userB || {};

  return {
    userA: {
      ...baseA,
      ...rawA,
      location: { ...baseA.location, ...(rawA.location || {}) }
    },
    userB: {
      ...baseB,
      ...rawB,
      location: { ...baseB.location, ...(rawB.location || {}) }
    }
  };
}

export function syncRoleViewFields() {
  const myRole = getDeviceRole() || "userA";
  const otherRole = getPartnerRole(myRole);
  const profiles = ensureProfilesExist(state);
  state.userProfiles = profiles;

  const me = profiles[myRole];
  const partner = profiles[otherRole];

  state.myName = me.name || (myRole === "userB" ? "Emine" : "Samet");
  state.partnerName = partner.name || (otherRole === "userB" ? "Emine" : "Samet");
  state.myAvatar = me.avatar ?? null;
  state.partnerAvatar = partner.avatar ?? null;
  state.myNote = me.note ?? "";
  state.partnerNote = partner.note ?? "";
  state.partnerMood = partner.mood || "Uyuyor";
  state.myLocation = { ...me.location };
  state.partnerLocation = { ...partner.location };
  state.myMissCount = Number(me.missCount) || 0;
  state.partnerMissCount = Number(partner.missCount) || 0;
  state.missCount = state.myMissCount + state.partnerMissCount;

  const hasMyCoords =
    typeof state.myLocation.lat === "number" &&
    typeof state.myLocation.lon === "number" &&
    Number.isFinite(state.myLocation.lat) &&
    Number.isFinite(state.myLocation.lon);

  const hasPartnerCoords =
    typeof state.partnerLocation.lat === "number" &&
    typeof state.partnerLocation.lon === "number" &&
    Number.isFinite(state.partnerLocation.lat) &&
    Number.isFinite(state.partnerLocation.lon);

  if (hasMyCoords && hasPartnerCoords) {
    state.distanceKm = calculateDistanceKm(
      state.myLocation.lat,
      state.myLocation.lon,
      state.partnerLocation.lat,
      state.partnerLocation.lon
    );
  } else {
    state.distanceKm = 0;
  }
}

export function writeMyProfileChanges(patch = {}) {
  const myRole = getDeviceRole() || "userA";
  const profiles = ensureProfilesExist(state);
  const current = profiles[myRole];

  profiles[myRole] = {
    ...current,
    ...patch,
    location: patch.location
      ? { ...current.location, ...patch.location }
      : { ...current.location }
  };

  state.userProfiles = profiles;
  syncRoleViewFields();
}

export function writePartnerProfileChanges(patch = {}) {
  const partnerRole = getPartnerRole(getDeviceRole() || "userA");
  const profiles = ensureProfilesExist(state);
  const current = profiles[partnerRole];

  profiles[partnerRole] = {
    ...current,
    ...patch,
    location: patch.location
      ? { ...current.location, ...patch.location }
      : { ...current.location }
  };

  state.userProfiles = profiles;
  syncRoleViewFields();
}

export function applyRoleNamesToState() {
  syncRoleViewFields();
}

export function setDeviceRole(role) {
  const safeRole = role === "userB" ? "userB" : "userA";
  try {
    localStorage.setItem(DEVICE_ROLE_KEY, safeRole);
  } catch {
    // Sessiz geç
  }
  syncRoleViewFields();
  state.messages = normalizeMessagesForRole(state.messages);
  saveState({ pushCloud: true });
  return safeRole;
}

export function resolveRoleFromPasscode(rawCode) {
  const normalized = String(rawCode || "").trim().toUpperCase();
  if (normalized === "SMT-1506") return "userA";
  if (normalized === "EMOS-1506") return "userB";
  return null;
}

export function clearDeviceRole() {
  try {
    localStorage.removeItem(DEVICE_ROLE_KEY);
  } catch {
    // Sessiz geç
  }
  syncRoleViewFields();
  state.messages = normalizeMessagesForRole(state.messages);
}

export function setAdminOwner(enabled) {
  state.isAdminOwner = Boolean(enabled);
  try {
    localStorage.setItem(ADMIN_OWNER_KEY, state.isAdminOwner ? "true" : "false");
  } catch {
    // Sessiz geç
  }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeMessagesForRole(rawMessages) {
  const myRole = getDeviceRole() || "userA";
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map((msg) => {
    const authorRole = msg.authorRole || (msg.sender === "me" ? "userA" : "userB");
    return {
      ...msg,
      authorRole,
      sender: authorRole === myRole ? "me" : "them"
    };
  });
}

function applySharedSnapshot(dataSource) {
  if (!dataSource || typeof dataSource !== "object") return;

  const todayKey = getLocalDayKey();
  const sameDay = dataSource.missDayKey === todayKey;

  state.startDate =
    typeof dataSource.startDate === "string" && dataSource.startDate.trim()
      ? dataSource.startDate
      : state.startDate || defaultState.startDate;

  state.specialEvent = {
    title:
      typeof dataSource.specialEvent?.title === "string" && dataSource.specialEvent.title.trim()
        ? dataSource.specialEvent.title
        : state.specialEvent?.title || defaultState.specialEvent.title,
    date:
      typeof dataSource.specialEvent?.date === "string" && dataSource.specialEvent.date.trim()
        ? dataSource.specialEvent.date
        : state.specialEvent?.date || defaultState.specialEvent.date
  };

  const mergedProfiles = ensureProfilesExist(dataSource);
  if (!sameDay) {
    mergedProfiles.userA.missCount = 0;
    mergedProfiles.userB.missCount = 0;
  }

  state.userProfiles = mergedProfiles;
  state.missDayKey = todayKey;
  state.lastMissTime =
    typeof dataSource.lastMissTime === "string" ? dataSource.lastMissTime : null;

  state.messages = Array.isArray(dataSource.messages)
    ? normalizeMessagesForRole(dataSource.messages)
    : [];

  state.memories = Array.isArray(dataSource.memories)
    ? JSON.parse(JSON.stringify(dataSource.memories))
    : [];

  state.typingByRole = {
    userA: Boolean(dataSource.typingByRole?.userA),
    userB: Boolean(dataSource.typingByRole?.userB)
  };

  syncRoleViewFields();
}

const saved = loadSavedState();
const adminFlag = readAdminOwnerFlag();

export const state = {
  ...defaultState,
  ...saved,
  userProfiles: ensureProfilesExist(saved),
  moods: defaultState.moods,
  missDayKey: saved.missDayKey === getLocalDayKey() ? saved.missDayKey : getLocalDayKey(),
  specialEvent: {
    ...defaultState.specialEvent,
    ...(saved.specialEvent || {})
  },
  messages: Array.isArray(saved.messages) ? normalizeMessagesForRole(saved.messages) : [],
  memories: Array.isArray(saved.memories) ? saved.memories : [],
  typingByRole: {
    userA: Boolean(saved.typingByRole?.userA),
    userB: Boolean(saved.typingByRole?.userB)
  },
  bizClockInterval: null,
  callMode: null,
  callSeconds: 0,
  callTimer: null,
  activeReactionMsgId: null,
  confirmDeleteId: null,
  mediaRecorder: null,
  audioChunks: [],
  isAdminOwner: adminFlag
};

syncRoleViewFields();

let suppressNextCloudPush = false;
let cloudListenerStarted = false;

export function syncDailyMissReset() {
  const currentKey = getLocalDayKey();
  if (state.missDayKey !== currentKey) {
    state.missDayKey = currentKey;
    writeMyProfileChanges({ missCount: 0 });
    writePartnerProfileChanges({ missCount: 0 });
    saveState({ pushCloud: true });
    return true;
  }
  return false;
}

export function buildPersistPayload() {
  syncRoleViewFields();
  return {
    startDate: state.startDate,
    specialEvent: state.specialEvent,
    userProfiles: state.userProfiles,
    myName: state.myName,
    partnerName: state.partnerName,
    myAvatar: state.myAvatar,
    partnerAvatar: state.partnerAvatar,
    partnerMood: state.partnerMood,
    partnerNote: state.partnerNote,
    myNote: state.myNote,
    missCount: state.missCount,
    myMissCount: state.myMissCount,
    partnerMissCount: state.partnerMissCount,
    missDayKey: state.missDayKey,
    lastMissTime: state.lastMissTime,
    myLocation: state.myLocation,
    partnerLocation: state.partnerLocation,
    distanceKm: state.distanceKm,
    messages: state.messages,
    memories: state.memories,
    typingByRole: state.typingByRole || { userA: false, userB: false },
    updatedBy: getDeviceRole() || "userA",
    updatedAt: Date.now()
  };
}

export function saveState(options = { pushCloud: true }) {
  try {
    syncRoleViewFields();
    const payload = buildPersistPayload();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (options.pushCloud !== false && !suppressNextCloudPush) {
      set(ref(db, SHARED_ROOM_PATH), payload).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

export function setMyTypingStatus(isTyping) {
  const myRole = getDeviceRole();
  if (!myRole) return;
  const current = Boolean(state.typingByRole?.[myRole]);
  if (current === Boolean(isTyping)) return;
  state.typingByRole = {
    ...(state.typingByRole || { userA: false, userB: false }),
    [myRole]: Boolean(isTyping)
  };
  saveState({ pushCloud: true });
}

export function isPartnerTyping() {
  const myRole = getDeviceRole();
  if (!myRole) return false;
  const partnerRole = getPartnerRole(myRole);
  return Boolean(state.typingByRole?.[partnerRole]);
}

export function initRealtimeSync(onRemoteUpdate) {
  if (cloudListenerStarted) return;
  cloudListenerStarted = true;

  const roomRef = ref(db, SHARED_ROOM_PATH);
  onValue(roomRef, (snapshot) => {
    const val = snapshot.val();
    if (!val || typeof val !== "object") return;

    suppressNextCloudPush = true;
    applySharedSnapshot(val);

    let changed = false;
    if (Array.isArray(state.messages)) {
      state.messages.forEach((m) => {
        if (m.sender === "them" && m.status === "sent") {
          m.status = "delivered";
          changed = true;
        }
      });
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistPayload()));
    } catch {
      // Sessiz geç
    }

    suppressNextCloudPush = false;
    if (changed) {
      saveState({ pushCloud: true });
    }
    onRemoteUpdate?.();
  });
}

export function applyImportedBackup(rawData) {
  if (!rawData || typeof rawData !== "object") {
    throw new Error("Geçersiz yedek dosyası.");
  }

  const dataSource =
    rawData.data && typeof rawData.data === "object" ? rawData.data : rawData;

  applySharedSnapshot(dataSource);
  state.confirmDeleteId = null;
  state.activeReactionMsgId = null;

  return saveState({ pushCloud: true });
}

export function resetAllPersistedData() {
  const keepAdmin = state.isAdminOwner;

  try {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Sessiz geç
  }

  state.userProfiles = {
    userA: createEmptyUserProfile("userA"),
    userB: createEmptyUserProfile("userB")
  };
  state.messages = [];
  state.memories = [];
  state.lastMissTime = null;
  state.missDayKey = getLocalDayKey();
  state.activeTab = keepAdmin ? "admin" : "biz";
  state.emojiPickerOpen = false;
  state.pendingPhoto = null;
  state.pendingMemoryPhoto = null;
  state.confirmDeleteId = null;
  state.activeReactionMsgId = null;
  state.isAdminOwner = keepAdmin;

  syncRoleViewFields();
}

export function nowTime() {
  return new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getMapsUrl(lat, lon) {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function showToast(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="toast">${message}</div>`;
}

export async function requestNotificationPermissionSafe() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    // Sessiz geç
  }
}

export async function requestLocationPermissionSafe() {
  if (!navigator.geolocation || !navigator.geolocation.getCurrentPosition) {
    return { ok: false, reason: "unsupported" };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, position: pos }),
      (err) => resolve({ ok: false, reason: err?.code === 1 ? "denied" : "error", error: err }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export async function requestMediaPermissionSafe(mode = "voice") {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, stream: null, reason: "unsupported" };
  }

  const constraints =
    mode === "video"
      ? { audio: true, video: { facingMode: "user" } }
      : { audio: true, video: false };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { ok: true, stream, reason: "granted" };
  } catch (err) {
    return { ok: false, stream: null, reason: err?.name || "denied", error: err };
  }
}

export function openGalleryLightbox(items = [], startIndex = 0) {
  const validItems = Array.isArray(items)
    ? items.filter((it) => it && typeof it.src === "string" && it.src.length > 0)
    : [];
  if (validItems.length === 0) return;

  let currentIndex = Math.min(Math.max(0, Number(startIndex) || 0), validItems.length - 1);
  let scale = 1;
  let panX = 0;
  let panY = 0;

  let mouseDragging = false;
  let mouseMoved = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseOriginX = 0;
  let mouseOriginY = 0;

  let touchMode = "none"; // "none" | "pan" | "pinch"
  let touchMoved = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchOriginX = 0;
  let touchOriginY = 0;

  document.getElementById("wa-gallery-lightbox")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "wa-gallery-lightbox";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(10, 10, 12, 0.96);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  `;

  overlay.innerHTML = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 16px;
      background: rgba(20, 20, 24, 0.85);
      backdrop-filter: blur(8px);
      z-index: 4;
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span id="wa-lb-counter" style="
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          background: rgba(255,255,255,0.14);
          padding: 5px 10px;
          border-radius: 999px;
        ">1 / 1</span>
        <span id="wa-lb-zoom" style="
          color: #ffd6e4;
          font-size: 12.5px;
          font-weight: 600;
          background: rgba(230,46,101,0.32);
          padding: 5px 10px;
          border-radius: 999px;
        ">100%</span>
      </div>

      <div style="display: flex; align-items: center; gap: 6px;">
        <button type="button" id="wa-lb-out" style="
          min-width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22);
          background: rgba(255,255,255,0.12); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;
        ">-</button>
        <button type="button" id="wa-lb-reset" style="
          height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22);
          background: rgba(255,255,255,0.12); color: #fff; font-size: 12.5px; font-weight: 700; cursor: pointer;
        ">1x</button>
        <button type="button" id="wa-lb-in" style="
          min-width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22);
          background: rgba(255,255,255,0.12); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;
        ">+</button>
        <button type="button" id="wa-lb-close" style="
          height: 36px; padding: 0 12px; border-radius: 10px; border: none;
          background: #e62e65; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
        ">Kapat</button>
      </div>
    </div>

    <div id="wa-lb-stage" style="
      position: relative;
      flex: 1;
      width: 100%;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: none;
    ">
      ${
        validItems.length > 1
          ? `
            <button type="button" id="wa-lb-prev" aria-label="Önceki fotoğraf" style="
              position: absolute; left: 10px; top: 50%; transform: translateY(-50%); z-index: 3;
              width: 40px; height: 40px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25);
              background: rgba(20,20,24,0.72); color: #fff; font-size: 22px; cursor: pointer;
              display: flex; align-items: center; justify-content: center;
            ">‹</button>
            <button type="button" id="wa-lb-next" aria-label="Sonraki fotoğraf" style="
              position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 3;
              width: 40px; height: 40px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25);
              background: rgba(20,20,24,0.72); color: #fff; font-size: 22px; cursor: pointer;
              display: flex; align-items: center; justify-content: center;
            ">›</button>
          `
          : ""
      }

      <img
        id="wa-lb-img"
        src="${validItems[currentIndex].src}"
        alt="${validItems[currentIndex].title || "Fotoğraf"}"
        draggable="false"
        style="
          max-width: 94vw;
          max-height: 76vh;
          object-fit: contain;
          border-radius: 10px;
          transform-origin: center center;
          will-change: transform;
          touch-action: none;
        "
      />
    </div>

    <div id="wa-lb-caption" style="
      min-height: 44px;
      padding: 10px 18px 18px;
      text-align: center;
      color: #f3edf1;
      font-size: 13px;
      background: rgba(20, 20, 24, 0.85);
      z-index: 4;
    "></div>
  `;

  document.body.appendChild(overlay);

  const stageEl = document.getElementById("wa-lb-stage");
  const imgEl = document.getElementById("wa-lb-img");
  const counterEl = document.getElementById("wa-lb-counter");
  const zoomEl = document.getElementById("wa-lb-zoom");
  const captionEl = document.getElementById("wa-lb-caption");

  const clampPan = () => {
    if (scale <= 1) {
      panX = 0;
      panY = 0;
      return;
    }
    const maxPanX = Math.max(180, ((scale - 1) * (stageEl?.clientWidth || 360)) * 0.85);
    const maxPanY = Math.max(180, ((scale - 1) * (stageEl?.clientHeight || 500)) * 0.85);
    panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
    panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
  };

  const renderTransform = (customX = panX, customY = panY, customScale = scale) => {
    if (!imgEl) return;
    imgEl.style.transform = `translate3d(${customX.toFixed(1)}px, ${customY.toFixed(1)}px, 0) scale(${customScale.toFixed(2)})`;
    imgEl.style.cursor = mouseDragging ? "grabbing" : scale > 1 ? "grab" : "zoom-in";
  };

  const commitTransform = () => {
    clampPan();
    renderTransform(panX, panY, scale);
    if (zoomEl) {
      zoomEl.textContent = `${Math.round(scale * 100)}%`;
    }
  };

  const setZoom = (nextScale) => {
    scale = Math.min(4, Math.max(1, Number(nextScale.toFixed(2))));
    if (scale === 1) {
      panX = 0;
      panY = 0;
    }
    commitTransform();
  };

  const loadPhotoAt = (idx) => {
    if (validItems.length === 0) return;
    currentIndex = (idx + validItems.length) % validItems.length;
    scale = 1;
    panX = 0;
    panY = 0;
    const item = validItems[currentIndex];
    if (imgEl) {
      imgEl.src = item.src;
      imgEl.alt = item.title || "Fotoğraf";
    }
    if (counterEl) {
      counterEl.textContent = `${currentIndex + 1} / ${validItems.length}`;
    }
    if (captionEl) {
      captionEl.textContent = item.title || "";
    }
    commitTransform();
  };

  const closeViewer = () => {
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    overlay.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      closeViewer();
    } else if (e.key === "ArrowLeft" && validItems.length > 1) {
      loadPhotoAt(currentIndex - 1);
    } else if (e.key === "ArrowRight" && validItems.length > 1) {
      loadPhotoAt(currentIndex + 1);
    } else if (e.key === "+" || e.key === "=") {
      setZoom(scale + 0.35);
    } else if (e.key === "-") {
      setZoom(scale - 0.35);
    } else if (e.key === "0") {
      setZoom(1);
    }
  };

  // PC: Fare basılı tutarak sağa/sola/yukarı/aşağı kaydırma
  const onMouseMove = (e) => {
    if (!mouseDragging) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      mouseMoved = true;
    }

    if (scale > 1) {
      panX = mouseOriginX + dx;
      panY = mouseOriginY + dy;
      commitTransform();
    } else if (validItems.length > 1) {
      renderTransform(mouseOriginX + dx * 0.45, 0, 1);
    }
  };

  const onMouseUp = (e) => {
    if (!mouseDragging) return;
    mouseDragging = false;
    const dx = e.clientX - mouseStartX;

    if (scale <= 1) {
      panX = 0;
      panY = 0;
      commitTransform();
      if (validItems.length > 1 && Math.abs(dx) > 65) {
        if (dx < 0) loadPhotoAt(currentIndex + 1);
        else loadPhotoAt(currentIndex - 1);
      }
    } else {
      commitTransform();
    }
  };

  imgEl?.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    mouseDragging = true;
    mouseMoved = false;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseOriginX = panX;
    mouseOriginY = panY;
    renderTransform(panX, panY, scale);
  });

  imgEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (mouseMoved) {
      mouseMoved = false;
      return;
    }
    setZoom(scale > 1 ? 1 : 2);
  });

  // Mobil: 2 parmak pinch-to-zoom + 1 parmak sağ/sol/yukarı/aşağı kaydırma
  const getTouchesDist = (touches) =>
    Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);

  stageEl?.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchMode = "pinch";
        touchMoved = true;
        pinchStartDist = getTouchesDist(e.touches);
        pinchStartScale = scale;
      } else if (e.touches.length === 1) {
        touchMode = "pan";
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchOriginX = panX;
        touchOriginY = panY;
      }
    },
    { passive: false }
  );

  stageEl?.addEventListener(
    "touchmove",
    (e) => {
      if (touchMode === "pinch" && e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const dist = getTouchesDist(e.touches);
        scale = Math.min(4, Math.max(1, Number((pinchStartScale * (dist / pinchStartDist)).toFixed(2))));
        if (scale === 1) {
          panX = 0;
          panY = 0;
        }
        commitTransform();
      } else if (touchMode === "pan" && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          touchMoved = true;
        }

        if (scale > 1) {
          e.preventDefault();
          panX = touchOriginX + dx;
          panY = touchOriginY + dy;
          commitTransform();
        } else if (validItems.length > 1 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          renderTransform(dx * 0.45, 0, 1);
        }
      }
    },
    { passive: false }
  );

  stageEl?.addEventListener("touchend", (e) => {
    if (e.touches.length === 2) {
      pinchStartDist = getTouchesDist(e.touches);
      pinchStartScale = scale;
      touchMode = "pinch";
      return;
    }

    if (touchMode === "pan" && scale <= 1 && e.changedTouches.length > 0) {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - touchStartX;
      const diffY = endY - touchStartY;
      panX = 0;
      panY = 0;
      commitTransform();

      if (validItems.length > 1 && Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) loadPhotoAt(currentIndex + 1);
        else loadPhotoAt(currentIndex - 1);
      }
    }

    if (e.touches.length === 0) {
      touchMode = "none";
      pinchStartDist = 0;
    }
  });

  // PC: Fare tekerleği ile yakınlaştırma / uzaklaştırma
  stageEl?.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setZoom(scale + (e.deltaY < 0 ? 0.25 : -0.25));
    },
    { passive: false }
  );

  stageEl?.addEventListener("click", (e) => {
    if (e.target === stageEl && !mouseMoved && !touchMoved) {
      closeViewer();
    }
  });

  document.getElementById("wa-lb-in")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setZoom(scale + 0.5);
  });

  document.getElementById("wa-lb-out")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setZoom(scale - 0.5);
  });

  document.getElementById("wa-lb-reset")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setZoom(1);
  });

  document.getElementById("wa-lb-prev")?.addEventListener("click", (e) => {
    e.stopPropagation();
    loadPhotoAt(currentIndex - 1);
  });

  document.getElementById("wa-lb-next")?.addEventListener("click", (e) => {
    e.stopPropagation();
    loadPhotoAt(currentIndex + 1);
  });

  document.getElementById("wa-lb-close")?.addEventListener("click", closeViewer);

  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  loadPhotoAt(currentIndex);
}
