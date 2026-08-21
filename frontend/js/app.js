// ---- Shared helpers ----
function showToast(message, kind = "") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = "toast" + (kind ? " toast-" + kind : "");
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}
window.showToast = showToast;

function vibrate(pattern) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function tr(key) {
  return typeof t === "function" ? t(key) : key;
}

// ---- App state ----
const state = {
  sites: [],
  selectedSiteId: null,
  currentPosition: null,
  distanceToSite: null,
  isCheckedIn: false,
  map: null,
  workerMarker: null,
  siteMarker: null,
  geofenceCircle: null,
  workerTab: "home",
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

async function bootWithRetry(attempt = 1) {
  const maxAttempts = 4;
  const stayClassic = new URLSearchParams(location.search).get("classic") === "1";
  try {
    const me = await Api.me();
    document.getElementById("boot-screen").classList.add("hidden");
    hideReconnectBanner();
    if (me.role === "admin" && !stayClassic) {
      window.location.href = "admin.html";
      return;
    } else {
      await enterApp(me);
    }
  } catch (err) {
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
    showReconnectBanner("Connecting to server… (attempt " + attempt + "/" + (maxAttempts - 1) + ")");
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
  button.disabled = true;
  button.classList.add("is-loading");

  try {
    const result = await Api.login(username, password);
    Auth.setToken(result.token);
    Auth.setUser(result.user);
    const stayClassic = new URLSearchParams(location.search).get("classic") === "1";
    if (result.user.role === "admin" && !stayClassic) {
      window.location.href = "admin.html";
      return;
    } else {
      await enterApp(result.user);
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
});

document.getElementById("logout-button")?.addEventListener("click", () => {
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
      document.getElementById("device-pending-banner")?.classList.remove("hidden");
    }
  } catch {}

  initMap();
  await loadSites();
  await loadTodayAssignment();
  await loadHistory();
  await loadAttendanceSummary();
  startLocationWatch();
  updateOfflineBadge();
  setupWorkerTabs();
  if (typeof applyTranslations === "function") applyTranslations();
}

// ---- Offline badge ----
async function updateOfflineBadge() {
  const el = document.getElementById("offline-badge");
  if (!el) return;
  try {
    const n = await OfflineQueue.count();
    if (n > 0) {
      el.textContent = n + " " + tr("offlineBadge");
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch {
    el.classList.add("hidden");
  }
}

setInterval(updateOfflineBadge, 8000);
window.addEventListener("online", () => {
  flushOfflineQueue().then((n) => {
    if (n > 0) showToast(n + " " + tr("syncedItems"), "success");
    updateOfflineBadge();
  });
});

// ---- Worker tabs ----
function setupWorkerTabs() {
  document.querySelectorAll("[data-worker-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-worker-tab");
      state.workerTab = tab;
      document.querySelectorAll("[data-worker-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".worker-panel").forEach((p) => p.classList.add("hidden"));
      document.getElementById("panel-" + tab)?.classList.remove("hidden");

      if (tab === "reports") loadMyReports();
      if (tab === "alerts") loadNotifications();
      if (tab === "profile") loadProfileForm();
    });
  });
}

// ---- My Attendance ----
async function loadAttendanceSummary() {
  try {
    const summary = await Api.myAttendanceSummary();
    const pct = summary.daysInMonth
      ? Math.round((summary.daysPresent / summary.daysInMonth) * 100)
      : 0;
    document.getElementById("attendance-days").textContent =
      summary.daysPresent + " / " + summary.daysInMonth + " " + tr("days");
    document.getElementById("attendance-bar-fill").style.width = pct + "%";
    document.getElementById("attendance-month-label").textContent = summary.month;
  } catch {}
}

// ---- Map ----
function initMap() {
  if (state.map) return;
  if (typeof L === "undefined") {
    const container = document.getElementById("site-map");
    if (container) container.textContent = "Map failed to load — check your connection.";
    return;
  }

  state.map = L.map("site-map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([30.0561, 31.3395], 14);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "OpenStreetMap / CARTO",
      maxZoom: 19,
      subdomains: "abcd",
    }
  ).addTo(state.map);

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
    color: "#D97706",
    weight: 1.5,
    fillColor: "#D97706",
    fillOpacity: 0.08,
  });

  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

function updateSiteOnMap() {
  if (!state.map) return;
  const site = state.sites.find((s) => s.id === state.selectedSiteId);
  if (!site) return;

  const latlng = [site.lat, site.lng];
  state.siteMarker.setLatLng(latlng).addTo(state.map);
  state.geofenceCircle.setLatLng(latlng).setRadius(site.radius_meters || 200).addTo(state.map);

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
  if (!banner) return;
  try {
    const assignments = await Api.myAssignmentToday();
    if (assignments.length === 0) {
      banner.classList.add("hidden");
      return;
    }
    state.selectedSiteId = assignments[0].site_id;
    const select = document.getElementById("site-select");
    if (select) select.value = String(assignments[0].site_id);

    banner.innerHTML = assignments
      .map((a) => "<div><strong>" + escapeHtml(a.site_name) + "</strong>" + (a.task ? " · " + escapeHtml(a.task) : "") + "</div>")
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
    if (!select) return;
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
    if (!list) return;
    list.innerHTML = "";
    result.history.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const time = new Date(item.created_at).toLocaleString();
      const typeLabel = item.type === "check_in" ? tr("checkedIn") : tr("checkedOut");
      const badgeClass = item.status === "inside" ? "badge-inside" : "badge-outside";
      const statusLabel = item.status === "inside" ? tr("inside") : tr("outside");
      li.innerHTML =
        "<div><div>" + typeLabel + "</div>" +
        "<div class=\"meta\">" + time + " · " + Math.round(item.distance_meters) + "m</div></div>" +
        "<span class=\"badge " + badgeClass + "\">" + statusLabel + "</span>";
      list.appendChild(li);
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

function updateCheckinButton() {
  const button = document.getElementById("checkin-button");
  if (!button) return;
  button.querySelector(".btn-label").textContent = state.isCheckedIn ? tr("checkOut") : tr("checkIn");
  button.classList.toggle("checked-in", state.isCheckedIn);
}

function startLocationWatch() {
  if (!("geolocation" in navigator)) {
    showToast("Location isn't available on this device/browser.", "error");
    return;
  }
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
    () => {
      const pill = document.getElementById("status-pill");
      if (pill) pill.textContent = tr("locationNeeded");
      const btn = document.getElementById("checkin-button");
      if (btn) btn.disabled = true;
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
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
  const pill = document.getElementById("status-pill");
  const button = document.getElementById("checkin-button");
  const site = state.sites.find((s) => s.id === state.selectedSiteId);

  updateSiteOnMap();

  if (!pill) return;
  if (!state.currentPosition || !site) {
    pill.textContent = tr("locating");
    pill.className = "status-pill status-idle";
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

  pill.textContent =
    (inside ? tr("insideRange") : tr("outsideRange")) + " · " + Math.round(distance) + "m";
  pill.className = "status-pill " + (inside ? "status-inside" : "status-outside");

  if (button) button.disabled = false;
}

// ---- Check-in with offline support ----
document.getElementById("checkin-button")?.addEventListener("click", async () => {
  const button = document.getElementById("checkin-button");
  if (!state.currentPosition || !state.selectedSiteId) {
    showToast(tr("waitingLocation"), "error");
    return;
  }

  button.disabled = true;
  button.classList.add("is-loading");

  try {
    const payload = {
      siteId: state.selectedSiteId,
      lat: state.currentPosition.lat,
      lng: state.currentPosition.lng,
      accuracyMeters: state.currentPosition.accuracy,
      deviceId: getDeviceId(),
      isMockLocation: false,
      type: state.isCheckedIn ? "check_out" : "check_in",
    };

    const result = await checkInWithOffline(payload);

    if (result.offline) {
      vibrate([100]);
      showToast(result.message || tr("offlineQueue"), "success");
      updateOfflineBadge();
      return;
    }

    vibrate(result.flagged ? [200] : [100, 50, 100]);
    const reason = (result.flag_reason || "").replace(/_/g, " ");
    showToast(
      result.flagged
        ? "Recorded, but flagged for review (" + reason + ")."
        : (result.type === "check_in" ? tr("checkedIn") : tr("checkedOut")),
      result.flagged ? "error" : "success"
    );

    await loadHistory();
  } catch (err) {
    vibrate([300]);
    showToast(err.message, "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    updateCheckinButton();
  }
});

// ---- Reports panel ----
async function loadMyReports() {
  const list = document.getElementById("reports-list");
  if (!list) return;
  list.innerHTML = "<li class='meta'>" + tr("loading") + "</li>";
  try {
    const rows = await Api.myReports();
    list.innerHTML = "";
    if (rows.length === 0) {
      list.innerHTML = "<li class='meta'>" + tr("noReports") + "</li>";
      return;
    }
    rows.forEach((r) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML =
        "<div><div><strong>" + escapeHtml(r.title) + "</strong></div>" +
        "<div class=\"meta\">" + new Date(r.created_at).toLocaleString() + " · " + r.status + "</div></div>";
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = "<li class='meta'>" + escapeHtml(err.message) + "</li>";
  }
}

document.getElementById("submit-report-btn")?.addEventListener("click", async () => {
  const title = document.getElementById("report-title")?.value.trim();
  const body = document.getElementById("report-body")?.value.trim();
  if (!title || !body) {
    showToast(tr("titleBodyRequired"), "error");
    return;
  }
  try {
    const result = await submitReportWithOffline({
      title,
      body,
      siteId: state.selectedSiteId || undefined,
    });
    if (result.offline) {
      showToast(result.message || tr("offlineQueue"), "success");
      updateOfflineBadge();
    } else {
      showToast(tr("reportSubmitted"), "success");
    }
    document.getElementById("report-title").value = "";
    document.getElementById("report-body").value = "";
    loadMyReports();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---- Notifications / Alerts panel ----
async function loadNotifications() {
  const list = document.getElementById("notifications-list");
  if (!list) return;
  list.innerHTML = "<li class='meta'>" + tr("loading") + "</li>";
  try {
    const rows = await Api.getNotifications();
    list.innerHTML = "";
    if (rows.length === 0) {
      list.innerHTML = "<li class='meta'>" + tr("noAlerts") + "</li>";
      return;
    }
    rows.forEach((n) => {
      const li = document.createElement("li");
      li.className = "history-item" + (n.read ? "" : " unread");
      li.innerHTML =
        "<div><div><strong>" + escapeHtml(n.title) + "</strong></div>" +
        "<div class=\"meta\">" + escapeHtml(n.body) + "</div>" +
        "<div class=\"meta\">" + new Date(n.created_at).toLocaleString() + "</div></div>";
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = "<li class='meta'>" + escapeHtml(err.message) + "</li>";
  }
}

document.getElementById("mark-read-btn")?.addEventListener("click", async () => {
  try {
    await Api.markNotificationsRead();
    showToast(tr("markedRead"), "success");
    loadNotifications();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---- Profile panel ----
function loadProfileForm() {
  const user = Auth.getUser() || {};
  const nameEl = document.getElementById("profile-name");
  const phoneEl = document.getElementById("profile-phone");
  const localeEl = document.getElementById("profile-locale");
  if (nameEl) nameEl.value = user.fullName || user.full_name || "";
  if (phoneEl) phoneEl.value = user.phone || "";
  if (localeEl) localeEl.value = localStorage.getItem("htn_locale") || "en";
}

document.getElementById("save-profile-btn")?.addEventListener("click", async () => {
  const fullName = document.getElementById("profile-name")?.value.trim();
  const phone = document.getElementById("profile-phone")?.value.trim();
  const locale = document.getElementById("profile-locale")?.value;
  try {
    const updated = await Api.updateMyProfile({ fullName, phone, locale });
    Auth.setUser(Object.assign({}, Auth.getUser(), updated, { fullName: updated.full_name || fullName }));
    if (typeof setLocale === "function") setLocale(locale);
    showToast(tr("profileSaved"), "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("delete-account-btn")?.addEventListener("click", async () => {
  if (!confirm(tr("deleteConfirm"))) return;
  try {
    await Api.deleteMyAccount();
    Auth.logout();
    window.location.reload();
  } catch (err) {
    showToast(err.message, "error");
  }
});
