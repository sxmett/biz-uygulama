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
  return { lat, lng };
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
  return Math.max(25, Math.min(95, Math.round(100 - (km / 50) * 70)));
}

export function renderKonum(contentEl) {
  const myName = state.myName || "Sen";
  const partnerName = state.partnerName || "Partner";

  const myLoc = state.myLocation || null;
  const partnerLoc = state.partnerLocation || null;

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

  const myPlaceText = myLoc?.label || "Henüz paylaşılmadı";
  const myUpdatedText = myLoc?.updatedAt ? `Güncel: ${myLoc.updatedAt}` : "Güncel: Henüz güncellenmedi";

  const partnerPlaceText = partnerLoc?.label || "Henüz paylaşılmadı";
  const partnerUpdatedText = partnerLoc?.updatedAt
    ? `Güncel: ${partnerLoc.updatedAt}`
    : "Güncel: Henüz güncellenmedi";

  const statusSummary =
    myCoords && partnerCoords
      ? `İki konum da aktif · Koordinat farkı hesaplandı`
      : myCoords || partnerCoords
      ? `Bir konum paylaşıldı · Mesafe için diğer konum bekleniyor`
      : `Konum paylaştığınızda aradaki mesafe burada görünür`;

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
