import {
  state,
  nowTime,
  saveState,
  calculateDistanceKm,
  getMapsUrl,
  showToast,
  requestLocationPermissionSafe,
  writeMyProfileChanges
} from "./state.js";

function hasValidCoords(loc) {
  return (
    loc &&
    typeof loc.lat === "number" &&
    typeof loc.lon === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lon)
  );
}

function refreshDistanceIfPossible() {
  if (hasValidCoords(state.myLocation) && hasValidCoords(state.partnerLocation)) {
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

async function resolveShortPlaceName(lat, lon) {
  const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&zoom=16&addressdetails=1`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeoutId);

    if (!res.ok) return fallback;
    const data = await res.json();
    const addr = data?.address || {};
    const parts = [
      addr.neighbourhood || addr.suburb || addr.quarter,
      addr.city_district || addr.town || addr.district || addr.city
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(", ") : fallback;
  } catch {
    return fallback;
  }
}

function buildMapLinkHtml(loc, labelText) {
  if (!hasValidCoords(loc)) return "";
  return `<a href="${getMapsUrl(loc.lat, loc.lon)}" target="_blank" rel="noopener noreferrer" class="map-link-btn">${labelText}</a>`;
}

export function renderKonum(contentEl) {
  refreshDistanceIfPossible();

  const prevManualInput = document.getElementById("manual-loc-input")?.value;
  const myLabelText = state.myLocation?.label || "Henüz paylaşılmadı";
  const myUpdatedText = state.myLocation?.updatedAt || "Henüz güncellenmedi";

  const partnerLabelText = state.partnerLocation?.label || "Henüz paylaşılmadı";
  const partnerUpdatedText = state.partnerLocation?.updatedAt || "Henüz güncellenmedi";

  contentEl.innerHTML = `
    <div class="loc-layout">
      <div class="card">
        <div class="loc-card-top">
          <div class="label" style="margin:0;">Mesafe Özeti</div>
          <span class="status-pill">${Number(state.distanceKm).toFixed(1)} km</span>
        </div>
        <p class="muted-note">
          ${state.myName || "Sen"}: <strong>${myLabelText}</strong> · ${
    state.partnerName || "Partner"
  }: <strong>${partnerLabelText}</strong>
        </p>
        <div id="loc-feedback" style="margin-top:10px;"></div>
      </div>

      <div class="card">
        <div class="loc-card-top">
          <div class="label" style="margin:0;">Senin Konumun</div>
          <span class="status-pill">Güncel: ${myUpdatedText}</span>
        </div>

        <div class="loc-place" id="my-loc-label">${myLabelText}</div>

        <div class="loc-edit-row">
          <input
            type="text"
            id="manual-loc-input"
            class="msg-input plain-input loc-edit-input"
            placeholder="Yer adı yaz (Örn: Ev, Kampüs)"
          />
          <button type="button" class="tool-btn" id="save-manual-loc-btn">Kaydet</button>
        </div>

        <div class="loc-actions">
          <button type="button" class="call-btn" id="get-gps-btn">Konumumu Al</button>
          ${buildMapLinkHtml(state.myLocation, "Haritada Aç")}
        </div>
      </div>

      <div class="card">
        <div class="loc-card-top">
          <div class="label" style="margin:0;">${state.partnerName || "Partner"} Konumu</div>
          <span class="status-pill">Güncel: ${partnerUpdatedText}</span>
        </div>

        <div class="loc-place">${partnerLabelText}</div>

        <div class="loc-meta-row">
          <span class="muted-note">Aradaki mesafe: ${Number(state.distanceKm).toFixed(1)} km</span>
          ${buildMapLinkHtml(state.partnerLocation, "Haritada Aç")}
        </div>
      </div>
    </div>
  `;

  const manualInput = document.getElementById("manual-loc-input");
  if (typeof prevManualInput === "string") {
    manualInput.value = prevManualInput;
  }

  const commitManualLabel = () => {
    const val = manualInput.value.trim();
    if (!val) {
      manualInput.focus();
      return;
    }

    writeMyProfileChanges({
      location: {
        ...(state.myLocation || {}),
        label: val,
        updatedAt: nowTime()
      }
    });
    refreshDistanceIfPossible();
    saveState({ pushCloud: true });
    renderKonum(contentEl);
    showToast("loc-feedback", `Konumun "${val}" olarak kaydedildi.`);
  };

  document.getElementById("save-manual-loc-btn").addEventListener("click", commitManualLabel);
  manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitManualLabel();
  });

  const gpsBtn = document.getElementById("get-gps-btn");
  gpsBtn.addEventListener("click", async () => {
    gpsBtn.disabled = true;
    gpsBtn.textContent = "Konum İzni İsteniyor...";

    const permRes = await requestLocationPermissionSafe();
    if (!permRes.ok || !permRes.position) {
      renderKonum(contentEl);
      showToast(
        "loc-feedback",
        permRes.reason === "unsupported"
          ? "Bu cihazda konum özelliği desteklenmiyor."
          : "Konum izni verilmedi. Telefon Ayarları > Uygulamalar > Biz > İzinler > Konum kısmından açabilirsin."
      );
      return;
    }

    gpsBtn.textContent = "Konum Alınıyor...";
    const lat = Number(permRes.position.coords.latitude);
    const lon = Number(permRes.position.coords.longitude);
    const placeName = await resolveShortPlaceName(lat, lon);

    writeMyProfileChanges({
      location: {
        lat,
        lon,
        label: placeName,
        updatedAt: nowTime()
      }
    });
    refreshDistanceIfPossible();
    saveState({ pushCloud: true });
    renderKonum(contentEl);
    showToast("loc-feedback", `Konum güncellendi: ${placeName}`);
  });
}
