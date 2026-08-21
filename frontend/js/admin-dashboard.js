// ---- Auth guard ----
// This page is only for admins. A worker landing here (bad link, stale
// bookmark) gets bounced straight back to the regular app instead of
// seeing a broken dashboard.
//
// Important: a slept/cold-starting backend (Railway free tier, a sleeping
// Neon DB) can make Api.me() fail or time out for reasons that have
// nothing to do with who's logged in. Treating every failure as "not an
// admin" causes a redirect ping-pong with index.html's own retry logic
// (index.html retries, succeeds, sends us back here; we hit another
// transient hiccup, bounce again). Only a genuine 401 - which apiRequest
// already reacts to by clearing the stored token - should count as
// "not authorized." Anything else gets retried instead.
(async function guard(attempt = 1) {
  const maxAttempts = 4;
  const token = Auth.getToken();
  if (!token) {
    window.location.href = "index.html";
    return;
  }
  try {
    const me = await Api.me();
    if (me.role !== "admin") {
      window.location.href = "index.html";
      return;
    }
    Auth.setUser(me);
    document.getElementById("footerName").textContent = me.fullName || me.username;
    document.getElementById("footerAvatar").textContent = initials(me.fullName || me.username);
    boot();
  } catch (err) {
    // apiRequest's 401 branch already clears the token on a real auth
    // failure - if it's gone, this genuinely isn't a logged-in admin.
    if (!Auth.getToken()) {
      window.location.href = "index.html";
      return;
    }
    if (attempt >= maxAttempts) {
      // Give up gracefully instead of looping forever - send them back to
      // index.html once, which has its own reconnect banner for a truly
      // unreachable server, rather than flashing between pages.
      window.location.href = "index.html";
      return;
    }
    setTimeout(() => guard(attempt + 1), attempt * 1500);
  }
})();

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function showToast(message, kind = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast" + (kind ? ` toast-${kind}` : "");
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3200);
}

// ---- Boot ----
let state = { overview: null, team: null, feed: null };
let charts = {};

function boot() {
  document.getElementById("topbarDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.addEventListener("click", () => {
      showPage(item.dataset.page);
      closeSidebarOnMobile();
    });
  });

  document.getElementById("logoutFooter").addEventListener("click", () => {
    Auth.logout();
    window.location.href = "index.html";
  });

  document.getElementById("menuBtn").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarScrim").classList.toggle("open");
  });
  document.getElementById("sidebarScrim").addEventListener("click", closeSidebarOnMobile);

  document.getElementById("refreshBtn").addEventListener("click", () => {
    loadOverview();
    if (state.team) loadTeam();
    if (state.feed) loadActivityFeed();
  });

  document.getElementById("drawerCloseBtn").addEventListener("click", closeDrawer);
  document.getElementById("drawerOverlay").addEventListener("click", (e) => {
    if (e.target.id === "drawerOverlay") closeDrawer();
  });
  document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  document.getElementById("feedSearch").addEventListener("input", renderFeed);

  // ---- Add Worker ----
  document.getElementById("openAddWorkerBtn").addEventListener("click", openAddWorkerModal);
  document.getElementById("addWorkerCloseBtn").addEventListener("click", closeAddWorkerModal);
  document.getElementById("addWorkerOverlay").addEventListener("click", (e) => {
    if (e.target.id === "addWorkerOverlay") closeAddWorkerModal();
  });
  document.getElementById("addWorkerForm").addEventListener("submit", handleAddWorkerSubmit);

  loadOverview();
}

function openAddWorkerModal() {
  document.getElementById("addWorkerForm").reset();
  document.getElementById("addWorkerError").classList.add("hidden");
  document.getElementById("addWorkerOverlay").classList.add("open");
}

function closeAddWorkerModal() {
  document.getElementById("addWorkerOverlay").classList.remove("open");
}

async function handleAddWorkerSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("addWorkerError");
  const submitBtn = document.getElementById("addWorkerSubmitBtn");
  errorEl.classList.add("hidden");

  const fullName = document.getElementById("awFullName").value.trim();
  const username = document.getElementById("awUsername").value.trim();
  const password = document.getElementById("awPassword").value;
  const phone = document.getElementById("awPhone").value.trim();
  const role = document.getElementById("awRole").value;

  if (password.length < 8) {
    errorEl.textContent = "Password must be at least 8 characters.";
    errorEl.classList.remove("hidden");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";
  try {
    await Api.createUser({ username, password, fullName, phone: phone || undefined, role });
    showToast(`${fullName} added.`, "success");
    closeAddWorkerModal();
    state.team = null; // force a refresh next time Team is opened
    if (document.getElementById("page-team").classList.contains("active")) loadTeam();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Worker";
  }
}

function closeSidebarOnMobile() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarScrim").classList.remove("open");
}

const pageTitles = {
  overview: "Overview",
  attendance: "Attendance",
  team: "Team",
  sites: "Sites",
  leave: "Days Off",
  skills: "Skills",
  anomalies: "Anomalies",
  activityfeed: "Activity Feed",
  reports: "Reports",
  devices: "Devices",
  settings: "Settings",
};

function showPage(name) {
  document.querySelectorAll(".nav-item[data-page]").forEach((n) => n.classList.toggle("active", n.dataset.page === name));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  document.getElementById("pageTitle").textContent = pageTitles[name] || name;

  if (name === "team" && !state.team) loadTeam();
  if (name === "attendance" && !state.attendance) loadAttendanceLog();
  if (name === "devices") loadDevices();
  if (name === "activityfeed" && !state.feed) loadActivityFeed();
  if (name === "anomalies") loadAnomaliesFull();
}

// ---- Devices ----
async function loadDevices() {
  const tbody = document.getElementById("devTableBody");
  try {
    state.devices = await Api.getUsers();
    renderDevices();
  } catch (err) {
    tbody.innerHTML = "";
    document.getElementById("devEmpty").textContent = err.message;
    document.getElementById("devEmpty").classList.remove("hidden");
  }
}

function deviceStatusMeta(u) {
  if (u.device_pending) return { label: "Pending approval", cls: "status-late" };
  if (u.device_approved) return { label: "Approved", cls: "status-present" };
  return { label: "No device registered", cls: "status-absent" };
}

function renderDevices() {
  if (!state.devices) return;
  const search = (document.getElementById("devSearch").value || "").toLowerCase();
  let rows = state.devices;
  if (search) rows = rows.filter((u) => u.full_name.toLowerCase().includes(search));

  const pendingCount = state.devices.filter((u) => u.device_pending).length;
  const badge = document.getElementById("devPendingBadge");
  if (pendingCount > 0) {
    badge.textContent = `${pendingCount} pending`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  const tbody = document.getElementById("devTableBody");
  const empty = document.getElementById("devEmpty");
  if (!rows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = rows
    .map((u) => {
      const meta = deviceStatusMeta(u);
      const bound = u.device_bound_at ? new Date(u.device_bound_at).toLocaleDateString() : "—";
      let actions = "";
      if (u.device_pending) {
        actions += `<button class="secondary-button" style="margin:0 6px 0 0;" data-approve="${u.id}">Approve</button>`;
      }
      if (u.device_approved || u.device_pending) {
        actions += `<button class="secondary-button" style="margin:0 6px 0 0;" data-reset="${u.id}">Reset</button>`;
      }
      actions += `<button class="secondary-button" style="margin:0;color:var(--red);border-color:#f3c9c9;" data-logout="${u.id}" data-name="${u.full_name}">Force Sign-out</button>`;
      return `
      <tr>
        <td class="name-cell"><div class="avatar-sm">${initials(u.full_name)}</div>${u.full_name}</td>
        <td><span class="status-pill ${meta.cls}">${meta.label}</span></td>
        <td class="mono">${bound}</td>
        <td style="white-space:nowrap;">${actions}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await Api.approveDevice(btn.dataset.approve);
        showToast("Device approved.", "success");
        await loadDevices();
      } catch (err) {
        showToast(err.message, "error");
      }
    })
  );
  tbody.querySelectorAll("[data-reset]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Reset this worker's bound device? They'll need re-approval on their next check-in.")) return;
      try {
        await Api.resetDevice(btn.dataset.reset);
        showToast("Device binding reset.", "success");
        await loadDevices();
      } catch (err) {
        showToast(err.message, "error");
      }
    })
  );
  tbody.querySelectorAll("[data-logout]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm(`Sign out ${btn.dataset.name} on every device? They'll need to log in again next time.`)) return;
      try {
        await Api.forceLogout(btn.dataset.logout);
        showToast(`${btn.dataset.name} signed out on all devices.`, "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    })
  );
}

document.getElementById("devSearch").addEventListener("input", renderDevices);

// ---- Attendance (full log) ----
async function loadAttendanceLog() {
  const tbody = document.getElementById("attTableBody");
  try {
    const [checkins, sites] = await Promise.all([Api.getAllCheckins(), Api.getSites()]);
    state.attendance = checkins;

    const siteFilter = document.getElementById("attSiteFilter");
    siteFilter.innerHTML =
      '<option value="">All sites</option>' +
      sites.map((s) => `<option value="${s.name}">${s.name}</option>`).join("");

    renderAttendanceLog();
  } catch (err) {
    tbody.innerHTML = "";
    document.getElementById("attEmpty").textContent = err.message;
    document.getElementById("attEmpty").classList.remove("hidden");
  }
}

function renderAttendanceLog() {
  if (!state.attendance) return;
  const start = document.getElementById("attStart").value;
  const end = document.getElementById("attEnd").value;
  const site = document.getElementById("attSiteFilter").value;
  const search = (document.getElementById("attSearch").value || "").toLowerCase();
  const flaggedOnly = document.getElementById("attFlaggedOnly").classList.contains("is-active");

  let rows = state.attendance;
  if (start) rows = rows.filter((r) => r.created_at.slice(0, 10) >= start);
  if (end) rows = rows.filter((r) => r.created_at.slice(0, 10) <= end);
  if (site) rows = rows.filter((r) => r.site_name === site);
  if (search) rows = rows.filter((r) => r.full_name.toLowerCase().includes(search));
  if (flaggedOnly) rows = rows.filter((r) => r.flagged);

  const tbody = document.getElementById("attTableBody");
  const empty = document.getElementById("attEmpty");
  document.getElementById("attCount").textContent = `${rows.length} of ${state.attendance.length}${state.attendance.length >= 500 ? "+ (showing most recent 500)" : ""}`;

  if (!rows.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = rows
    .map((r) => {
      const statusLabel = r.flagged && !r.reviewed ? "flagged" : r.status;
      const statusClass = r.flagged && !r.reviewed ? "status-late" : r.status === "inside" ? "status-inside" : "status-outside";
      return `
      <tr class="row-click" data-worker-id="${r.user_id || ""}">
        <td class="name-cell"><div class="avatar-sm">${initials(r.full_name)}</div>${r.full_name}</td>
        <td>${r.site_name}</td>
        <td class="mono">${r.type === "check_in" ? "IN" : "OUT"}</td>
        <td class="mono">${new Date(r.created_at).toLocaleString()}</td>
        <td class="mono">${r.distance_meters != null ? Math.round(r.distance_meters) + "m" : "—"}</td>
        <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-worker-id]").forEach((tr) => {
    if (tr.dataset.workerId) tr.addEventListener("click", () => openWorkerDrawer(tr.dataset.workerId));
  });
}

["attStart", "attEnd", "attSiteFilter", "attSearch"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderAttendanceLog);
});

document.getElementById("attFlaggedOnly").addEventListener("click", (e) => {
  e.target.classList.toggle("is-active");
  e.target.style.background = e.target.classList.contains("is-active") ? "var(--red-wash)" : "#fff";
  e.target.style.color = e.target.classList.contains("is-active") ? "var(--red)" : "var(--ink-dim)";
  e.target.style.borderColor = e.target.classList.contains("is-active") ? "var(--red)" : "var(--line-strong)";
  renderAttendanceLog();
});

document.getElementById("attExportBtn").addEventListener("click", async () => {
  const start = document.getElementById("attStart").value;
  const end = document.getElementById("attEnd").value;
  if (!start || !end) {
    showToast("Pick a From and To date first.", "error");
    return;
  }
  const btn = document.getElementById("attExportBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const blob = await Api.exportCsv(start, end);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "HTN_Attendance_Report.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ---- Overview ----
async function loadOverview() {
  try {
    const data = await Api.getOverview();
    state.overview = data;

    document.getElementById("kpiTotal").textContent = data.totalWorkers;
    document.getElementById("kpiTotalSub").textContent = "Across your sites";
    document.getElementById("kpiPresent").textContent = data.presentToday;
    document.getElementById("kpiPresentSub").textContent = data.totalWorkers
      ? `${Math.round((data.presentToday / data.totalWorkers) * 100)}% of total`
      : "—";
    document.getElementById("kpiLate").textContent = data.lateToday;
    document.getElementById("kpiLateSub").textContent = data.totalWorkers
      ? `${Math.round((data.lateToday / data.totalWorkers) * 100)}% of total`
      : "—";
    document.getElementById("kpiAbsent").textContent = data.absentToday;
    document.getElementById("kpiAbsentSub").textContent = data.totalWorkers
      ? `${Math.round((data.absentToday / data.totalWorkers) * 100)}% of total`
      : "—";

    renderAttendanceChart(data.weekly);
    renderSiteDonut(data.bySite);
    renderRecentAttendance(data.recentAttendance);
    renderReviewQueue(data.reviewQueue);

    const badge = document.getElementById("anomaliesBadge");
    if (data.reviewQueue.length > 0) {
      badge.textContent = data.reviewQueue.length;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAttendanceChart(weekly) {
  const ctx = document.getElementById("attendanceChart");
  if (charts.attendance) charts.attendance.destroy();
  charts.attendance = new Chart(ctx, {
    type: "line",
    data: {
      labels: weekly.map((d) => d.date.slice(5)),
      datasets: [
        { label: "Present", data: weekly.map((d) => d.present), borderColor: "#16A34A", backgroundColor: "rgba(22,163,74,0.08)", tension: 0.4, fill: true, pointRadius: 3 },
        { label: "Late", data: weekly.map((d) => d.late), borderColor: "#D97706", backgroundColor: "rgba(217,119,6,0.06)", tension: 0.4, fill: true, pointRadius: 3 },
        { label: "Absent", data: weekly.map((d) => d.absent), borderColor: "#DC2626", backgroundColor: "rgba(220,38,38,0.06)", tension: 0.4, fill: true, pointRadius: 3 },
      ],
    },
    options: {
      plugins: { legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 7, font: { size: 11.5, family: "Inter" } } } },
      scales: { y: { grid: { color: "#EEF1F7" }, ticks: { font: { size: 11 } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } },
      interaction: { intersect: false },
    },
  });
}

function renderSiteDonut(bySite) {
  const ctx = document.getElementById("siteDonut");
  if (charts.donut) charts.donut.destroy();
  const colors = ["#2557D6", "#7C5CFC", "#D97706", "#16A34A", "#DC2626", "#94A0B8"];
  if (!bySite.length) {
    document.getElementById("siteDonutLegend").innerHTML = `<div class="empty-note" style="padding:0;">No check-ins yet today.</div>`;
    charts.donut = new Chart(ctx, { type: "doughnut", data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#EEF1F7"], borderWidth: 0 }] }, options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { enabled: false } } } });
    return;
  }
  charts.donut = new Chart(ctx, {
    type: "doughnut",
    data: { labels: bySite.map((s) => s.name), datasets: [{ data: bySite.map((s) => s.count), backgroundColor: colors, borderWidth: 0 }] },
    options: { cutout: "68%", plugins: { legend: { display: false } } },
  });
  document.getElementById("siteDonutLegend").innerHTML = bySite
    .map(
      (s, i) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;">
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[i % colors.length]};margin-right:6px;"></span>${s.name}</span><b>${s.count}</b>
      </div>`
    )
    .join("");
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusPillClass(status) {
  return { present: "status-present", late: "status-late", absent: "status-absent", completed: "status-completed" }[status] || "status-present";
}

function renderRecentAttendance(rows) {
  const table = document.getElementById("recentAttendanceTable");
  const empty = document.getElementById("recentAttendanceEmpty");
  table.innerHTML = "<tr><th>Worker</th><th>Site</th><th>Check In</th><th>Check Out</th><th>Status</th></tr>";
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "row-click";
    tr.addEventListener("click", () => openWorkerDrawer(r.userId));
    tr.innerHTML = `
      <td class="name-cell"><div class="avatar-sm">${initials(r.fullName)}</div>${r.fullName}</td>
      <td>${r.siteName || "—"}</td>
      <td class="mono">${fmtTime(r.checkInAt)}</td>
      <td class="mono">${fmtTime(r.checkOutAt)}</td>
      <td><span class="status-pill ${statusPillClass(r.status)}">${r.status}</span></td>
    `;
    table.appendChild(tr);
  });
}

function renderReviewQueue(items) {
  const body = document.getElementById("reviewQueueBody");
  if (!items.length) {
    body.innerHTML = `<div class="empty-note">Nothing flagged right now.</div>`;
    return;
  }
  body.innerHTML = items
    .map(
      (i) => `
    <div class="queue-item">
      <div class="queue-icon" style="background:var(--red-wash);color:var(--red);">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/></svg>
      </div>
      <div><div class="queue-title">${(i.flag_reason || "flagged").replace(/_/g, " ")}</div><div class="queue-sub">${i.full_name} · ${i.site_name}</div></div>
      <div class="queue-time">${fmtTime(i.created_at)}</div>
    </div>`
    )
    .join("");
}

async function loadAnomaliesFull() {
  const body = document.getElementById("anomaliesFullBody");
  try {
    const all = await Api.getAllCheckins();
    const flagged = all.filter((c) => c.flagged && !c.reviewed);
    body.innerHTML = flagged.length
      ? flagged
          .map(
            (i) => `
      <div class="queue-item">
        <div class="queue-icon" style="background:var(--red-wash);color:var(--red);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/></svg>
        </div>
        <div><div class="queue-title">${(i.flag_reason || "flagged").replace(/_/g, " ")}</div><div class="queue-sub">${i.full_name} · ${i.site_name}</div></div>
        <div class="queue-time">${new Date(i.created_at).toLocaleString()}</div>
      </div>`
          )
          .join("")
      : `<div class="empty-note">Nothing flagged right now.</div>`;
  } catch (err) {
    body.innerHTML = `<div class="empty-note">${err.message}</div>`;
  }
}

// ---- Team ----
async function loadTeam() {
  const wrap = document.getElementById("teamBySite");
  try {
    const sites = await Api.getTeamBySite();
    state.team = sites;
    wrap.innerHTML = sites
      .map((site) => {
        const rows = site.members
          .map((m) => {
            const skillChips = m.skills.slice(0, 3).map((s) => `<span class="skill-chip">${s.name}</span>`).join("");
            const attStatus = m.attendancePct >= 90 ? "status-present" : m.attendancePct >= 80 ? "status-late" : "status-absent";
            return `
          <tr class="row-click" data-worker-id="${m.id}">
            <td class="name-cell"><div class="avatar-sm">${initials(m.fullName)}</div><div><div class="name-main">${m.fullName}</div><div class="name-sub">${m.title || skillChips || "—"}</div></div></td>
            <td>${skillChips || "<span style='color:var(--ink-faint)'>—</span>"}</td>
            <td><span class="status-pill ${attStatus}">${m.attendancePct}%</span></td>
            <td><span class="link-btn">View →</span></td>
          </tr>`;
          })
          .join("");
        return `
        <div class="site-group" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 4px 10px;">
            <div style="font-weight:700;font-size:13.5px;">${site.siteName}</div>
            <div style="font-size:11.5px;color:var(--ink-faint);font-weight:600;">${site.members.length} worker${site.members.length === 1 ? "" : "s"}</div>
          </div>
          <div class="panel">
            <div class="panel-body" style="padding:0 18px 6px;overflow-x:auto;">
              <table>
                <tr><th>Worker</th><th>Skills</th><th>Attendance (month)</th><th></th></tr>
                ${rows}
              </table>
            </div>
          </div>
        </div>`;
      })
      .join("");

    wrap.querySelectorAll("[data-worker-id]").forEach((tr) => {
      tr.addEventListener("click", () => openWorkerDrawer(tr.dataset.workerId));
    });
  } catch (err) {
    wrap.innerHTML = `<div class="empty-note">${err.message}</div>`;
  }
}

// ---- Activity Feed ----
async function loadActivityFeed() {
  try {
    state.feed = await Api.getAllCheckins();
    renderFeed();
  } catch (err) {
    document.getElementById("feedBody").innerHTML = `<div class="empty-note">${err.message}</div>`;
  }
}

function renderFeed() {
  if (!state.feed) return;
  const filter = (document.getElementById("feedSearch").value || "").toLowerCase();
  let rows = state.feed;
  if (filter) rows = rows.filter((r) => r.full_name.toLowerCase().includes(filter));

  document.getElementById("feedBody").innerHTML = rows.length
    ? rows
        .slice(0, 200)
        .map((a) => {
          const pretty = new Date(a.created_at).toLocaleString();
          return `<div class="log-line">
        <div class="log-time mono">${pretty}</div>
        <div class="log-type ${a.type === "check_in" ? "in" : "out"} mono">${a.type === "check_in" ? "IN" : "OUT"}</div>
        <div><div class="log-detail"><b>${a.full_name}</b> — ${a.site_name} <span class="status-pill status-${a.status}" style="font-size:10px;padding:1px 6px;">${a.status}</span></div><div class="log-loc mono">${a.distance_meters != null ? Math.round(a.distance_meters) + "m from center" : ""}</div></div>
      </div>`;
        })
        .join("")
    : `<div class="empty-note">No matching activity.</div>`;
}

// ---- Worker drawer ----
let monthlyChartInstance = null;
let currentDrawerWorker = null;

async function openWorkerDrawer(userId) {
  currentDrawerWorker = userId;
  document.getElementById("drawerOverlay").classList.add("open");
  switchTab("overview");

  try {
    const [summary, daily] = await Promise.all([Api.workerSummary(userId), Api.getWorkerDaily(userId)]);
    const { user, attendance, tasks, teammates, skills } = summary;

    document.getElementById("dwAvatar").textContent = initials(user.fullName);
    document.getElementById("dwName").textContent = user.fullName;
    document.getElementById("dwRole").textContent = user.title || (user.role === "admin" ? "Admin" : "Worker");
    document.getElementById("dwAttendance").textContent = attendance.daysInMonth
      ? Math.round((attendance.daysPresent / attendance.daysInMonth) * 100) + "%"
      : "—";
    document.getElementById("dwDaysOff").textContent = "—";
    document.getElementById("dwSites").textContent = new Set(tasks.map((t) => t.site_name)).size;
    document.getElementById("dwPhone").textContent = user.phone || "—";
    document.getElementById("dwUsername").textContent = user.username;

    document.getElementById("dwSkills").innerHTML = skills.length
      ? skills
          .map(
            (s) => `<div class="skill-row"><div class="skill-name">${s.name}</div><div class="skill-dots">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= s.level ? "on" : ""}"></span>`).join("")}</div></div>`
          )
          .join("")
      : `<div class="empty-note">No skills tagged yet.</div>`;

    document.getElementById("tab-sitelog").innerHTML = tasks.length
      ? tasks
          .map((t) => {
            const teamHere = teammates.filter((tm) => tm.site_name === t.site_name);
            const teamChips = teamHere.map((tm) => `<span class="team-chip"><span class="dot-av">${initials(tm.full_name)}</span>${tm.full_name}</span>`).join("");
            return `
        <div class="site-visit">
          <div class="sv-top"><div class="sv-site">${t.site_name}</div><div class="sv-date">${t.start_date} → ${t.end_date}</div></div>
          ${teamChips ? `<div class="sv-team">${teamChips}</div>` : ""}
          ${t.task ? `<div class="sv-task">${t.task}</div>` : ""}
        </div>`;
          })
          .join("")
      : `<div class="empty-note">No assignments this month.</div>`;

    const workerActivity = (state.feed || []).filter((a) => a.username === user.username).slice(0, 40);
    document.getElementById("tab-activity").innerHTML = workerActivity.length
      ? `<div class="panel"><div class="panel-body">` +
        workerActivity
          .map(
            (a) => `<div class="log-line">
          <div class="log-time mono">${new Date(a.created_at).toLocaleString()}</div>
          <div class="log-type ${a.type === "check_in" ? "in" : "out"} mono">${a.type === "check_in" ? "IN" : "OUT"}</div>
          <div><div class="log-detail">${a.site_name} <span class="status-pill status-${a.status}" style="font-size:10px;padding:1px 6px;">${a.status}</span></div></div>
        </div>`
          )
          .join("") +
        `</div></div>`
      : `<div class="empty-note">Open the Activity Feed page once to load recent activity, then reopen this worker.</div>`;

    renderMonthlyReport(daily, attendance);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderMonthlyReport(daily, attendance) {
  const present = daily.days.filter((d) => d.hours > 0).length;
  const absent = daily.daysInMonth - present;
  const totalHours = daily.days.reduce((s, d) => s + d.hours, 0);

  document.getElementById("tab-monthly").innerHTML = `
    <div class="report-stats">
      <div class="rstat"><div class="rstat-val">${totalHours.toFixed(1)}h</div><div class="rstat-label">Total Hours</div></div>
      <div class="rstat"><div class="rstat-val">${present}</div><div class="rstat-label">Present Days</div></div>
      <div class="rstat"><div class="rstat-val">${absent}</div><div class="rstat-label">Absent Days</div></div>
      <div class="rstat"><div class="rstat-val">${attendance.daysInMonth}</div><div class="rstat-label">Days This Month</div></div>
    </div>
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head"><h3>Daily Hours — ${daily.month}</h3></div>
      <div class="panel-body"><canvas id="monthlyChart" height="110"></canvas></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Payroll Estimate</h3></div>
      <div class="rate-field">
        <label>Daily rate (EGP)</label>
        <input type="number" id="payRate" value="350" min="0" oninput="updatePayTotal(${present})" />
      </div>
      <div class="payroll-box" style="border:none;border-radius:0;">
        <div class="payroll-row"><span>Present days (${present} × rate)</span><span class="mono">full pay</span></div>
        <div class="payroll-row"><span>Absent days (${absent})</span><span class="mono">unpaid</span></div>
        <div class="payroll-row total"><span>Estimated pay — ${present} payable days</span><span class="mono" id="payTotal">EGP ${(present * 350).toLocaleString()}</span></div>
      </div>
    </div>
  `;

  if (monthlyChartInstance) monthlyChartInstance.destroy();
  const ctx = document.getElementById("monthlyChart");
  const colors = daily.days.map((d) => (d.hours > 0 ? "#16A34A" : "#E7EBF3"));
  monthlyChartInstance = new Chart(ctx, {
    type: "bar",
    data: { labels: daily.days.map((d) => d.day), datasets: [{ label: "Hours", data: daily.days.map((d) => d.hours), backgroundColor: colors, borderRadius: 4, maxBarThickness: 16 }] },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => (daily.days[ctx.dataIndex].hours > 0 ? daily.days[ctx.dataIndex].hours + "h worked" : "Absent") } },
      },
      scales: { y: { beginAtZero: true, grid: { color: "#EEF1F7" }, ticks: { font: { size: 10.5 } } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
    },
  });
}

function updatePayTotal(present) {
  const rate = parseFloat(document.getElementById("payRate").value) || 0;
  document.getElementById("payTotal").textContent = "EGP " + (present * rate).toLocaleString();
}

function closeDrawer() {
  document.getElementById("drawerOverlay").classList.remove("open");
}

function switchTab(name) {
  document.querySelectorAll(".tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "activity" && !state.feed) loadActivityFeed();
}
