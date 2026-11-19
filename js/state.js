import { db, ref, set, onValue } from "./firebase.js";

const STORAGE_KEY = "biz_app_state_v1";
const ADMIN_OWNER_KEY = "biz_admin_owner_v1";
const DEVICE_ROLE_KEY = "biz_device_role_v1"; // "userA" veya "userB"
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
  myName: "Sen",
  partnerName: "Sevgilim",
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
      author: "Sen",
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
    let role = localStorage.getItem(DEVICE_ROLE_KEY);
    if (!role) {
      role = window.location.hash === "#partner" ? "userB" : "userA";
      localStorage.setItem(DEVICE_ROLE_KEY, role);
    }
    return role;
  } catch {
    return "userA";
  }
}

export function setDeviceRole(role) {
  const safeRole = role === "userB" ? "userB" : "userA";
  try {
    localStorage.setItem(DEVICE_ROLE_KEY, safeRole);
  } catch {
    // Sessiz geç
  }
  return safeRole;
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

const saved = loadSavedState();
const adminFlag = readAdminOwnerFlag();

function normalizeMessagesForRole(rawMessages) {
  const myRole = getDeviceRole();
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map((msg) => {
    const authorRole =
      msg.authorRole || (msg.sender === "me" ? "userA" : "userB");
    return {
      ...msg,
      authorRole,
      sender: authorRole === myRole ? "me" : "them"
    };
  });
}

function applySharedSnapshot(dataSource, fromCloud = false) {
  if (!dataSource || typeof dataSource !== "object") return;

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
    : JSON.parse(JSON.stringify(defaultState.messages));

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

  if (!fromCloud) {
    state.myName =
      typeof dataSource.myName === "string" && dataSource.myName.trim()
        ? dataSource.myName
        : defaultState.myName;
    state.partnerName =
      typeof dataSource.partnerName === "string" && dataSource.partnerName.trim()
        ? dataSource.partnerName
        : defaultState.partnerName;
    state.myAvatar = typeof dataSource.myAvatar === "string" ? dataSource.myAvatar : null;
    state.partnerAvatar =
      typeof dataSource.partnerAvatar === "string" ? dataSource.partnerAvatar : null;
    state.myNote =
      typeof dataSource.myNote === "string" ? dataSource.myNote : defaultState.myNote;
    state.myLocation = nextMyLocation;
    state.partnerLocation = nextPartnerLocation;
  } else {
    // Buluttan gelen veride isim/not/konum alanlarını eşle
    if (typeof dataSource.myName === "string" && dataSource.myName.trim()) {
      state.partnerName = dataSource.myName;
    }
    if (typeof dataSource.myNote === "string") {
      state.partnerNote = dataSource.myNote;
    }
    if (dataSource.myLocation && typeof dataSource.myLocation === "object") {
      state.partnerLocation = {
        ...defaultState.partnerLocation,
        ...dataSource.myLocation
      };
    }
  }

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
}

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
    : defaultState.messages,
  memories: Array.isArray(saved.memories) ? saved.memories : defaultState.memories,
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

let suppressNextCloudPush = false;
let cloudListenerStarted = false;

export function syncDailyMissReset() {
  const currentKey = getLocalDayKey();
  if (state.missDayKey !== currentKey) {
    state.missDayKey = currentKey;
    state.myMissCount = 0;
    state.partnerMissCount = 0;
    state.missCount = 0;
    saveState();
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
    updatedBy: getDeviceRole(),
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

export function initRealtimeSync(onRemoteUpdate) {
  if (cloudListenerStarted) return;
  cloudListenerStarted = true;

  const roomRef = ref(db, SHARED_ROOM_PATH);
  onValue(roomRef, (snapshot) => {
    const val = snapshot.val();
    if (!val || typeof val !== "object") return;
    if (val.updatedBy && val.updatedBy === getDeviceRole()) return;

    suppressNextCloudPush = true;
    applySharedSnapshot(val, true);

    // Karşı tarafın gönderdiği mesajlar bu cihaza ulaştıysa 'delivered' yap
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

  applySharedSnapshot(dataSource, false);
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
