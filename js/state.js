import { db, ref, set, onValue } from "./firebase.js";

const STORAGE_KEY = "biz_app_state_v3";
const LEGACY_KEYS = ["biz_app_state_v1", "biz_app_state_v2"];
const ADMIN_OWNER_KEY = "biz_admin_owner_v1";
const DEVICE_ROLE_KEY = "biz_device_role_v1"; // "userA" (Samet) | "userB" (Emine)
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

// Yerel verileri temizler; diğer tarafın veya ortak bulut verisinin üzerine boş kayıt basmaz.
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
