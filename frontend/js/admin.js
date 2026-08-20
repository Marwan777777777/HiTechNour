const adminState = { users: [], sites: [], skills: [] };

async function enterAdmin(user) {
  showScreen("admin-screen");
  document.getElementById("admin-user-name").textContent = user.fullName || user.username;

  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });

  const dateInput = document.getElementById("assignments-date");
  dateInput.value = new Date().toISOString().slice(0, 10);
  dateInput.addEventListener("change", () => loadAssignments(dateInput.value));

  const workersMonthInput = document.getElementById("workers-month");
  workersMonthInput.value = new Date().toISOString().slice(0, 7);
  workersMonthInput.addEventListener("change", () => loadWorkers(workersMonthInput.value));

  await Promise.all([loadFlaggedQueue(), loadTeam(), loadAdminSites(), loadWorkers(workersMonthInput.value)]);
  await loadAssignments(dateInput.value);
}

// ---- Workers dashboard ----
async function loadWorkers(month) {
  const list = document.getElementById("workers-list");
  try {
    const users = adminState.users.length ? adminState.users : await Api.getUsers();
    adminState.users = users;
    list.innerHTML = "";
    if (users.length === 0) {
      list.innerHTML = `<li class="admin-item is-empty">No workers yet.</li>`;
      return;
    }
    users.forEach((u) => {
      const li = document.createElement("li");
      li.className = "admin-item";
      li.innerHTML = `
        <div>
          <div>${u.full_name}</div>
          <div class="meta">@${u.username} · ${u.role}</div>
        </div>
        <button class="secondary-button" data-worker-id="${u.id}">View</button>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll("[data-worker-id]").forEach((btn) => {
      btn.addEventListener("click", () => openWorkerDetail(btn.dataset.workerId, month));
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function openWorkerDetail(userId, month) {
  try {
    await ensureSkillsLoaded();
    const summary = await Api.workerSummary(userId, month);
    const { user, attendance, tasks, teammates, skills } = summary;
    const pct = attendance.daysInMonth
      ? Math.round((attendance.daysPresent / attendance.daysInMonth) * 100)
      : 0;
    const tier = pct < 50 ? "tier-low" : pct < 80 ? "tier-mid" : "tier-high";

    const tasksHtml = tasks.length
      ? tasks
          .map(
            (t) => `
        <li class="admin-item">
          <div>
            <div>${t.site_name}${t.task ? ` · ${t.task}` : ""}</div>
            <div class="meta">${t.start_date} → ${t.end_date}</div>
          </div>
        </li>`
          )
          .join("")
      : `<li class="admin-item is-empty">No assignments this month.</li>`;

    const teamHtml = teammates.length
      ? teammates
          .map(
            (t) => `
        <li class="admin-item">
          <div>
            <div>${t.full_name}</div>
            <div class="meta">@${t.username} · ${t.site_name}</div>
          </div>
        </li>`
          )
          .join("")
      : `<li class="admin-item is-empty">Worked alone this month.</li>`;

    const skillTagsHtml = skills.length
      ? skills
          .map(
            (s) => `
        <span class="skill-tag">
          ${s.name}
          <span class="level-dots">${[1, 2, 3, 4, 5]
            .map((n) => `<span class="${n <= s.level ? "filled" : ""}"></span>`)
            .join("")}</span>
          <button class="remove-skill" data-remove-skill-id="${s.skill_id}" title="Remove">×</button>
        </span>`
          )
          .join("")
      : `<span class="meta">No skills tagged yet.</span>`;

    const skillOptions = adminState.skills.length
      ? adminState.skills.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")
      : `<option disabled>No skill tags yet - add some under Sites → Manage Skill Tags</option>`;

    openReadOnlyModal(
      `${user.fullName}`,
      `
      <div class="worker-detail">
        <div class="attendance-summary-head">
          <h3>Attendance — ${attendance.month}</h3>
        </div>
        <div class="attendance-days">${attendance.daysPresent} / ${attendance.daysInMonth} days</div>
        <div class="attendance-bar"><div class="attendance-bar-fill ${tier}" style="width:${pct}%"></div></div>

        <h3 class="worker-detail-heading">Skills</h3>
        <div class="skill-tag-row">${skillTagsHtml}</div>
        <div class="modal-inline-form">
          <select id="w-skill-select">${skillOptions}</select>
          <select id="w-skill-level">
            <option value="1">Level 1</option>
            <option value="2">Level 2</option>
            <option value="3" selected>Level 3</option>
            <option value="4">Level 4</option>
            <option value="5">Level 5</option>
          </select>
          <button id="add-worker-skill-btn" class="secondary-button">+ Tag</button>
        </div>

        <h3 class="worker-detail-heading">Tasks &amp; Sites</h3>
        <ul class="admin-list">${tasksHtml}</ul>

        <h3 class="worker-detail-heading">Team</h3>
        <ul class="admin-list">${teamHtml}</ul>
      </div>
    `
    );

    document.querySelectorAll("[data-remove-skill-id]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await Api.removeWorkerSkill(userId, btn.dataset.removeSkillId);
          openWorkerDetail(userId, month);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    const addSkillBtn = document.getElementById("add-worker-skill-btn");
    if (addSkillBtn) {
      addSkillBtn.addEventListener("click", async () => {
        const skillId = document.getElementById("w-skill-select").value;
        const level = Number(document.getElementById("w-skill-level").value);
        try {
          await Api.setWorkerSkill(userId, skillId, level);
          showToast("Skill tagged.", "success");
          openWorkerDetail(userId, month);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("admin-logout-button").addEventListener("click", () => {
  Auth.logout();
  window.location.reload();
});

// ---- Review queue ----
async function loadFlaggedQueue() {
  const list = document.getElementById("flagged-list");
  try {
    const items = await Api.allCheckins(true);
    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<li class="admin-item is-empty">Nothing pending review.</li>`;
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "admin-item";
      const time = new Date(item.created_at).toLocaleString();
      li.innerHTML = `
        <div>
          <div>${item.full_name} · ${item.site_name}</div>
          <div class="meta">${time} · ${item.type.replace("_", " ")} · ${Math.round(item.distance_meters)}m</div>
          <span class="badge badge-flagged">${item.flag_reason.replace(/_/g, " ")}</span>
        </div>
        <button class="secondary-button" data-review-id="${item.id}">Mark Reviewed</button>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll("[data-review-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await Api.reviewCheckin(btn.dataset.reviewId);
          await loadFlaggedQueue();
          showToast("Marked as reviewed.", "success");
        } catch (err) {
          showToast(err.message, "error");
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---- Team ----
async function loadTeam() {
  const list = document.getElementById("team-list");
  try {
    const users = await Api.getUsers();
    adminState.users = users;
    list.innerHTML = "";
    if (users.length === 0) {
      list.innerHTML = `<li class="admin-item is-empty">No team members yet.</li>`;
      return;
    }
    users.forEach((u) => {
      const li = document.createElement("li");
      li.className = "admin-item";
      const deviceStatus = u.device_approved
        ? "Device approved"
        : u.device_pending
        ? "Device pending approval"
        : "No device registered";
      li.innerHTML = `
        <div>
          <div>${u.full_name} (${u.username})${u.role === "admin" ? " · admin" : ""}</div>
          <div class="meta">${deviceStatus} · ${u.active ? "active" : "disabled"}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          ${u.device_pending ? `<button class="secondary-button" data-approve="${u.id}">Approve Device</button>` : ""}
          ${u.device_approved ? `<button class="secondary-button" data-reset-device="${u.id}">Reset Device</button>` : ""}
          <button class="secondary-button" data-force-logout="${u.id}">Force Logout</button>
          <button class="secondary-button" data-toggle-active="${u.id}" data-active="${u.active}">${u.active ? "Disable" : "Enable"}</button>
        </div>
      `;
      list.appendChild(li);
    });

    list.querySelectorAll("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await Api.approveDevice(btn.dataset.approve);
          showToast("Device approved.", "success");
          await loadTeam();
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
    list.querySelectorAll("[data-reset-device]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Reset this worker's bound device? They'll need re-approval on their next check-in.")) return;
        try {
          await Api.resetDevice(btn.dataset.resetDevice);
          showToast("Device binding reset.", "success");
          await loadTeam();
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
    list.querySelectorAll("[data-force-logout]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Sign this worker out on every device? They'll need to log in again next time.")) return;
        try {
          await Api.forceLogout(btn.dataset.forceLogout);
          showToast("Worker signed out on all devices.", "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
    list.querySelectorAll("[data-toggle-active]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const currentlyActive = btn.dataset.active === "true";
        try {
          await Api.updateUser(btn.dataset.toggleActive, { active: !currentlyActive });
          showToast(currentlyActive ? "Worker disabled." : "Worker enabled.", "success");
          await loadTeam();
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("add-user-button").addEventListener("click", () => {
  openModal("Add Worker", `
    <input id="m-username" placeholder="Username" />
    <input id="m-password" type="password" placeholder="Temporary password (min 8 chars)" />
    <input id="m-fullname" placeholder="Full name" />
    <input id="m-phone" placeholder="Phone (optional, for WhatsApp contact)" />
  `, async () => {
    const username = document.getElementById("m-username").value.trim();
    const password = document.getElementById("m-password").value;
    const fullName = document.getElementById("m-fullname").value.trim();
    const phone = document.getElementById("m-phone").value.trim();
    await Api.createUser({ username, password, fullName, phone });
    showToast("Worker added.", "success");
    await loadTeam();
  });
});

// ---- Assignments ----
async function loadAssignments(date) {
  const list = document.getElementById("assignments-list");
  try {
    const assignments = await Api.getAssignments(date);
    list.innerHTML = "";
    if (assignments.length === 0) {
      list.innerHTML = `<li class="admin-item is-empty">No one assigned for this date.</li>`;
      return;
    }
    assignments.forEach((a) => {
      const li = document.createElement("li");
      li.className = "admin-item";
      const range = a.start_date === a.end_date ? a.start_date : `${a.start_date} → ${a.end_date}`;
      li.innerHTML = `
        <div>
          <div>${a.full_name} → ${a.site_name}</div>
          <div class="meta">${a.task ? a.task + " · " : ""}${range}</div>
        </div>
        <button class="secondary-button" data-delete-assignment="${a.id}">Remove</button>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll("[data-delete-assignment]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this assignment?")) return;
        try {
          await Api.deleteAssignment(btn.dataset.deleteAssignment);
          await loadAssignments(document.getElementById("assignments-date").value);
          showToast("Assignment removed.", "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("add-assignment-button").addEventListener("click", () => {
  if (adminState.users.length === 0 || adminState.sites.length === 0) {
    showToast("Add a worker and a site first.", "error");
    return;
  }
  const today = document.getElementById("assignments-date").value;
  const userOptions = adminState.users
    .filter((u) => u.role === "employee")
    .map((u) => `<option value="${u.id}">${u.full_name}</option>`)
    .join("");
  const siteOptions = adminState.sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  openModal("Assign Worker", `
    <label>Worker<select id="m-a-user">${userOptions}</select></label>
    <label>Site<select id="m-a-site">${siteOptions}</select></label>
    <input id="m-a-task" placeholder="Task (optional, e.g. 'Fix camera 4')" />
    <label>Start date<input id="m-a-start" type="date" value="${today}" /></label>
    <label>End date (leave same as start for one day)<input id="m-a-end" type="date" value="${today}" /></label>
  `, async () => {
    const userId = Number(document.getElementById("m-a-user").value);
    const siteId = Number(document.getElementById("m-a-site").value);
    const task = document.getElementById("m-a-task").value.trim();
    const startDate = document.getElementById("m-a-start").value;
    const endDate = document.getElementById("m-a-end").value;
    await Api.createAssignment({ userId, siteId, task, startDate, endDate });
    showToast("Worker assigned.", "success");
    await loadAssignments(document.getElementById("assignments-date").value);
  });
});

// ---- Sites ----
async function loadAdminSites() {
  const list = document.getElementById("sites-list");
  try {
    const sites = await Api.getSites();
    adminState.sites = sites;
    list.innerHTML = "";
    if (sites.length === 0) {
      list.innerHTML = `<li class="admin-item is-empty">No sites yet - add one below.</li>`;
      return;
    }
    sites.forEach((s) => {
      const li = document.createElement("li");
      li.className = "admin-item";
      li.innerHTML = `
        <div>
          <div>${s.name}</div>
          <div class="meta">${s.address || ""} · ${s.radius_meters}m radius</div>
        </div>
        <button class="secondary-button" data-req-site-id="${s.id}">Requirements</button>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll("[data-req-site-id]").forEach((btn) => {
      const site = sites.find((s) => String(s.id) === btn.dataset.reqSiteId);
      btn.addEventListener("click", () => openSiteRequirements(site));
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---- Skill catalog (shared list of tags like "Software", "Gates Tech") ----
async function ensureSkillsLoaded() {
  if (!adminState.skills.length) {
    adminState.skills = await Api.getSkills();
  }
  return adminState.skills;
}

document.getElementById("manage-skills-button").addEventListener("click", async () => {
  await ensureSkillsLoaded();
  renderSkillCatalogModal();
});

function renderSkillCatalogModal() {
  const rowsHtml = adminState.skills.length
    ? adminState.skills.map((s) => `<li class="admin-item"><div>${s.name}</div></li>`).join("")
    : `<li class="admin-item is-empty">No skill tags yet - add one below.</li>`;

  openReadOnlyModal(
    "Skill Tags",
    `
    <ul class="admin-list">${rowsHtml}</ul>
    <div class="modal-inline-form">
      <input id="new-skill-name" placeholder="e.g. Software, Gates Technician, HVAC" />
      <button id="add-skill-btn" class="secondary-button">+ Add Tag</button>
    </div>
  `
  );

  document.getElementById("add-skill-btn").addEventListener("click", async () => {
    const input = document.getElementById("new-skill-name");
    const name = input.value.trim();
    if (!name) return;
    try {
      await Api.createSkill(name);
      adminState.skills = await Api.getSkills();
      showToast("Skill tag added.", "success");
      renderSkillCatalogModal();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ---- Site requirements + matching workers ----
async function openSiteRequirements(site) {
  try {
    await ensureSkillsLoaded();
    const requirements = await Api.getSiteRequirements(site.id);

    const skillOptions = adminState.skills
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");

    const reqRows = requirements.length
      ? requirements
          .map((r) => {
            const short = r.workers_available < r.workers_needed;
            return `
        <div class="requirement-row" data-skill-id="${r.skill_id}" data-skill-name="${r.skill_name}">
          <span class="req-name">${r.skill_name}</span>
          <span class="req-count ${short ? "shortfall" : "met"}">
            needs ${r.workers_needed} · ${r.workers_available} available
          </span>
        </div>`;
          })
          .join("")
      : `<div class="meta">No skill requirements set for this site yet.</div>`;

    openReadOnlyModal(
      `${site.name} — Requirements`,
      `
      <div>${reqRows}</div>
      <div class="modal-inline-form">
        <select id="req-skill-select">${skillOptions || "<option disabled>No skill tags yet</option>"}</select>
        <input id="req-count-input" type="number" min="1" value="1" style="width:70px" />
        <button id="add-requirement-btn" class="secondary-button">+ Add</button>
      </div>
    `
    );

    document.querySelectorAll(".requirement-row").forEach((row) => {
      row.addEventListener("click", () =>
        openSkillMatches(row.dataset.skillId, row.dataset.skillName)
      );
    });

    const addBtn = document.getElementById("add-requirement-btn");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const skillId = document.getElementById("req-skill-select").value;
        const workersNeeded = Number(document.getElementById("req-count-input").value) || 1;
        try {
          await Api.setSiteRequirement(site.id, skillId, workersNeeded);
          showToast("Requirement saved.", "success");
          openSiteRequirements(site);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

// The "click a required skill, see everyone who fits" view.
async function openSkillMatches(skillId, skillName) {
  try {
    const workers = await Api.getSkillWorkers(skillId);
    const rows = workers.length
      ? workers
          .map(
            (w) => `
        <li class="admin-item">
          <div>
            <div>${w.full_name}${w.active ? "" : " (inactive)"}</div>
            <div class="meta">@${w.username}${w.phone ? ` · ${w.phone}` : ""}</div>
          </div>
          <span class="skill-tag">
            <span class="level-dots">${[1, 2, 3, 4, 5]
              .map((n) => `<span class="${n <= w.level ? "filled" : ""}"></span>`)
              .join("")}</span>
          </span>
        </li>`
          )
          .join("")
      : `<li class="admin-item is-empty">No workers tagged with this skill yet.</li>`;

    openReadOnlyModal(`Workers: ${skillName}`, `<ul class="admin-list">${rows}</ul>`);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Extracts { lat, lng } from a pasted Google Maps URL or a plain "lat, lng" string.
// Supports: /@lat,lng,zoom  |  ?q=lat,lng  |  !3dLAT!4dLNG (place links)  |  plain "lat, lng"
function parseGoogleMapsLink(input) {
  const text = (input || "").trim();
  if (!text) return null;

  // Plain "lat, lng" or "lat lng"
  let m = text.match(/^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // /@lat,lng,zoom  (most common when copying from the address bar)
  m = text.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // ?q=lat,lng  or  &q=lat,lng
  m = text.match(/[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // !3dLAT!4dLNG  (embedded in "place" links)
  m = text.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  return null;
}

document.getElementById("add-site-button").addEventListener("click", () => {
  openModal("Add Site", `
    <input id="m-site-name" placeholder="Site name" />
    <input id="m-site-address" placeholder="Address" />
    <input id="m-site-maps-link" placeholder="Paste Google Maps link (optional)" />
    <div id="m-site-maps-hint" class="field-hint"></div>
    <input id="m-site-lat" placeholder="Latitude (e.g. 30.0452333)" />
    <input id="m-site-lng" placeholder="Longitude (e.g. 31.341210)" />
    <input id="m-site-radius" placeholder="Radius in meters (default 200)" />
  `, async () => {
    const name = document.getElementById("m-site-name").value.trim();
    const address = document.getElementById("m-site-address").value.trim();
    const lat = Number(document.getElementById("m-site-lat").value);
    const lng = Number(document.getElementById("m-site-lng").value);
    const radiusInput = document.getElementById("m-site-radius").value;
    const radiusMeters = radiusInput ? Number(radiusInput) : 200;
    await Api.createSite({ name, address, lat, lng, radiusMeters });
    showToast("Site added.", "success");
    await loadAdminSites();
  });

  const linkInput = document.getElementById("m-site-maps-link");
  const hint = document.getElementById("m-site-maps-hint");
  const latInput = document.getElementById("m-site-lat");
  const lngInput = document.getElementById("m-site-lng");

  linkInput.addEventListener("input", () => {
    const value = linkInput.value.trim();
    if (!value) {
      hint.textContent = "";
      return;
    }
    if (/goo\.gl|maps\.app\.goo\.gl/.test(value)) {
      hint.textContent = "Shortened links can't be read directly — open it in the browser first, then paste the full expanded URL here.";
      hint.classList.add("field-hint-error");
      return;
    }
    const coords = parseGoogleMapsLink(value);
    if (coords) {
      latInput.value = coords.lat;
      lngInput.value = coords.lng;
      hint.textContent = `Detected: ${coords.lat}, ${coords.lng}`;
      hint.classList.remove("field-hint-error");
    } else {
      hint.textContent = "Couldn't find coordinates in that link — paste lat/lng manually below.";
      hint.classList.add("field-hint-error");
    }
  });
});

// ---- Export ----
document.getElementById("export-button").addEventListener("click", async () => {
  const start = document.getElementById("export-start").value;
  const end = document.getElementById("export-end").value;
  if (!start || !end) {
    showToast("Pick a start and end date.", "error");
    return;
  }
  const button = document.getElementById("export-button");
  setButtonLoading(button, true);
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
    setButtonLoading(button, false);
  }
});

// ---- Read-only modal (worker detail, etc.) - single "Close" button, no
// confirm/cancel pair since there's nothing to submit. ----
function openReadOnlyModal(title, bodyHtml) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal").classList.remove("hidden");

  const confirmBtn = document.getElementById("modal-confirm");
  const cancelBtn = document.getElementById("modal-cancel");
  const closeModal = () => document.getElementById("modal").classList.add("hidden");

  const newConfirm = confirmBtn.cloneNode(true);
  newConfirm.querySelector(".btn-label").textContent = "Close";
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  newConfirm.addEventListener("click", closeModal);

  cancelBtn.classList.add("hidden");
}

// ---- Modal helper ----
function openModal(title, bodyHtml, onConfirm) {
  document.getElementById("modal-cancel").classList.remove("hidden");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal").classList.remove("hidden");

  const confirmBtn = document.getElementById("modal-confirm");
  const cancelBtn = document.getElementById("modal-cancel");

  const closeModal = () => document.getElementById("modal").classList.add("hidden");
  const confirmHandler = async () => {
    setButtonLoading(confirmBtn, true);
    try {
      await onConfirm();
      closeModal();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setButtonLoading(confirmBtn, false);
    }
  };

  // Replace nodes to clear any previously-attached listeners.
  const newConfirm = confirmBtn.cloneNode(true);
  newConfirm.querySelector(".btn-label").textContent = "Save";
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  newConfirm.addEventListener("click", confirmHandler);

  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  newCancel.addEventListener("click", closeModal);
}
