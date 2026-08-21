(function () {
  function toast(msg, kind) {
    if (typeof showToast === "function") showToast(msg, kind || "");
  }
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }
  const SKILL_COLORS = ["#2557D6","#7C5CFC","#16A34A","#D97706","#DC2626","#0891B2","#DB2777","#65A30D","#4F46E5","#EA580C"];
  function colorForSkill(name) {
    let h = 0;
    const s = String(name || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SKILL_COLORS[h % SKILL_COLORS.length];
  }

  window.loadAnomaliesFull = async function () {
    const body = document.getElementById("anomaliesFullBody");
    if (!body) return;
    try {
      const all = await Api.allCheckins(true);
      const flagged = all.filter((c) => c.flagged && !c.reviewed);
      if (!flagged.length) {
        body.innerHTML = '<div class="empty-note">Nothing flagged right now.</div>';
        return;
      }
      body.innerHTML = flagged.map((i) => `
        <div class="queue-item" style="align-items:center;">
          <div class="queue-icon" style="background:var(--red-wash);color:var(--red);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/></svg>
          </div>
          <div style="flex:1;">
            <div class="queue-title">${(i.flag_reason || "flagged").replace(/_/g, " ")}</div>
            <div class="queue-sub">${escapeHtml(i.full_name)} · ${escapeHtml(i.site_name)}</div>
          </div>
          <div class="queue-time" style="margin-right:12px;">${new Date(i.created_at).toLocaleString()}</div>
          <button class="secondary-button" style="margin:0;" data-review-id="${i.id}">Mark reviewed</button>
        </div>`).join("");
      body.querySelectorAll("[data-review-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await Api.reviewCheckin(btn.dataset.reviewId);
            toast("Marked as reviewed", "success");
            window.loadAnomaliesFull();
            if (typeof loadOverview === "function") loadOverview();
          } catch (err) {
            toast(err.message, "error");
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="empty-note">${escapeHtml(err.message)}</div>`;
    }
  };

  window.loadSitesPage = async function () {
    const root = document.getElementById("sitesPageBody");
    if (!root) return;
    root.innerHTML = '<div class="empty-note">Loading sites…</div>';
    try {
      const sites = await Api.getSites();
      root.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
          <button id="addSiteBtn" style="padding:9px 16px;border-radius:var(--radius-sm);border:none;background:var(--blue);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">+ Add Site</button>
        </div>
        <div class="panel"><div class="panel-body" style="padding:0 18px 6px;overflow-x:auto;">
          <table><thead><tr><th>Name</th><th>Address</th><th>Lat / Lng</th><th>Radius</th><th></th></tr></thead>
          <tbody>${sites.map((s) => `<tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${escapeHtml(s.address || "—")}</td>
            <td class="mono" style="font-size:11px;">${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}</td>
            <td class="mono">${s.radius_meters || 200}m</td>
            <td style="white-space:nowrap;">
              <button class="secondary-button" style="margin:0 6px 0 0;" data-edit-site='${JSON.stringify(s).replace(/'/g, "&#39;")}'>Edit</button>
              <button class="secondary-button" style="margin:0;color:var(--red);border-color:#f3c9c9;" data-deactivate-site="${s.id}" data-name="${escapeHtml(s.name)}">Deactivate</button>
            </td></tr>`).join("")}</tbody></table>
        </div></div>`;
      document.getElementById("addSiteBtn")?.addEventListener("click", () => openSiteModal(null));
      root.querySelectorAll("[data-edit-site]").forEach((btn) => {
        btn.addEventListener("click", () => { try { openSiteModal(JSON.parse(btn.getAttribute("data-edit-site"))); } catch (_) {} });
      });
      root.querySelectorAll("[data-deactivate-site]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm('Deactivate "' + btn.dataset.name + '"?')) return;
          try { await Api.updateSite(btn.dataset.deactivateSite, { active: false }); toast("Site deactivated", "success"); loadSitesPage(); }
          catch (err) { toast(err.message, "error"); }
        });
      });
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${escapeHtml(err.message)}</div>`;
    }
  };

  function openSiteModal(site) {
    const overlay = document.getElementById("siteModalOverlay");
    if (!overlay) return;
    document.getElementById("siteModalTitle").textContent = site ? "Edit Site" : "Add Site";
    document.getElementById("siteName").value = site?.name || "";
    document.getElementById("siteAddress").value = site?.address || "";
    document.getElementById("siteLat").value = site?.lat ?? "";
    document.getElementById("siteLng").value = site?.lng ?? "";
    document.getElementById("siteRadius").value = site?.radius_meters || 200;
    overlay.dataset.editId = site?.id || "";
    document.getElementById("siteModalError").classList.add("hidden");
    overlay.classList.add("open");
  }
  function closeSiteModal() { document.getElementById("siteModalOverlay")?.classList.remove("open"); }
  document.getElementById("siteModalClose")?.addEventListener("click", closeSiteModal);
  document.getElementById("siteModalOverlay")?.addEventListener("click", (e) => { if (e.target.id === "siteModalOverlay") closeSiteModal(); });
  document.getElementById("siteModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("siteModalError");
    errEl.classList.add("hidden");
    const payload = {
      name: document.getElementById("siteName").value.trim(),
      address: document.getElementById("siteAddress").value.trim() || undefined,
      lat: Number(document.getElementById("siteLat").value),
      lng: Number(document.getElementById("siteLng").value),
      radiusMeters: Number(document.getElementById("siteRadius").value) || 200,
    };
    if (!payload.name || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
      errEl.textContent = "Name, lat, and lng are required."; errEl.classList.remove("hidden"); return;
    }
    const editId = document.getElementById("siteModalOverlay").dataset.editId;
    try {
      if (editId) await Api.updateSite(editId, payload); else await Api.createSite(payload);
      toast(editId ? "Site updated" : "Site created", "success"); closeSiteModal(); loadSitesPage();
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove("hidden"); }
  });

  // SITE STAFFING
  window.loadSkillsPage = async function () {
    const root = document.getElementById("skillsPageBody");
    if (!root) return;
    root.innerHTML = '<div class="empty-note">Loading…</div>';
    try {
      const [skills, sites, users] = await Promise.all([Api.getSkills(), Api.getSites(), Api.getUsers(false)]);
      const workers = users.filter((u) => u.role !== "admin");
      const skillWorkerMaps = {};
      await Promise.all(skills.map(async (s) => {
        try { skillWorkerMaps[s.id] = await Api.getSkillWorkers(s.id); } catch { skillWorkerMaps[s.id] = []; }
      }));
      const skillsByUser = {};
      workers.forEach((w) => (skillsByUser[w.id] = []));
      skills.forEach((s) => {
        (skillWorkerMaps[s.id] || []).forEach((row) => {
          if (!skillsByUser[row.id]) skillsByUser[row.id] = [];
          skillsByUser[row.id].push({ skillId: s.id, name: s.name, level: row.level });
        });
      });
      const today = new Date().toISOString().slice(0, 10);

      root.innerHTML = `
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-head"><h3>Skill / role tags</h3></div>
          <div class="panel-body">
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <input id="newSkillName" placeholder="e.g. software, hardware…" style="flex:1;border:1px solid var(--line-strong);border-radius:8px;padding:9px 12px;font-size:13px;" />
              <button id="addSkillBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">Add</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">${skills.map((s) => { const c = colorForSkill(s.name); return `<span style="background:${c}18;color:${c};border:1px solid ${c}44;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:700;">${escapeHtml(s.name)}</span>`; }).join("") || "—"}</div>
          </div>
        </div>
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-head"><h3>Tag a worker</h3></div>
          <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;">
            <div style="flex:1;min-width:140px;"><label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Worker</label>
              <select id="tagWorker" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">${workers.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join("")}</select></div>
            <div style="flex:1;min-width:120px;"><label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Skill</label>
              <select id="tagSkill" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">${skills.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></div>
            <div style="width:90px;"><label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Level</label>
              <input id="tagLevel" type="number" min="1" max="5" value="3" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;" /></div>
            <button id="tagSkillBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">Save</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Staff a site for a day</h3></div>
          <div class="panel-body">
            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:16px;">
              <div style="flex:1;min-width:160px;"><label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Site</label>
                <select id="staffSite" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">${sites.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></div>
              <div style="width:150px;"><label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Date</label>
                <input id="staffDate" type="date" value="${today}" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;" /></div>
              <button id="staffRefreshBtn" style="border:1px solid var(--line-strong);background:#fff;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;">Refresh</button>
            </div>
            <div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:14px;background:#FAFBFE;">
              <div style="font-size:12px;font-weight:700;color:var(--ink-dim);margin-bottom:10px;">What this site needs (skill + min level + count)</div>
              <div id="needsRows"></div>
              <button id="addNeedRow" type="button" style="margin-top:8px;border:1px dashed var(--line-strong);background:transparent;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;color:var(--blue);cursor:pointer;">+ Add role need</button>
              <button id="saveNeedsBtn" type="button" style="margin-top:8px;margin-left:8px;border:none;background:var(--blue);color:#fff;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">Save needs</button>
            </div>
            <div id="staffBoard"><div class="empty-note">Loading…</div></div>
          </div>
        </div>`;

      document.getElementById("addSkillBtn")?.addEventListener("click", async () => {
        const name = document.getElementById("newSkillName").value.trim();
        if (!name) return;
        try { await Api.createSkill(name); toast("Skill added", "success"); loadSkillsPage(); } catch (err) { toast(err.message, "error"); }
      });
      document.getElementById("tagSkillBtn")?.addEventListener("click", async () => {
        try {
          await Api.setWorkerSkill(document.getElementById("tagWorker").value, Number(document.getElementById("tagSkill").value), Number(document.getElementById("tagLevel").value) || 3);
          toast("Saved", "success"); loadSkillsPage();
        } catch (err) { toast(err.message, "error"); }
      });

      let needs = [];
      const needsEl = document.getElementById("needsRows");

      function renderNeedsRows() {
        needsEl.innerHTML = needs.map((n, idx) => `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
          <select data-need-skill="${idx}" style="flex:1;min-width:120px;border:1px solid var(--line-strong);border-radius:8px;padding:7px;background:#fff;">
            ${skills.map((s) => `<option value="${s.id}" ${Number(n.skillId) === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
          <label style="font-size:11px;color:var(--ink-dim);">min L<input data-need-level="${idx}" type="number" min="1" max="5" value="${n.minLevel || 1}" style="width:52px;margin-left:4px;border:1px solid var(--line-strong);border-radius:6px;padding:6px;" /></label>
          <label style="font-size:11px;color:var(--ink-dim);">×<input data-need-count="${idx}" type="number" min="1" value="${n.count || 1}" style="width:52px;margin-left:4px;border:1px solid var(--line-strong);border-radius:6px;padding:6px;" /></label>
          <button data-rm-need="${idx}" style="border:none;background:transparent;color:var(--red);font-weight:700;cursor:pointer;">✕</button>
        </div>`).join("");
        needsEl.querySelectorAll("[data-need-skill]").forEach((el) => el.addEventListener("change", () => { needs[Number(el.dataset.needSkill)].skillId = Number(el.value); renderStaffBoard(); }));
        needsEl.querySelectorAll("[data-need-level]").forEach((el) => el.addEventListener("change", () => { needs[Number(el.dataset.needLevel)].minLevel = Number(el.value) || 1; renderStaffBoard(); }));
        needsEl.querySelectorAll("[data-need-count]").forEach((el) => el.addEventListener("change", () => { needs[Number(el.dataset.needCount)].count = Number(el.value) || 1; renderStaffBoard(); }));
        needsEl.querySelectorAll("[data-rm-need]").forEach((el) => el.addEventListener("click", () => { needs.splice(Number(el.dataset.rmNeed), 1); renderNeedsRows(); renderStaffBoard(); }));
      }

      document.getElementById("addNeedRow")?.addEventListener("click", () => {
        needs.push({ skillId: skills[0]?.id, minLevel: 1, count: 1 });
        renderNeedsRows(); renderStaffBoard();
      });
      document.getElementById("saveNeedsBtn")?.addEventListener("click", async () => {
        const siteId = document.getElementById("staffSite").value;
        try {
          const existing = await Api.getSiteRequirements(siteId);
          for (const r of existing) await Api.removeSiteRequirement(siteId, r.skill_id);
          for (const n of needs) if (n.skillId) await Api.setSiteRequirement(siteId, n.skillId, n.count || 1);
          toast("Needs saved", "success");
        } catch (err) { toast(err.message, "error"); }
      });

      async function loadExistingNeeds() {
        const siteId = document.getElementById("staffSite").value;
        try {
          const rows = await Api.getSiteRequirements(siteId);
          needs = rows.map((r) => ({ skillId: r.skill_id, minLevel: 1, count: r.workers_needed }));
          if (!needs.length && skills[0]) needs = [{ skillId: skills[0].id, minLevel: 1, count: 1 }];
        } catch {
          needs = skills[0] ? [{ skillId: skills[0].id, minLevel: 1, count: 1 }] : [];
        }
        renderNeedsRows();
        await renderStaffBoard();
      }

      async function renderStaffBoard() {
        const board = document.getElementById("staffBoard");
        const siteId = Number(document.getElementById("staffSite").value);
        const date = document.getElementById("staffDate").value || today;
        if (!board) return;
        let assignments = [];
        try { assignments = await Api.getAssignments(date); } catch { assignments = []; }
        const assignedIds = new Set(assignments.filter((a) => Number(a.site_id) === siteId).map((a) => a.user_id));
        const busyElsewhere = new Set(assignments.filter((a) => Number(a.site_id) !== siteId).map((a) => a.user_id));
        if (!needs.length) { board.innerHTML = '<div class="empty-note">Add role needs above.</div>'; return; }

        board.innerHTML = needs.map((n) => {
          const skill = skills.find((s) => s.id === Number(n.skillId));
          const skillName = skill?.name || "Skill";
          const color = colorForSkill(skillName);
          const minLevel = n.minLevel || 1;
          const count = n.count || 1;
          const matches = workers.filter((w) => (skillsByUser[w.id] || []).some((sk) => sk.skillId === Number(n.skillId) && sk.level >= minLevel));
          const alreadyHere = matches.filter((w) => assignedIds.has(w.id));
          const available = matches.filter((w) => !assignedIds.has(w.id) && !busyElsewhere.has(w.id));
          const busy = matches.filter((w) => busyElsewhere.has(w.id));

          function chip(w, action) {
            const sk = (skillsByUser[w.id] || []).map((s) => {
              const c = colorForSkill(s.name);
              return `<span style="background:${c}18;color:${c};font-size:10px;padding:1px 6px;border-radius:999px;font-weight:700;margin-left:4px;">${escapeHtml(s.name)} L${s.level}</span>`;
            }).join("");
            return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;background:#fff;">
              <div><strong>${escapeHtml(w.full_name)}</strong>${sk}</div>${action}</div>`;
          }

          return `<div style="border:1px solid ${color}33;border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
              <div style="font-weight:700;font-size:14px;color:${color};">${escapeHtml(skillName)} · need ${count} · min L${minLevel}</div>
              <div style="font-size:12px;color:var(--ink-faint);">${alreadyHere.length}/${count} assigned</div>
            </div>
            ${alreadyHere.length ? `<div style="font-size:11.5px;font-weight:700;color:var(--ink-dim);margin-bottom:6px;">Assigned</div>` + alreadyHere.map((w) => {
              const a = assignments.find((x) => x.user_id === w.id && Number(x.site_id) === siteId);
              return chip(w, a ? `<button class="secondary-button" style="margin:0;color:var(--red);" data-unassign="${a.id}">Remove</button>` : "");
            }).join("") : ""}
            <div style="font-size:11.5px;font-weight:700;color:var(--ink-dim);margin:10px 0 6px;">Available (${available.length})</div>
            ${available.length ? available.map((w) => chip(w, alreadyHere.length >= count ? `<span style="font-size:11px;color:var(--ink-faint);">full</span>` : `<button style="border:none;background:${color};color:#fff;border-radius:8px;padding:7px 12px;font-weight:700;font-size:12px;cursor:pointer;" data-assign="${w.id}" data-skill="${escapeHtml(skillName)}">Assign</button>`)).join("") : '<div class="empty-note" style="padding:8px 0;">No free workers match this skill/level.</div>'}
            ${busy.length ? `<div style="font-size:11.5px;font-weight:700;color:var(--ink-dim);margin:10px 0 6px;">Busy elsewhere</div>` + busy.map((w) => chip(w, `<span style="font-size:11px;color:var(--amber);">elsewhere</span>`)).join("") : ""}
          </div>`;
        }).join("");

        board.querySelectorAll("[data-assign]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              await Api.createAssignment({ userId: Number(btn.dataset.assign), siteId, startDate: date, endDate: date, task: btn.dataset.skill || undefined });
              toast("Assigned", "success"); await renderStaffBoard(); state.team = null;
            } catch (err) { toast(err.message, "error"); btn.disabled = false; }
          });
        });
        board.querySelectorAll("[data-unassign]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Remove assignment?")) return;
            try { await Api.deleteAssignment(btn.dataset.unassign); toast("Removed", "success"); await renderStaffBoard(); state.team = null; }
            catch (err) { toast(err.message, "error"); }
          });
        });
      }

      document.getElementById("staffSite")?.addEventListener("change", loadExistingNeeds);
      document.getElementById("staffDate")?.addEventListener("change", renderStaffBoard);
      document.getElementById("staffRefreshBtn")?.addEventListener("click", renderStaffBoard);
      await loadExistingNeeds();
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${escapeHtml(err.message)}</div>`;
    }
  };

  window.injectWorkerActions = function (userId, user) {
    const panel = document.getElementById("tab-overview");
    if (!panel) return;
    panel.querySelector("[data-worker-actions]")?.remove();
    const box = document.createElement("div");
    box.setAttribute("data-worker-actions", "1");
    box.className = "panel";
    box.style.marginTop = "14px";
    box.innerHTML = `
      <div class="panel-head"><h3>Admin actions</h3></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input id="editFullName" value="${escapeHtml(user.fullName || "")}" placeholder="Full name" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;" />
          <input id="editPhone" value="${escapeHtml(user.phone || "")}" placeholder="Phone" style="flex:1;min-width:120px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="saveWorkerBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">Save</button>
          <button id="deactivateWorkerBtn" style="border:1px solid #f3c9c9;background:#fff;color:var(--red);border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">${user.active === false ? "Reactivate" : "Deactivate"}</button>
          <button id="deleteWorkerBtn" style="border:1px solid #f3c9c9;background:#FCEAEA;color:var(--red);border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">Delete forever</button>
        </div>
        <div style="font-size:11px;color:var(--ink-faint);">Deactivate hides from Team/Devices. Delete is permanent (for test duplicates).</div>
      </div>`;
    panel.appendChild(box);
    document.getElementById("saveWorkerBtn")?.addEventListener("click", async () => {
      try {
        await Api.updateUser(userId, { fullName: document.getElementById("editFullName").value.trim(), phone: document.getElementById("editPhone").value.trim() });
        toast("Updated", "success"); state.team = null;
      } catch (err) { toast(err.message, "error"); }
    });
    document.getElementById("deactivateWorkerBtn")?.addEventListener("click", async () => {
      const nextActive = user.active === false;
      if (!nextActive && !confirm("Deactivate? They disappear from Team and can't log in.")) return;
      try {
        await Api.updateUser(userId, { active: nextActive });
        toast(nextActive ? "Reactivated" : "Deactivated", "success");
        state.team = null; if (typeof loadTeam === "function") loadTeam(); closeDrawer();
      } catch (err) { toast(err.message, "error"); }
    });
    document.getElementById("deleteWorkerBtn")?.addEventListener("click", async () => {
      if (!confirm("Permanently DELETE this account?")) return;
      if (!confirm("Really delete forever?")) return;
      try {
        await Api.deleteUser(userId);
        toast("Deleted", "success");
        state.team = null; if (typeof loadTeam === "function") loadTeam(); closeDrawer();
      } catch (err) { toast(err.message, "error"); }
    });
  };

  const origOpen = window.openWorkerDrawer;
  if (typeof origOpen === "function") {
    window.openWorkerDrawer = async function (userId) {
      await origOpen(userId);
      try { const summary = await Api.workerSummary(userId); injectWorkerActions(userId, summary.user); } catch (_) {}
    };
  }
  const origShow = window.showPage;
  if (typeof origShow === "function") {
    window.showPage = function (name) {
      origShow(name);
      if (name === "sites") loadSitesPage();
      if (name === "skills") loadSkillsPage();
      if (name === "anomalies") loadAnomaliesFull();
    };
  }
})();
