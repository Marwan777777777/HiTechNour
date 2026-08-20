// ---- Shared helpers ----

// Toast stack — supports several toasts queued at once instead of the
// second one silently overwriting the first on flaky connections.
function showToast(message, kind = "") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = "toast" + (kind ? ` toast-${kind}` : "");
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function vibrate(pattern) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Toggle a primary-button's loading state — swaps the label for a spinner
// and disables it, so a tap on a slow connection shows something changed
// instead of appearing dead.
function setButtonLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
}

// ---- App state ----
const state = {
  sites: [],
  selectedSiteId: null,
  currentPosition: null, // { lat, lng, accuracy }
  distanceToSite: null,
  isCheckedIn: false,
  map: null,
  workerMarker: null,
  siteMarker: null,
  geofenceCircle: null,
};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  const token = Auth.getToken();
  if (!token) {
    setTimeout(() => {
      document.getElementById("boot-screen").classList.add("hidden");
      showScreen("login-screen");
    }, 500);
    return;
  }

  await bootWithRetry();
});

// A slept/cold-starting backend (Railway "Serverless", or a sleeping Neon
// DB) can make the very first request after idle time fail or hang for
// 20-50s. That is NOT the same thing as "not logged in" - a valid token
// should never be treated as invalid just because the server was briefly
// unreachable. Retry a few times with backoff before giving up, and only
// fall back to the login screen if the token is genuinely rejected (401 -
// Api.me() throws) or every retry truly fails.
async function bootWithRetry(attempt = 1) {
  const maxAttempts = 4;
  try {
    const me = await Api.me();
    document.getElementById("boot-screen").classList.add("hidden");
    hideReconnectBanner();
    if (me.role === "admin") {
      await enterAdmin(me);
    } else {
      await enterApp(me);
    }
  } catch (err) {
    // A real auth failure (bad/expired token, disabled account) already
    // triggers Auth.logout() + reload inside apiRequest's 401 branch -
    // if we get here with a token still in storage, this was a network/
    // server-availability failure, not a login failure.
    if (!Auth.getToken()) {
      document.getElementById("boot-screen").classList.add("hidden");
      showScreen("login-screen");
      return;
    }
    if (attempt >= maxAttempts) {
      document.getElementById("boot-screen").classList.add("hidden");
      showReconnectBanner("Can't reach the server. Check your connection and reopen the app.");
      return;
    }
    showReconnectBanner(`Connecting to server… (attempt ${attempt}/${maxAttempts - 1})`);
    setTimeout(() => bootWithRetry(attempt + 1), attempt * 1500);
  }
}

function showReconnectBanner(message) {
  let banner = document.getElementById("reconnect-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "reconnect-banner";
    banner.className = "reconnect-banner";
    document.body.prepend(banner);
  }
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function hideReconnectBanner() {
  document.getElementById("reconnect-banner")?.classList.add("hidden");
}

// ---- Login ----
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const button = document.getElementById("login-button");
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("hidden");
  setButtonLoading(button, true);

  try {
    const result = await Api.login(username, password);
    Auth.setToken(result.token);
    Auth.setUser(result.user);
    if (result.user.role === "admin") {
      await enterAdmin(result.user);
    } else {
      await enterApp(result.user);
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById("logout-button").addEventListener("click", () => {
  Auth.logout();
  window.location.reload();
});

// ---- Employee app ----
async function enterApp(user) {
  showScreen("app-screen");
  document.getElementById("user-name").textContent = user.fullName || user.username;

  try {
    const me = await Api.me();
    if (me.devicePending) {
      document.getElementById("device-pending-banner").classList.remove("hidden");
    }
  } catch {}

  initMap();
  await loadSites();
  await loadTodayAssignment();
  await loadHistory();
  await loadAttendanceSummary();
  startLocationWatch();
}

// ---- My Attendance (days present this month) ----
async function loadAttendanceSummary() {
  try {
    const summary = await Api.myAttendanceSummary();
    const pct = summary.daysInMonth
      ? Math.round((summary.daysPresent / summary.daysInMonth) * 100)
      : 0;
    document.getElementById("attendance-days").textContent =
      `${summary.daysPresent} / ${summary.daysInMonth} days`;

    const fill = document.getElementById("attendance-bar-fill");
    fill.style.width = `${pct}%`;
    // Tiered color instead of always-green — a worker at 20% shouldn't
    // read the same "all good" green as one at 95%.
    fill.classList.remove("tier-low", "tier-mid", "tier-high");
    fill.classList.add(pct < 50 ? "tier-low" : pct < 80 ? "tier-mid" : "tier-high");

    document.getElementById("attendance-month-label").textContent = summary.month;
  } catch {
    // Non-critical - if this fails, leave the placeholder text in place
    // rather than blocking the rest of the app screen.
  }
}

// ---- Live map ----
// Free dark-styled tiles (CARTO "dark_all", no API key required) so the map
// matches the navy/amber theme instead of looking like a default light map.
function initMap() {
  if (state.map) return; // already initialized (e.g. re-entering app screen)

  const skeleton = document.getElementById("site-map-skeleton");

  if (typeof L === "undefined") {
    const container = document.getElementById("site-map");
    if (container) container.textContent = "Map failed to load — check your connection.";
    skeleton?.remove();
    return;
  }

  state.map = L.map("site-map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([30.0561, 31.3395], 14); // Nasr City, Cairo default until we have a fix

  const tileLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      subdomains: "abcd",
    }
  ).addTo(state.map);

  // Remove the shimmer skeleton once real tiles have actually painted,
  // instead of leaving an empty dark box while they load.
  tileLayer.once("load", () => skeleton?.remove());
  // Safety fallback in case the 'load' event never fires (e.g. cached tiles).
  setTimeout(() => skeleton?.remove(), 2500);

  const workerIcon = L.divIcon({
    className: "",
    html: '<div class="worker-marker"><div class="pulse"></div><div class="dot"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  state.workerMarker = L.marker([30.0561, 31.3395], { icon: workerIcon, zIndexOffset: 1000 });

  const siteIcon = L.divIcon({
    className: "",
    html: '<div class="site-marker"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 12],
  });
  state.siteMarker = L.marker([30.0561, 31.3395], { icon: siteIcon });

  state.geofenceCircle = L.circle([30.0561, 31.3395], {
    radius: 200,
    color: "#f2a53d",
    weight: 1.5,
    fillColor: "#f2a53d",
    fillOpacity: 0.08,
  });

  // Leaflet sizes itself from the container at creation time - if any CSS
  // transition/animation was still settling, the map can render at the
  // wrong size. One safety recalculation after layout settles fixes that.
  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

// Move the site marker + geofence circle to the currently selected site.
function updateSiteOnMap() {
  if (!state.map) return;
  const site = state.sites.find((s) => s.id === state.selectedSiteId);
  if (!site) return;

  const latlng = [site.lat, site.lng];
  state.siteMarker.setLatLng(latlng).addTo(state.map);
  state.geofenceCircle.setLatLng(latlng).setRadius(site.radius_meters || 200).addTo(state.map);

  // Only auto-fit the view the first time a site appears (avoids yanking
  // the map around under the worker's finger while they're panning/zooming).
  if (!state._sitePlaced) {
    state._sitePlaced = true;
    fitMapToMarkers();
  }
}

function fitMapToMarkers() {
  if (!state.map || !state.geofenceCircle) return;
  const bounds = state.geofenceCircle.getBounds();
  if (state.currentPosition) {
    bounds.extend([state.currentPosition.lat, state.currentPosition.lng]);
  }
  state.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
}

async function loadTodayAssignment() {
  const banner = document.getElementById("assignment-banner");
  try {
    const assignments = await Api.myAssignmentToday();
    if (assignments.length === 0) {
      banner.classList.add("hidden");
      return; // no assignment today - worker picks from the full site list as before
    }
    // Pre-select the assigned site so check-in is one tap, not a dropdown
    // hunt. If there's more than one (rare handoff day), default to the
    // first but leave the dropdown open so they can switch.
    state.selectedSiteId = assignments[0].site_id;
    const select = document.getElementById("site-select");
    if (select) select.value = String(assignments[0].site_id);

    banner.innerHTML = assignments
      .map((a) => `<div><strong>${a.site_name}</strong>${a.task ? ` · ${a.task}` : ""}</div>`)
      .join("");
    banner.classList.remove("hidden");
    updateDistanceDisplay();
  } catch {
    banner.classList.add("hidden");
  }
}

async function loadSites() {
  try {
    state.sites = await Api.getSites();
    const select = document.getElementById("site-select");
    select.innerHTML = "";
    state.sites.forEach((site) => {
      const opt = document.createElement("option");
      opt.value = site.id;
      opt.textContent = site.name;
      select.appendChild(opt);
    });
    state.selectedSiteId = state.sites[0]?.id ?? null;
    select.addEventListener("change", () => {
      state.selectedSiteId = Number(select.value);
      updateDistanceDisplay();
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadHistory() {
  try {
    const result = await Api.myCheckins();
    state.isCheckedIn = result.isCheckedIn;
    updateCheckinButton();

    const list = document.getElementById("history-list");
    list.innerHTML = "";
    result.history.forEach((item) => {
      const li = document.createElement("li");
      const inside = item.status === "inside";
      // is-inside/is-outside are the real source of truth for the border
      // color — the CSS also keeps a :has(.badge-*) fallback, but that
      // selector silently fails on older/budget Android browsers.
      li.className = `history-item ${inside ? "is-inside" : "is-outside"}`;
      const time = new Date(item.created_at).toLocaleString();
      li.innerHTML = `
        <div>
          <div>${item.type === "check_in" ? "Checked in" : "Checked out"}</div>
          <div class="meta">${time} · ${Math.round(item.distance_meters)}m</div>
        </div>
        <span class="badge ${inside ? "badge-inside" : "badge-outside"}">
          ${item.status}
        </span>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

function updateCheckinButton() {
  const button = document.getElementById("checkin-button");
  button.querySelector(".btn-label").textContent = state.isCheckedIn ? "Check Out" : "Check In";
  button.classList.toggle("checked-in", state.isCheckedIn);
}

function startLocationWatch() {
  if (!("geolocation" in navigator)) {
    setStatusPill("nosignal", "Location isn't available on this device.");
    document.getElementById("checkin-button").disabled = true;
    return;
  }
  // watchPosition triggers the permission prompt once; after "Allow" the
  // browser remembers it for this site and stops asking.
  navigator.geolocation.watchPosition(
    (position) => {
      const firstFix = !state.currentPosition;
      state.currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      if (state.map && state.workerMarker) {
        const latlng = [state.currentPosition.lat, state.currentPosition.lng];
        state.workerMarker.setLatLng(latlng).addTo(state.map);
        if (firstFix) {
          state.map.setView(latlng, 16);
          fitMapToMarkers();
        }
      }

      updateDistanceDisplay();
    },
    (err) => {
      // Previously both of these collapsed into a generic disabled button
      // with no explanation — now they're distinguishable, visible states.
      // GeolocationPositionError codes: 1 = PERMISSION_DENIED,
      // 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
      if (err.code === 1) {
        setStatusPill("denied", "Location access denied — enable it in browser settings.");
      } else {
        setStatusPill("nosignal", "No GPS signal — move to open sky and retry.");
      }
      document.getElementById("checkin-button").disabled = true;
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function setStatusPill(kind, text) {
  const pill = document.getElementById("status-pill");
  pill.textContent = text;
  pill.className = `status-pill status-${kind}`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateDistanceDisplay() {
  const button = document.getElementById("checkin-button");
  const site = state.sites.find((s) => s.id === state.selectedSiteId);

  updateSiteOnMap();

  if (!state.currentPosition || !site) {
    setStatusPill("idle", "Locating…");
    return;
  }

  const distance = haversineMeters(
    state.currentPosition.lat,
    state.currentPosition.lng,
    site.lat,
    site.lng
  );
  state.distanceToSite = distance;
  const inside = distance <= site.radius_meters;

  setStatusPill(
    inside ? "inside" : "outside",
    inside ? `Inside range · ${Math.round(distance)}m` : `Outside range · ${Math.round(distance)}m`
  );

  // Client-side distance is shown for the worker's own feedback only - the
  // server independently recomputes it and is the source of truth.
  button.disabled = false;
}

document.getElementById("checkin-button").addEventListener("click", async () => {
  const button = document.getElementById("checkin-button");
  if (!state.currentPosition || !state.selectedSiteId) {
    showToast("Waiting for location…", "error");
    return;
  }

  setButtonLoading(button, true);

  try {
    const result = await Api.checkIn({
      siteId: state.selectedSiteId,
      lat: state.currentPosition.lat,
      lng: state.currentPosition.lng,
      accuracyMeters: state.currentPosition.accuracy,
      deviceId: getDeviceId(),
      isMockLocation: false, // wire up Android mock-location detection in a native wrapper if/when you build one
      type: state.isCheckedIn ? "check_out" : "check_in",
    });

    vibrate(result.flagged ? [200] : [100, 50, 100]);
    showToast(
      result.flagged
        ? `Recorded, but flagged for review (${result.flag_reason.replace(/_/g, " ")}).`
        : `${result.type === "check_in" ? "Checked in" : "Checked out"} successfully.`,
      result.flagged ? "error" : "success"
    );

    await loadHistory();
  } catch (err) {
    vibrate([300]);
    showToast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
    updateCheckinButton(); // loadHistory() already refreshed state.isCheckedIn
  }
});
