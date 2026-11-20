import { state, saveState, getDeviceRole, nowTime } from "./state.js";

// Buraya Google Cloud'dan aldığın Maps JavaScript API anahtarını yaz:
const GOOGLE_MAPS_API_KEY = "AIzaSyCTiezPlR3GFySZ9EdxnvMw1Rpf_U5AGAw";

let mapInstance = null;
let myMarker = null;
let partnerMarker = null;
let distanceLine = null;
let mapsScriptPromise = null;

function loadGoogleMapsApi() {
  if (window.google && window.google.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.startsWith("BURAYA_")) {
    return Promise.reject(new Error("GOOGLE_MAPS_API_KEY eksik"));
  }

  if (mapsScriptPromise) {
    return mapsScriptPromise;
  }

  mapsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-js-sdk");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.google && window.google.maps) resolve(window.google.maps);
        else reject(new Error("Google Maps yüklenemedi"));
      });
      existing.addEventListener("error", () => reject(new Error("Google Maps script hatası")));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-js-sdk";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      GOOGLE_MAPS_API_KEY
    )}&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google && window.google.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps nesnesi bulunamadı"));
      }
    };
    script.onerror = () => {
      mapsScriptPromise = null;
      reject(new Error("Google Maps API yüklenemedi"));
    };

    document.head.appendChild(script);
  });

  return mapsScriptPromise;
}

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
  return { lat, lng };
}

function computeDistanceLabel(myCoords, partnerCoords) {
  if (myCoords && partnerCoords) {
    const km = haversineKm(
      myCoords.lat,
      myCoords.lng,
      partnerCoords.lat,
      partnerCoords.lng
    );
    state.distanceKm = Number(km.toFixed(1));
    return `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}`;
  }
  const fallbackKm = Number(state.distanceKm || 0);
  return `${fallbackKm.toFixed(1)} km`;
}

function initOrUpdateGoogleMap(myCoords, partnerCoords, myName, partnerName) {
  const canvasEl = document.getElementById("google-map-canvas");
  if (!canvasEl) return;

  loadGoogleMapsApi()
    .then((maps) => {
      const defaultCenter = myCoords || partnerCoords || { lat: 39.9334, lng: 32.8597 };

      if (!mapInstance) {
        mapInstance = new maps.Map(canvasEl, {
          center: defaultCenter,
          zoom: 13,
          gestureHandling: "greedy",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true
        });
      }

      if (myMarker) myMarker.setMap(null);
      if (partnerMarker) partnerMarker.setMap(null);
      if (distanceLine) distanceLine.setMap(null);

      const bounds = new maps.LatLngBounds();
      let pointCount = 0;

      if (myCoords) {
        myMarker = new maps.Marker({
          position: myCoords,
          map: mapInstance,
          title: `${myName} (Sen)`,
          label: {
            text: (myName[0] || "S").toUpperCase(),
            color: "#ffffff",
            fontWeight: "700"
          }
        });
        bounds.extend(myCoords);
        pointCount += 1;
      }

      if (partnerCoords) {
        partnerMarker = new maps.Marker({
          position: partnerCoords,
          map: mapInstance,
          title: `${partnerName}`,
          label: {
            text: (partnerName[0] || "P").toUpperCase(),
            color: "#ffffff",
            fontWeight: "700"
          }
        });
        bounds.extend(partnerCoords);
        pointCount += 1;
      }

      if (myCoords && partnerCoords) {
        distanceLine = new maps.Polyline({
          path: [myCoords, partnerCoords],
          geodesic: true,
          strokeColor: "#e62e65",
          strokeOpacity: 0.9,
          strokeWeight: 4
        });
        distanceLine.setMap(mapInstance);
      }

      if (pointCount >= 2) {
        mapInstance.fitBounds(bounds, 60);
      } else if (pointCount === 1) {
        mapInstance.setCenter(myCoords || partnerCoords);
        mapInstance.setZoom(14);
      } else {
        mapInstance.setCenter(defaultCenter);
        mapInstance.setZoom(11);
      }
    })
    .catch(() => {
      canvasEl.innerHTML = `
        <div class="map-fallback-box">
          <strong>Google Haritalar yüklenemedi</strong>
          <span><code>www/js/konum.js</code> içindeki <code>GOOGLE_MAPS_API_KEY</code> alanına geçerli bir Google Maps JavaScript API anahtarı girdiğinden ve internet bağlantısının açık olduğundan emin ol.</span>
        </div>
      `;
    });
}

export function renderKonum(contentEl) {
  mapInstance = null;

  const myName = state.myName || "Sen";
  const partnerName = state.partnerName || "Partner";

  const myLoc = state.myLocation || null;
  const partnerLoc = state.partnerLocation || null;

  const myCoords = getCoords(myLoc);
  const partnerCoords = getCoords(partnerLoc);
  const distanceText = computeDistanceLabel(myCoords, partnerCoords);

  const myPlaceText = myLoc?.label || "Henüz paylaşılmadı";
  const myUpdatedText = myLoc?.updatedAt ? `Güncel: ${myLoc.updatedAt}` : "Güncel: Henüz güncellenmedi";

  const partnerPlaceText = partnerLoc?.label || "Henüz paylaşılmadı";
  const partnerUpdatedText = partnerLoc?.updatedAt
    ? `Güncel: ${partnerLoc.updatedAt}`
    : "Güncel: Henüz güncellenmedi";

  contentEl.innerHTML = `
    <div class="konum-layout">
      <div class="map-card">
        <div class="map-header-row">
          <div class="label" style="margin:0;">CANLI HARİTA VE MESAFE</div>
          <span class="map-distance-badge" id="map-distance-badge">Aradaki mesafe: ${distanceText}</span>
        </div>

        <div class="map-participants-line">
          <strong>${myName}:</strong> ${myPlaceText} · <strong>${partnerName}:</strong> ${partnerPlaceText}
        </div>

        <div id="google-map-canvas" class="google-map-canvas"></div>

        <div class="map-actions-row">
          <span class="map-hint-text">Parmağınla haritada gezinebilir, yakınlaşıp uzaklaşabilirsin.</span>
          <button type="button" class="tool-btn" id="center-both-btn">İkisini Ortala</button>
        </div>
      </div>

      <div class="card">
        <div class="row-between">
          <div class="label">SENİN KONUMUN</div>
          <span class="badge">${myUpdatedText}</span>
        </div>
        <h3 style="margin:6px 0 10px;">${myPlaceText}</h3>

        <div class="row" style="gap:8px;margin-bottom:10px;">
          <input
            type="text"
            id="location-label-input"
            class="msg-input plain-input"
            placeholder="Yer adı yaz (Örn: Ev, Kampüs)"
            value="${(myLoc?.label || "").replace(/"/g, "&quot;")}"
          />
          <button type="button" class="tool-btn" id="save-location-label-btn">Kaydet</button>
        </div>

        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="send-btn" id="get-my-location-btn">Konumumu Al</button>
          <span id="location-status-note" class="muted-note"></span>
        </div>
      </div>

      <div class="card">
        <div class="row-between">
          <div class="label">${partnerName.toUpperCase()} KONUMU</div>
          <span class="badge">${partnerUpdatedText}</span>
        </div>
        <h3 style="margin:6px 0 6px;">${partnerPlaceText}</h3>
        <div class="muted-note">Aradaki mesafe: ${distanceText}</div>
      </div>
    </div>
  `;

  initOrUpdateGoogleMap(myCoords, partnerCoords, myName, partnerName);

  document.getElementById("center-both-btn")?.addEventListener("click", () => {
    initOrUpdateGoogleMap(myCoords, partnerCoords, myName, partnerName);
  });

  document.getElementById("save-location-label-btn")?.addEventListener("click", () => {
    const inputEl = document.getElementById("location-label-input");
    const label = (inputEl?.value || "").trim();
    if (!label) return;

    state.myLocation = {
      ...(state.myLocation || {}),
      role: getDeviceRole() || "userA",
      label,
      updatedAt: nowTime()
    };

    saveState({ pushCloud: true });
    renderKonum(contentEl);
  });

  document.getElementById("get-my-location-btn")?.addEventListener("click", () => {
    const statusNote = document.getElementById("location-status-note");

    if (!navigator.geolocation) {
      if (statusNote) statusNote.textContent = "Bu cihazda konum servisi desteklenmiyor.";
      return;
    }

    if (statusNote) statusNote.textContent = "Konum alınıyor...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const inputEl = document.getElementById("location-label-input");
        const typedLabel = (inputEl?.value || "").trim();

        state.myLocation = {
          ...(state.myLocation || {}),
          role: getDeviceRole() || "userA",
          label: typedLabel || state.myLocation?.label || `${lat}, ${lng}`,
          lat,
          lng,
          updatedAt: nowTime()
        };

        if (partnerCoords) {
          state.distanceKm = Number(
            haversineKm(lat, lng, partnerCoords.lat, partnerCoords.lng).toFixed(1)
          );
        }

        saveState({ pushCloud: true });
        renderKonum(contentEl);
      },
      () => {
        if (statusNote) {
          statusNote.textContent = "Konum izni verilmedi veya GPS alınamadı.";
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  });
}
