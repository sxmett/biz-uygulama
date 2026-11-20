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
  if (!myCoords || !partnerCoords) return 22;
  const km = Number(kmValue || 0);
  if (km <= 0.2) return 100;
  if (km >= 50) return 25;
  return Math.max(25, Math.min(96, Math.round(100 - (km / 50) * 71)));
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
        // İzin durumu getCurrentPosition'da netleşecek
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
    return "Konum izni kapalı. Telefon Ayarları -> Uygulamalar -> Konum iznini 'İzin ver' yap.";
  }
  if (code === 2) {
    return "Konum sinyali alınamadı. Telefonun Konum (GPS) servisinin açık olduğundan emin ol.";
  }
  if (code === 3) {
    return "Konum alma süresi doldu. Konum servisini açıp tekrar dene.";
  }
  return err?.message || "Konum alınamadı. Konum iznini ve GPS'i kontrol et.";
}

export function renderKonum(contentEl) {
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

  const myPlaceText = myLoc?.label || (myCoords ? `${myCoords.lat}, ${myCoords.lng}` : "Henüz paylaşılmadı");
  const myUpdatedText = myLoc?.updatedAt ? `Güncel: ${myLoc.updatedAt}` : "Güncel: Henüz güncellenmedi";

  const partnerPlaceText =
    partnerLoc?.label || (partnerCoords ? `${partnerCoords.lat}, ${partnerCoords.lng}` : "Henüz paylaşılmadı");
  const partnerUpdatedText = partnerLoc?.updatedAt
    ? `Güncel: ${partnerLoc.updatedAt}`
    : "Güncel: Henüz güncellenmedi";

  const statusSummary =
    myCoords && partnerCoords
      ? `İki konum da güncel · Aradaki mesafe: ${distanceText}`
      : myCoords
      ? `${myName} konumunu paylaştı · ${partnerName} bekleniyor`
      : partnerCoords
      ? `${partnerName} konumunu paylaştı · Sıra sende`
      : `Konumunu paylaştığında mesafe köprüsü burada canlanır`;

  contentEl.innerHTML = `
    <div class="konum-layout">
      <div class="radar-hero-card">
        <div class="radar-top-row">
          <div class="label" style="margin:0;">MESAFE KÖPRÜSÜ</div>
          <span class="radar-pill">${distanceText}</span>
        </div>

        <div class="radar-bridge">
          <div class="radar-person">
            <div class="radar-avatar">${(myName[0] || "S").toUpperCase()}</div>
            <div class="radar-person-name">${myName}</div>
            <div class="radar-person-place">${myPlaceText}</div>
          </div>

          <div class="radar-track-wrap">
            <span class="radar-distance-chip">${distanceText}</span>
            <div class="radar-track">
              <div class="radar-track-fill" style="width:${fillPercent}%;"></div>
            </div>
          </div>

          <div class="radar-person">
            <div class="radar-avatar partner">${(partnerName[0] || "P").toUpperCase()}</div>
            <div class="radar-person-name">${partnerName}</div>
            <div class="radar-person-place">${partnerPlaceText}</div>
          </div>
        </div>

        <div class="radar-sub-status">${statusSummary}</div>
      </div>

      <div class="card loc-person-card mine">
        <div class="row-between">
          <div class="label">SENİN KONUMUN · ${myName.toUpperCase()}</div>
          <span class="badge">${myUpdatedText}</span>
        </div>
        <h3 style="margin:8px 0 4px;">${myPlaceText}</h3>
        ${
          myCoords
            ? `<div class="loc-coords-pill">Enlem: ${myCoords.lat} · Boylam: ${myCoords.lng}</div>`
            : `<div class="loc-coords-pill">Henüz konum çekilmedi</div>`
        }

        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="send-btn" id="get-my-location-btn">Konumumu Al</button>
          <span id="location-status-note" class="muted-note"></span>
        </div>

        <div id="location-success-box" class="loc-success-box" style="display:none;"></div>
        <div id="location-error-box" class="loc-error-box" style="display:none;"></div>
      </div>

      <div class="card loc-person-card partner">
        <div class="row-between">
          <div class="label">SEVGİLİNİN KONUMU · ${partnerName.toUpperCase()}</div>
          <span class="badge">${partnerUpdatedText}</span>
        </div>
        <h3 style="margin:8px 0 4px;">${partnerPlaceText}</h3>
        ${
          partnerCoords
            ? `<div class="loc-coords-pill">Enlem: ${partnerCoords.lat} · Boylam: ${partnerCoords.lng}</div>`
            : `<div class="loc-coords-pill">Henüz konum paylaşılmadı</div>`
        }
        <div class="muted-note" style="margin-top:8px;">Aradaki mesafe: ${distanceText}</div>
      </div>
    </div>
  `;

  const showSuccess = (msg) => {
    const okBox = document.getElementById("location-success-box");
    const errBox = document.getElementById("location-error-box");
    if (errBox) errBox.style.display = "none";
    if (okBox) {
      okBox.style.display = "block";
      okBox.textContent = msg;
    }
  };

  const showError = (msg) => {
    const okBox = document.getElementById("location-success-box");
    const errBox = document.getElementById("location-error-box");
    if (okBox) okBox.style.display = "none";
    if (errBox) {
      errBox.style.display = "block";
      errBox.textContent = msg;
    }
  };

  document.getElementById("get-my-location-btn")?.addEventListener("click", async () => {
    const btnEl = document.getElementById("get-my-location-btn");
    const statusNote = document.getElementById("location-status-note");

    if (statusNote) statusNote.textContent = "Konum alınıyor...";
    if (btnEl) btnEl.disabled = true;

    try {
      const { lat, lng } = await acquireDevicePosition();
      const label = `${lat}, ${lng}`;

      const updated = {
        ...(myLoc || {}),
        role,
        label,
        lat,
        lng,
        updatedAt: nowTime()
      };

      writeMyLocation(role, updated);

      if (partnerCoords) {
        state.distanceKm = Number(
          haversineKm(lat, lng, partnerCoords.lat, partnerCoords.lng).toFixed(1)
        );
      }

      saveState({ pushCloud: true });
      renderKonum(contentEl);
      showSuccess(`Konumun güncellendi: ${lat}, ${lng}`);
    } catch (err) {
      if (btnEl) btnEl.disabled = false;
      if (statusNote) statusNote.textContent = "";
      showError(explainGeoError(err));
    }
  });
}
