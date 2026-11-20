import { db, ref, set, onValue } from "./firebase.js";

const STORAGE_KEY = "biz_app_state_v1";
const ADMIN_OWNER_KEY = "biz_admin_owner_v1";
const DEVICE_ROLE_KEY = "biz_device_role_v1"; // "userA" (Samet) | "userB" (Emine)
const SHARED_ROOM_PATH = "biz_room/shared_state";

export function getLocalDayKey(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const defaultState = {
  activeTab: "biz",
  startDate: "2025-12-12T00:00:00",
  specialEvent: {
    title: "Yıldönümü",
    date: "2026-12-12T00:00:00"
  },
  myName: "Samet",
  partnerName: "Emine",
  myAvatar: null,
  partnerAvatar: null,
  partnerMood: "Uyuyor",
  partnerNote: "Akşam müsait olduğumda ilk seni arayacağım.",
  myNote: "Seni düşünüyorum.",
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
    label: "Henüz yazılmadı",
    updatedAt: "Az önce"
  },
  partnerLocation: {
    lat: 39.9208,
    lon: 32.8541,
    label: "Kızılay civarı",
    updatedAt: "Az önce"
  },
  distanceKm: 3.4,
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
  messages: [
    {
      id: 1,
      sender: "them",
      authorRole: "userB",
      type: "text",
      text: "Selam, bugün nasıl geçiyor?",
      time: "10:15",
      status: "read",
      reaction: null
    },
    {
      id: 2,
      sender: "me",
      authorRole: "userA",
      type: "text",
      text: "Güzel geçiyor, seninle sohbet alanını düzenliyorum.",
      time: "10:16",
      status: "read",
      reaction: "❤️"
    }
  ],
  pendingMemoryPhoto: null,
  confirmDeleteId: null,
  memories: [
    {
      id: 1,
      title: "İlk Kahve Buluşması",
      date: "14 Şubat",
      author: "Samet",
      photo: null,
      note: "En sevdiğimiz köşe masası ve uzun uzun sohbet."
    }
  ],
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

export function applyRoleNamesToState() {
  const role = getDeviceRole() || "userA";
  if (role === "userB") {
    state.myName = "Emine";
    state.partnerName = "Samet";
  } else {
    state.myName = "Samet";
    state.partnerName = "Emine";
  }
}

export function setDeviceRole(role) {
  const safeRole = role === "userB" ? "userB" : "userA";
  try {
    localStorage.setItem(DEVICE_ROLE_KEY, safeRole);
  } catch {
    // Sessiz geç
  }
  applyRoleNamesToState();
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
  applyRoleNamesToState();
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

  const myRole = getDeviceRole() || "userA";

  const nextStartDate =
    typeof dataSource.startDate === "string" && dataSource.startDate.trim()
      ? dataSource.startDate
      : defaultState.startDate;

  const nextSpecialEvent = {
    title:
      typeof dataSource.specialEvent?.title === "string" && dataSource.specialEvent.title.trim()
        ? dataSource.specialEvent.title
        : defaultState.specialEvent.title,
    date:
      typeof dataSource.specialEvent?.date === "string" && dataSource.specialEvent.date.trim()
        ? dataSource.specialEvent.date
        : defaultState.specialEvent.date
  };

  const nextMyLocation = {
    ...defaultState.myLocation,
    ...(dataSource.myLocation && typeof dataSource.myLocation === "object"
      ? dataSource.myLocation
      : {})
  };

  const nextPartnerLocation = {
    ...defaultState.partnerLocation,
    ...(dataSource.partnerLocation && typeof dataSource.partnerLocation === "object"
      ? dataSource.partnerLocation
      : {})
  };

  const nextMessages = Array.isArray(dataSource.messages)
    ? normalizeMessagesForRole(dataSource.messages)
    : normalizeMessagesForRole(defaultState.messages);

  const nextMemories = Array.isArray(dataSource.memories)
    ? JSON.parse(JSON.stringify(dataSource.memories))
    : JSON.parse(JSON.stringify(defaultState.memories));

  const importedMood =
    dataSource.partnerMood === "Kahve molasında"
      ? "Uyuyor"
      : typeof dataSource.partnerMood === "string" && dataSource.partnerMood.trim()
      ? dataSource.partnerMood
      : defaultState.partnerMood;

  const todayKey = getLocalDayKey();
  const sameDay = dataSource.missDayKey === todayKey;

  state.startDate = nextStartDate;
  state.specialEvent = nextSpecialEvent;
  state.myName = myRole === "userB" ? "Emine" : "Samet";
  state.partnerName = myRole === "userB" ? "Samet" : "Emine";

  if (typeof dataSource.myAvatar === "string") state.myAvatar = dataSource.myAvatar;
  if (typeof dataSource.partnerAvatar === "string") state.partnerAvatar = dataSource.partnerAvatar;
  if (typeof dataSource.myNote === "string") state.myNote = dataSource.myNote;
  if (typeof dataSource.partnerNote === "string") state.partnerNote = dataSource.partnerNote;

  state.myLocation = nextMyLocation;
  state.partnerLocation = nextPartnerLocation;
  state.partnerMood = importedMood;
  state.myMissCount =
    sameDay && typeof dataSource.myMissCount === "number" && !Number.isNaN(dataSource.myMissCount)
      ? dataSource.myMissCount
      : 0;
  state.partnerMissCount =
    sameDay &&
    typeof dataSource.partnerMissCount === "number" &&
    !Number.isNaN(dataSource.partnerMissCount)
      ? dataSource.partnerMissCount
      : 0;
  state.missDayKey = todayKey;
  state.missCount =
    sameDay && typeof dataSource.missCount === "number" && !Number.isNaN(dataSource.missCount)
      ? dataSource.missCount
      : 0;
  state.lastMissTime =
    typeof dataSource.lastMissTime === "string" ? dataSource.lastMissTime : null;
  state.distanceKm =
    typeof dataSource.distanceKm === "number" && !Number.isNaN(dataSource.distanceKm)
      ? dataSource.distanceKm
      : defaultState.distanceKm;
  state.messages = nextMessages;
  state.memories = nextMemories;
  state.typingByRole = {
    userA: Boolean(dataSource.typingByRole?.userA),
    userB: Boolean(dataSource.typingByRole?.userB)
  };
}

const saved = loadSavedState();
const adminFlag = readAdminOwnerFlag();

const initialMood =
  saved.partnerMood === "Kahve molasında"
    ? "Uyuyor"
    : saved.partnerMood || defaultState.partnerMood;

const todayKey = getLocalDayKey();
const isSameDay = saved.missDayKey === todayKey;

export const state = {
  ...defaultState,
  ...saved,
  partnerMood: initialMood,
  moods: defaultState.moods,
  myMissCount:
    isSameDay && typeof saved.myMissCount === "number" && !Number.isNaN(saved.myMissCount)
      ? saved.myMissCount
      : 0,
  partnerMissCount:
    isSameDay &&
    typeof saved.partnerMissCount === "number" &&
    !Number.isNaN(saved.partnerMissCount)
      ? saved.partnerMissCount
      : 0,
  missDayKey: todayKey,
  missCount:
    isSameDay && typeof saved.missCount === "number" && !Number.isNaN(saved.missCount)
      ? saved.missCount
      : 0,
  specialEvent: {
    ...defaultState.specialEvent,
    ...(saved.specialEvent || {})
  },
  myLocation: {
    ...defaultState.myLocation,
    ...(saved.myLocation && typeof saved.myLocation === "object" ? saved.myLocation : {})
  },
  partnerLocation: {
    ...defaultState.partnerLocation,
    ...(saved.partnerLocation && typeof saved.partnerLocation === "object"
      ? saved.partnerLocation
      : {})
  },
  messages: Array.isArray(saved.messages)
    ? normalizeMessagesForRole(saved.messages)
    : normalizeMessagesForRole(defaultState.messages),
  memories: Array.isArray(saved.memories) ? saved.memories : defaultState.memories,
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

applyRoleNamesToState();

let suppressNextCloudPush = false;
let cloudListenerStarted = false;

export function syncDailyMissReset() {
  const currentKey = getLocalDayKey();
  if (state.missDayKey !== currentKey) {
    state.missDayKey = currentKey;
    state.myMissCount = 0;
    state.partnerMissCount = 0;
    state.missCount = 0;
    saveState({ pushCloud: true });
    return true;
  }
  return false;
}

export function buildPersistPayload() {
  return {
    startDate: state.startDate,
    specialEvent: state.specialEvent,
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
  const partnerRole = myRole === "userA" ? "userB" : "userA";
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
  } catch {
    // Sessiz geç
  }

  Object.keys(defaultState).forEach((key) => {
    const val = defaultState[key];
    if (Array.isArray(val)) {
      state[key] = JSON.parse(JSON.stringify(val));
    } else if (val && typeof val === "object") {
      state[key] = JSON.parse(JSON.stringify(val));
    } else {
      state[key] = val;
    }
  });

  applyRoleNamesToState();
  state.messages = normalizeMessagesForRole(state.messages);
  state.missDayKey = getLocalDayKey();
  state.myMissCount = 0;
  state.partnerMissCount = 0;
  state.missCount = 0;
  state.isAdminOwner = keepAdmin;
  state.activeTab = keepAdmin ? "admin" : "biz";
  saveState({ pushCloud: true });
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
