import { state, saveState, getDeviceRole, nowTime } from "./state.js";

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCoords(locObj) {
  if (!locObj || typeof locObj !== "object") return null;
  const lat = Number(locObj.lat);
  const lng = Number(locObj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function resolveLocations() {
  const role = getDeviceRole() || "userA";
  const partnerRole = role === "userA" ? "userB" : "userA";

  const myLoc =
    state.myLocation ||
    state.locations?.[role] ||
    (role === "userA" ? state.userALocation : state.userBLocation) ||
    null;

  const partnerLoc =
    state.partnerLocation ||
    state.locations?.[partnerRole] ||
    (role === "userA" ? state.userBLocation : state.userALocation) ||
    null;

  return { role, partnerRole, myLoc, partnerLoc };
}

function writeMyLocation(role, nextLoc) {
  state.myLocation = nextLoc;
  if (state.locations && typeof state.locations === "object") {
    state.locations[role] = nextLoc;
  }
  if (role === "userA") {
    state.userALocation = nextLoc;
  } else {
    state.userBLocation = nextLoc;
  }
}

function formatDistance(kmValue) {
  const km = Number(kmValue || 0);
  if (!Number.isFinite(km) || km <= 0) return "0.0 km";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function getFillPercent(myCoords, partnerCoords, kmValue) {
  if (!myCoords || !partnerCoords) return 20;
  const km = Number(kmValue || 0);
  if (km <= 0.2) return 100;
  if (km >= 50) return 25;
  return Math.max(25, Math.min(96, Math.round(100 - (km / 50) * 71)));
}

function buildMapsUrl(coords, labelText) {
  if (!coords) return "#";
  const q = encodeURIComponent(
    labelText ? `${coords.lat},${coords.lng} (${labelText})` : `${coords.lat},${coords.lng}`
  );
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

async function fetchShortAddress(lat, lng) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1&accept-language=tr`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;

    const data = await res.json();
    const addr = data?.address || {};

    const neighbourhood =
      addr.neighbourhood ||
      addr.suburb ||
      addr.quarter ||
      "";
    const district =
      addr.county ||
      addr.town ||
      addr.district ||
      addr.city_district ||
      "";
    const city =
      addr.province ||
      addr.state ||
      addr.city ||
      "";

    const parts = [neighbourhood, district, city]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const uniqueParts = [];
    for (const item of parts) {
      if (!uniqueParts.some((u) => u.toLowerCase() === item.toLowerCase())) {
        uniqueParts.push(item);
      }
    }

    if (uniqueParts.length >= 2) {
      return uniqueParts.slice(-2).join(", ");
    }
    return uniqueParts[0] || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout(promise, ms, msg = "Konum alma süresi doldu.") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function watchSinglePosition(options, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== "function") {
      reject(new Error("Bu cihazda konum servisi bulunamadı."));
      return;
    }

    let settled = false;
    let watchId = null;

    const cleanup = () => {
      if (watchId !== null && typeof navigator.geolocation.clearWatch === "function") {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Konum sinyali zaman aşımına uğradı."));
    }, timeoutMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve({
            lat: Number(Number(pos.coords.latitude).toFixed(6)),
            lng: Number(Number(pos.coords.longitude).toFixed(6))
          });
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(err);
        },
        options
      );
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    }
  });
}

async function acquireDevicePosition() {
  const capGeo =
    window.Capacitor?.Plugins?.Geolocation ||
    window.Capacitor?.getPlugin?.("Geolocation") ||
    null;

  if (capGeo && typeof capGeo.getCurrentPosition === "function") {
    if (typeof capGeo.requestPermissions === "function") {
      try {
        await withTimeout(capGeo.requestPermissions(), 6000);
      } catch {
        // İzin kontrolü devam edecek
      }
    }
    try {
      const pos = await withTimeout(
        capGeo.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 }),
        11000
      );
      if (pos?.coords && Number.isFinite(Number(pos.coords.latitude))) {
        return {
          lat: Number(Number(pos.coords.latitude).toFixed(6)),
          lng: Number(Number(pos.coords.longitude).toFixed(6))
        };
      }
    } catch {
      // Navigator yedeğine geç
    }
  }

  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
    throw new Error("Bu ortamda konum servisi desteklenmiyor.");
  }

  const getOnce = (options, ms) =>
    withTimeout(
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
    return await getOnce({ enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }, 8000);
  } catch {
    try {
      return await getOnce({ enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }, 10000);
    } catch {
      return await watchSinglePosition({ enableHighAccuracy: false, maximumAge: 60000 }, 12000);
    }
  }
}

function explainGeoError(err) {
  const code = err?.code;
  if (code === 1) {
    return "Konum izni kapalı. Uygulama izinlerinden Konum iznini açıp tekrar dene.";
  }
  if (code === 2) {
    return "Konum sinyali alınamadı. Telefonun Konum (GPS) servisinin açık olduğundan emin ol.";
  }
  if (code === 3) {
    return "Konum alma süresi doldu. Konum servisini açıp tekrar dene.";
  }
  return err?.message || "Konum alınamadı. Konum iznini ve GPS'i kontrol et.";
}

export function renderKonum(contentEl, feedback = null) {
  const myName = state.myName || "Sen";
  const partnerName = state.partnerName || "Sevgilim";

  const { role, myLoc, partnerLoc } = resolveLocations();

  const myCoords = getCoords(myLoc);
  const partnerCoords = getCoords(partnerLoc);

  let kmValue = Number(state.distanceKm || 0);
  if (myCoords && partnerCoords) {
    kmValue = Number(
      haversineKm(myCoords.lat, myCoords.lng, partnerCoords.lat, partnerCoords.lng).toFixed(1)
    );
    state.distanceKm = kmValue;
  }

  const distanceText = formatDistance(kmValue);
  const fillPercent = getFillPercent(myCoords, partnerCoords, kmValue);

  const myPlaceText =
    myLoc?.label || (myCoords ? `${myCoords.lat}, ${myCoords.lng}` : "Henüz paylaşılmadı");
  const myUpdatedText = myLoc?.updatedAt ? `Güncel: ${myLoc.updatedAt}` : "Henüz güncellenmedi";

  const partnerPlaceText =
    partnerLoc?.label ||
    (partnerCoords ? `${partnerCoords.lat}, ${partnerCoords.lng}` : "Henüz paylaşılmadı");
  const partnerUpdatedText = partnerLoc?.updatedAt
    ? `Güncel: ${partnerLoc.updatedAt}`
    : "Henüz güncellenmedi";

  const myMapUrl = buildMapsUrl(myCoords, myPlaceText);
  const partnerMapUrl = buildMapsUrl(partnerCoords, partnerPlaceText);

  const statusNoteText =
    myCoords && partnerCoords
      ? `Aradaki mesafe: ${distanceText}`
      : myCoords
      ? `${partnerName} konumu bekleniyor`
      : `Konumunu alınca mesafe hesaplanır`;

  contentEl.innerHTML = `
    <div class="konum-layout">
      <div class="bridge-card">
        <div class="bridge-top">
          <div class="label" style="margin:0;">KONUM & MESAFE</div>
          <span class="bridge-distance-badge">${distanceText}</span>
        </div>

        <div class="bridge-bar-wrap">
          <div class="bridge-track">
            <div class="bridge-track-fill" style="width:${fillPercent}%;"></div>
          </div>
          <div class="bridge-meta-row">
            <span>${myName} ↔ ${partnerName}</span>
            <span>${statusNoteText}</span>
          </div>
        </div>

        <div class="person-row-box mine">
          <div class="person-row-head">
            <span class="person-tag">${myName} (Sen)</span>
            <span class="person-time">${myUpdatedText}</span>
          </div>
          <div class="person-address">${myPlaceText}</div>
          <div class="person-coords">
            ${myCoords ? `${myCoords.lat}, ${myCoords.lng}` : "Koordinat yok"}
          </div>
          <div class="person-actions">
            <button type="button" class="send-btn" id="get-my-location-btn">Konumumu Al</button>
            <a
              href="${myMapUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="map-open-btn ${myCoords ? "" : "disabled"}"
            >Haritada Aç</a>
            <span id="location-status-note" class="muted-note"></span>
          </div>
        </div>

        <div class="person-row-box partner">
          <div class="person-row-head">
            <span class="person-tag">${partnerName}</span>
            <span class="person-time">${partnerUpdatedText}</span>
          </div>
          <div class="person-address">${partnerPlaceText}</div>
          <div class="person-coords">
            ${partnerCoords ? `${partnerCoords.lat}, ${partnerCoords.lng}` : "Koordinat yok"}
          </div>
          <div class="person-actions">
            <a
              href="${partnerMapUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="map-open-btn ${partnerCoords ? "" : "disabled"}"
            >Haritada Aç</a>
          </div>
        </div>

        ${
          feedback?.type === "ok"
            ? `<div class="loc-feedback-ok">${feedback.text}</div>`
            : feedback?.type === "err"
            ? `<div class="loc-feedback-err">${feedback.text}</div>`
            : ""
        }
      </div>
    </div>
  `;

  document.getElementById("get-my-location-btn")?.addEventListener("click", async () => {
    const btnEl = document.getElementById("get-my-location-btn");
    const statusNote = document.getElementById("location-status-note");

    if (statusNote) statusNote.textContent = "Konum alınıyor...";
    if (btnEl) btnEl.disabled = true;

    try {
      const { lat, lng } = await acquireDevicePosition();
      const shortAddr = await fetchShortAddress(lat, lng);
      const label = shortAddr || `${lat}, ${lng}`;

      const updated = {
        ...(myLoc || {}),
        role,
        label,
        lat,
        lng,
        updatedAt: nowTime()
      };

      writeMyLocation(role, updated);

      const latestPartnerLoc = resolveLocations().partnerLoc;
      const latestPartnerCoords = getCoords(latestPartnerLoc);
      if (latestPartnerCoords) {
        state.distanceKm = Number(
          haversineKm(lat, lng, latestPartnerCoords.lat, latestPartnerCoords.lng).toFixed(1)
        );
      }

      saveState({ pushCloud: true });
      renderKonum(contentEl, { type: "ok", text: `Güncellendi: ${label}` });
    } catch (err) {
      renderKonum(contentEl, { type: "err", text: explainGeoError(err) });
    }
  });
}
