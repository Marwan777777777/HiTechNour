// ---- Shared helpers ----
function showToast(message, kind = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast" + (kind ? ` toast-${kind}` : "");
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3200);
}

function vibrate(pattern) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---- App state ----
const state = {
  sites: [],
  selectedSiteId: null,
  currentPosition: null, // { lat, lng, accuracy }
  distanceToSite: null,
  isCheckedIn: false,
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

  try {
    const me = await Api.me();
    document.getElementById("boot-screen").classList.add("hidden");
    if (me.role === "admin") {
      await enterAdmin(me);
    } else {
      await enterApp(me);
    }
  } catch {
    document.getElementById("boot-screen").classList.add("hidden");
    showScreen("login-screen");
  }
});

// ---- Login ----
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const button = document.getElementById("login-button");
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("hidden");
  button.disabled = true;
  button.textContent = "Signing in…";

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
    button.disabled = false;
    button.textContent = "Sign In";
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

  await loadSites();
  await loadTodayAssignment();
  await loadHistory();
  startLocationWatch();
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
      li.className = "history-item";
      const time = new Date(item.created_at).toLocaleString();
      li.innerHTML = `
        <div>
          <div>${item.type === "check_in" ? "Checked in" : "Checked out"}</div>
          <div class="meta">${time} · ${Math.round(item.distance_meters)}m</div>
        </div>
        <span class="badge ${item.status === "inside" ? "badge-inside" : "badge-outside"}">
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
  button.textContent = state.isCheckedIn ? "Check Out" : "Check In";
  button.classList.toggle("checked-in", state.isCheckedIn);
}

function startLocationWatch() {
  if (!("geolocation" in navigator)) {
    showToast("Location isn't available on this device/browser.", "error");
    return;
  }
  // watchPosition triggers the permission prompt once; after "Allow" the
  // browser remembers it for this site and stops asking.
  navigator.geolocation.watchPosition(
    (position) => {
      state.currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      updateDistanceDisplay();
    },
    () => {
      document.getElementById("status-pill").textContent = "Location access needed";
      document.getElementById("checkin-button").disabled = true;
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

  if (!state.currentPosition || !site) {
    pill.textContent = "Locating…";
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

  pill.textContent = inside
    ? `Inside range · ${Math.round(distance)}m`
    : `Outside range · ${Math.round(distance)}m`;
  pill.className = `status-pill ${inside ? "status-inside" : "status-outside"}`;

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

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Submitting…";

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
    button.disabled = false;
    updateCheckinButton(); // loadHistory() already refreshed state.isCheckedIn
  }
});
