import { state, saveState, getDeviceRole, nowTime, writeMyProfileChanges } from "./state.js";

const LOCAL_CACHE_KEY = "biz_konum_cache_v1";

function readCachedLocations() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCachedLocation(role, record) {
  try {
    const current = readCachedLocations();
    current[role] = record;
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(current));
  } catch {
    // Sessiz geç
  }
}

function calculateDistanceKm(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      sinHalfLng *
      sinHalfLng;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistanceText(km) {
  if (typeof km !== "number" || !Number.isFinite(km) || km < 0) return "0.0 km";
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))} m`;
  return `${km.toFixed(1)} km`;
}

function calculateProgressPercent(km, hasBoth) {
  if (!hasBoth || typeof km !== "number" || !Number.isFinite(km)) return 15;
  if (km <= 0.2) return 100;
  if (km >= 100) return 20;
  return Math.max(20, Math.min(96, Math.round(100 - (km / 100) * 76)));
}

function extractCoords(entry) {
  if (!entry || typeof entry !== "object") return null;
  const lat = Number(entry.lat);
  const lng = Number(entry.lng ?? entry.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function isValidLocationRecord(entry) {
  if (!entry || typeof entry !== "object") return false;
  const hasCoords = Boolean(extractCoords(entry));
  const hasAddress = Boolean(String(entry.address || entry.label || "").trim());
  return hasCoords || hasAddress;
}

function pickNewestRecord(...candidates) {
  const valid = candidates.filter(isValidLocationRecord);
  if (valid.length === 0) return null;
  valid.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
  return valid[0];
}

function getPairLocations() {
  const role = getDeviceRole() || "userA";
  const partnerRole = role === "userA" ? "userB" : "userA";
  const cache = readCachedLocations();

  const mine = pickNewestRecord(
    state.userProfiles?.[role]?.location,
    state.myLocation,
    cache[role]
  );

  const partner = pickNewestRecord(
    state.userProfiles?.[partnerRole]?.location,
    state.partnerLocation,
    cache[partnerRole]
  );

  return { role, partnerRole, mine, partner };
}

function saveMineLocation(role, nextData) {
  const normalized = {
    ...nextData,
    lon: nextData.lng
  };

  writeMyProfileChanges({ location: normalized });
  state.myLocation = normalized;
  writeCachedLocation(role, normalized);
}

async function resolveAddressFromCoords(lat, lng) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);

  try {
    const endpoint =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
      `&zoom=17&addressdetails=1&accept-language=tr`;

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;

    const json = await response.json();
    const addr = json?.address || {};

    const streetOrArea =
      addr.road ||
      addr.pedestrian ||
      addr.neighbourhood ||
      addr.suburb ||
      "";
    const district =
      addr.town ||
      addr.county ||
      addr.district ||
      addr.city_district ||
      "";
    const city =
      addr.province ||
      addr.state ||
      addr.city ||
      "";

    const rawParts = [streetOrArea, district, city]
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    const unique = [];
    for (const part of rawParts) {
      if (!unique.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
        unique.push(part);
      }
    }

    if (unique.length > 0) {
      return unique.join(", ");
    }

    if (typeof json?.display_name === "string" && json.display_name.trim()) {
      return json.display_name
        .split(",")
        .slice(0, 3)
        .map((s) => s.trim())
        .join(", ");
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function runWithTimeout(promise, ms, message = "Konum isteği zaman aşımına uğradı.") {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

function listenOnceForPosition(options, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== "function") {
      reject(new Error("Bu cihazda konum servisi bulunamadı."));
      return;
    }

    let finished = false;
    let watchId = null;

    const stopWatch = () => {
      if (watchId !== null && typeof navigator.geolocation.clearWatch === "function") {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      stopWatch();
      reject(new Error("Konum sinyali zaman aşımına uğradı."));
    }, timeoutMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          stopWatch();
          resolve({
            lat: Number(Number(pos.coords.latitude).toFixed(6)),
            lng: Number(Number(pos.coords.longitude).toFixed(6))
          });
        },
        (err) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          stopWatch();
          reject(err);
        },
        options
      );
    } catch (err) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        stopWatch();
        reject(err);
      }
    }
  });
}

async function fetchCurrentPosition() {
  const capGeo =
    window.Capacitor?.Plugins?.Geolocation ||
    window.Capacitor?.getPlugin?.("Geolocation") ||
    null;

  if (capGeo && typeof capGeo.getCurrentPosition === "function") {
    if (typeof capGeo.requestPermissions === "function") {
      try {
        await runWithTimeout(capGeo.requestPermissions(), 6000);
      } catch {
        // Devam et
      }
    }
    try {
      const result = await runWithTimeout(
        capGeo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 }),
        11000
      );
      if (result?.coords && Number.isFinite(Number(result.coords.latitude))) {
        return {
          lat: Number(Number(result.coords.latitude).toFixed(6)),
          lng: Number(Number(result.coords.longitude).toFixed(6))
        };
      }
    } catch {
      // Tarayıcı konum servisine düş
    }
  }

  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
    throw new Error("Bu cihazda konum servisi desteklenmiyor.");
  }

  const getSingle = (options, ms) =>
    runWithTimeout(
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              lat: Number(Number(pos.coords.latitude).toFixed(6)),
              lng: Number(Number(pos.coords.longitude).toFixed(6))
            }),
          (err) => reject(err),
          options
        );
      }),
      ms
    );

  try {
    return await getSingle({ enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }, 8000);
  } catch {
    try {
      return await getSingle({ enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }, 10000);
    } catch {
      return await listenOnceForPosition({ enableHighAccuracy: false, maximumAge: 60000 }, 12000);
    }
  }
}

function getFriendlyError(err) {
  if (err?.code === 1) {
    return "Konum izni kapalı. Konum iznini açıp tekrar dene.";
  }
  if (err?.code === 2) {
    return "Konum sinyali alınamadı. Telefonun Konum (GPS) servisinin açık olduğundan emin ol.";
  }
  if (err?.code === 3) {
    return "Konum alma süresi doldu. Tekrar dene.";
  }
  return err?.message || "Konum alınamadı. Konum iznini ve GPS servisini kontrol et.";
}

function createMapsLink(coords) {
  if (!coords) return "";
  return `https://www.google.com/maps?q=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
}

export function renderKonum(containerEl, notice = null) {
  const myTitle = state.myName || "Samet";
  const partnerTitle = state.partnerName || "Emine";

  const { role, mine, partner } = getPairLocations();
  const myCoords = extractCoords(mine);
  const partnerCoords = extractCoords(partner);

  const hasBothCoords = Boolean(myCoords && partnerCoords);
  const computedKm = hasBothCoords
    ? Number(calculateDistanceKm(myCoords, partnerCoords).toFixed(1))
    : Number(state.distanceKm || 0);

  if (hasBothCoords) {
    state.distanceKm = computedKm;
  }

  const distanceLabel = formatDistanceText(computedKm);
  const progressPercent = calculateProgressPercent(computedKm, hasBothCoords);

  const myAddress =
    mine?.address || mine?.label || (myCoords ? `${myCoords.lat}, ${myCoords.lng}` : "Henüz paylaşılmadı");
  const myTime = mine?.updatedAt ? `Güncel: ${mine.updatedAt}` : "Henüz güncellenmedi";

  const partnerAddress =
    partner?.address ||
    partner?.label ||
    (partnerCoords ? `${partnerCoords.lat}, ${partnerCoords.lng}` : "Henüz paylaşılmadı");
  const partnerTime = partner?.updatedAt ? `Güncel: ${partner.updatedAt}` : "Henüz güncellenmedi";

  const myMapHref = createMapsLink(myCoords);
  const partnerMapHref = createMapsLink(partnerCoords);

  const statusText = hasBothCoords
    ? `${myTitle} ve ${partnerTitle} arası ${distanceLabel}`
    : myCoords
    ? `${myTitle} konumunu paylaştı · ${partnerTitle} bekleniyor`
    : partnerCoords
    ? `${partnerTitle} konumunu paylaştı · Sıra sende`
    : "Konumunu aldığında mesafe ve adres burada görünür";

  containerEl.innerHTML = `
    <div class="konum-page">
      <section class="distance-banner">
        <div class="distance-banner-head">
          <span class="distance-title">Aramızdaki Mesafe</span>
          <span class="distance-value-pill">${distanceLabel}</span>
        </div>

        <div class="distance-meter">
          <div class="distance-track">
            <div class="distance-track-bar" style="width:${progressPercent}%;"></div>
          </div>
          <div class="distance-caption">
            <span>${myTitle} ↔ ${partnerTitle}</span>
            <span>${statusText}</span>
          </div>
        </div>
      </section>

      <section class="loc-card loc-card--mine">
        <div class="loc-card-top">
          <span class="loc-person-badge">
            <span class="loc-dot loc-dot--mine"></span>
            ${myTitle} (Sen)
          </span>
          <span class="loc-time-tag">${myTime}</span>
        </div>

        <div class="loc-address-main">${myAddress}</div>

        <div class="loc-coords-box">
          ${
            myCoords
              ? `Koordinatlar: ${myCoords.lat.toFixed(6)}, ${myCoords.lng.toFixed(6)}`
              : "Koordinatlar: Henüz alınmadı"
          }
        </div>

        <div class="loc-btn-row">
          <button type="button" class="loc-primary-btn" id="btn-fetch-location">Konumu Al</button>
          ${
            myMapHref
              ? `<a href="${myMapHref}" target="_blank" rel="noopener noreferrer" class="loc-map-btn">Haritada Aç</a>`
              : `<span class="loc-map-btn loc-map-btn--disabled">Haritada Aç</span>`
          }
          <span id="loc-live-status" class="muted-note"></span>
        </div>

        ${
          notice?.type === "ok"
            ? `<div class="loc-alert loc-alert--ok">${notice.message}</div>`
            : notice?.type === "err"
            ? `<div class="loc-alert loc-alert--err">${notice.message}</div>`
            : ""
        }
      </section>

      <section class="loc-card loc-card--partner">
        <div class="loc-card-top">
          <span class="loc-person-badge">
            <span class="loc-dot loc-dot--partner"></span>
            ${partnerTitle}
          </span>
          <span class="loc-time-tag">${partnerTime}</span>
        </div>

        <div class="loc-address-main">${partnerAddress}</div>

        <div class="loc-coords-box">
          ${
            partnerCoords
              ? `Koordinatlar: ${partnerCoords.lat.toFixed(6)}, ${partnerCoords.lng.toFixed(6)}`
              : "Koordinatlar: Henüz alınmadı"
          }
        </div>

        <div class="loc-btn-row">
          ${
            partnerMapHref
              ? `<a href="${partnerMapHref}" target="_blank" rel="noopener noreferrer" class="loc-map-btn">Haritada Aç</a>`
              : `<span class="loc-map-btn loc-map-btn--disabled">Haritada Aç</span>`
          }
          <span class="muted-note">Mesafe: ${distanceLabel}</span>
        </div>
      </section>
    </div>
  `;

  document.getElementById("btn-fetch-location")?.addEventListener("click", async () => {
    const fetchBtn = document.getElementById("btn-fetch-location");
    const liveStatus = document.getElementById("loc-live-status");

    if (fetchBtn) fetchBtn.disabled = true;
    if (liveStatus) liveStatus.textContent = "Konum ve adres alınıyor...";

    try {
      const { lat, lng } = await fetchCurrentPosition();
      const resolvedAddress = await resolveAddressFromCoords(lat, lng);
      const finalAddress = resolvedAddress || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

      const nextRecord = {
        ...(mine || {}),
        role,
        address: finalAddress,
        label: finalAddress,
        lat,
        lng,
        lon: lng,
        ts: Date.now(),
        updatedAt: nowTime()
      };

      saveMineLocation(role, nextRecord);

      const latestPair = getPairLocations();
      const latestPartnerCoords = extractCoords(latestPair.partner);
      if (latestPartnerCoords) {
        state.distanceKm = Number(
          calculateDistanceKm({ lat, lng }, latestPartnerCoords).toFixed(1)
        );
      }

      saveState({ pushCloud: true });
      renderKonum(containerEl, {
        type: "ok",
        message: `Konum güncellendi: ${finalAddress}`
      });
    } catch (error) {
      renderKonum(containerEl, {
        type: "err",
        message: getFriendlyError(error)
      });
    }
  });
}
