// Extra admin operations loaded after admin-dashboard.js
// Sites · Skills · Anomalies review · Worker edit/deactivate

(function () {
  function toast(msg, kind) {
    if (typeof showToast === "function") showToast(msg, kind || "");
  }

  // ---------- ANORMALIES: Mark as reviewed ----------
  const origLoadAnomalies = window.loadAnomaliesFull;
  window.loadAnomaliesFull = async function () {
    const body = document.getElementById("anomaliesFullBody");
    if (!body) return;
    try {
      const all = await Api.allCheckins(true); // flagged only
      const flagged = all.filter((c) => c.flagged && !c.reviewed);
      if (!flagged.length) {
        body.innerHTML = '<div class="empty-note">Nothing flagged right now.</div>';
        return;
      }
      body.innerHTML = flagged
        .map(
          (i) => `
        <div class="queue-item" style="align-items:center;">
          <div class="queue-icon" style="background:var(--red-wash);color:var(--red);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/></svg>
          </div>
          <div style="flex:1;">
            <div class="queue-title">${(i.flag_reason || "flagged").replace(/_/g, " ")}</div>
            <div class="queue-sub">${i.full_name} · ${i.site_name} · ${i.type === "check_in" ? "IN" : "OUT"}</div>
          </div>
          <div class="queue-time" style="margin-right:12px;">${new Date(i.created_at).toLocaleString()}</div>
          <button class="secondary-button" style="margin:0;" data-review-id="${i.id}">Mark reviewed</button>
        </div>`
        )
        .join("");

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
      body.innerHTML = `<div class="empty-note">${err.message}</div>`;
    }
  };

  // Also improve overview review queue with review buttons
  const origRenderReview = window.renderReviewQueue;
  // leave overview list as summary; full page has actions

  // ---------- SITES ----------
  window.loadSitesPage = async function () {
    const root = document.getElementById("sitesPageBody");
    if (!root) return;
    root.innerHTML = '<div class="empty-note">Loading sites…</div>';
    try {
      const sites = await Api.getSites();
      root.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
          <button id="addSiteBtn" style="display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:var(--radius-sm);border:none;background:var(--blue);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13px;cursor:pointer;">+ Add Site</button>
        </div>
        <div class="panel">
          <div class="panel-body" style="padding:0 18px 6px;overflow-x:auto;">
            <table>
              <thead><tr><th>Name</th><th>Address</th><th>Lat / Lng</th><th>Radius</th><th></th></tr></thead>
              <tbody id="sitesTableBody">
                ${sites
                  .map(
                    (s) => `
                  <tr>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td>${escapeHtml(s.address || "—")}</td>
                    <td class="mono" style="font-size:11px;">${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}</td>
                    <td class="mono">${s.radius_meters || 200}m</td>
                    <td style="white-space:nowrap;">
                      <button class="secondary-button" style="margin:0 6px 0 0;" data-edit-site='${JSON.stringify(s).replace(/'/g, "&#39;")}'>Edit</button>
                      <button class="secondary-button" style="margin:0;color:var(--red);border-color:#f3c9c9;" data-deactivate-site="${s.id}" data-name="${escapeHtml(s.name)}">Deactivate</button>
                    </td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
            ${sites.length === 0 ? '<div class="empty-note">No sites yet. Add one.</div>' : ""}
          </div>
        </div>`;

      document.getElementById("addSiteBtn")?.addEventListener("click", () => openSiteModal(null));
      root.querySelectorAll("[data-edit-site]").forEach((btn) => {
        btn.addEventListener("click", () => {
          try {
            openSiteModal(JSON.parse(btn.getAttribute("data-edit-site")));
          } catch (_) {}
        });
      });
      root.querySelectorAll("[data-deactivate-site]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Deactivate site \"" + btn.dataset.name + "\"? Workers won't see it for check-in.")) return;
          try {
            await Api.updateSite(btn.dataset.deactivateSite, { active: false });
            toast("Site deactivated", "success");
            loadSitesPage();
          } catch (err) {
            toast(err.message, "error");
          }
        });
      });
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${err.message}</div>`;
    }
  };

  function openSiteModal(site) {
    const isEdit = !!site;
    const overlay = document.getElementById("siteModalOverlay");
    if (!overlay) return;
    document.getElementById("siteModalTitle").textContent = isEdit ? "Edit Site" : "Add Site";
    document.getElementById("siteName").value = site?.name || "";
    document.getElementById("siteAddress").value = site?.address || "";
    document.getElementById("siteLat").value = site?.lat ?? "";
    document.getElementById("siteLng").value = site?.lng ?? "";
    document.getElementById("siteRadius").value = site?.radius_meters || 200;
    overlay.dataset.editId = site?.id || "";
    document.getElementById("siteModalError").classList.add("hidden");
    overlay.classList.add("open");
  }

  function closeSiteModal() {
    document.getElementById("siteModalOverlay")?.classList.remove("open");
  }

  document.getElementById("siteModalClose")?.addEventListener("click", closeSiteModal);
  document.getElementById("siteModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "siteModalOverlay") closeSiteModal();
  });
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
      errEl.textContent = "Name, lat, and lng are required.";
      errEl.classList.remove("hidden");
      return;
    }
    const editId = document.getElementById("siteModalOverlay").dataset.editId;
    try {
      if (editId) await Api.updateSite(editId, payload);
      else await Api.createSite(payload);
      toast(editId ? "Site updated" : "Site created", "success");
      closeSiteModal();
      loadSitesPage();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });

  // ---------- SKILLS ----------
  window.loadSkillsPage = async function () {
    const root = document.getElementById("skillsPageBody");
    if (!root) return;
    root.innerHTML = '<div class="empty-note">Loading skills…</div>';
    try {
      const [skills, sites, users] = await Promise.all([
        Api.getSkills(),
        Api.getSites(),
        Api.getUsers(),
      ]);
      state._skillsCache = skills;
      state._sitesCache = sites;
      state._usersCache = users;

      root.innerHTML = `
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-head"><h3>Skill tags</h3></div>
          <div class="panel-body">
            <div style="display:flex;gap:8px;margin-bottom:14px;">
              <input id="newSkillName" placeholder="New skill name…" style="flex:1;border:1px solid var(--line-strong);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;" />
              <button id="addSkillBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;">Add</button>
            </div>
            <div id="skillsList" style="display:flex;flex-wrap:wrap;gap:8px;">
              ${skills.map((s) => `<span class="skill-chip" style="padding:6px 12px;">${escapeHtml(s.name)}</span>`).join("") || "<span class='empty-note'>No skills yet.</span>"}
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-head"><h3>Tag worker with skill</h3></div>
          <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;">
            <div style="flex:1;min-width:140px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Worker</label>
              <select id="tagWorker" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">
                ${users.filter((u) => u.role !== "admin" || true).map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join("")}
              </select>
            </div>
            <div style="flex:1;min-width:120px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Skill</label>
              <select id="tagSkill" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">
                ${skills.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
              </select>
            </div>
            <div style="width:90px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Level 1–5</label>
              <input id="tagLevel" type="number" min="1" max="5" value="3" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;" />
            </div>
            <button id="tagSkillBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;">Save tag</button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Site skill requirements</h3></div>
          <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:14px;">
            <div style="flex:1;min-width:140px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Site</label>
              <select id="reqSite" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">
                ${sites.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
              </select>
            </div>
            <div style="flex:1;min-width:120px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Skill</label>
              <select id="reqSkill" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;background:#fff;">
                ${skills.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
              </select>
            </div>
            <div style="width:100px;">
              <label style="font-size:11.5px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:6px;">Needed</label>
              <input id="reqNeeded" type="number" min="1" value="1" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px;" />
            </div>
            <button id="reqSaveBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;">Set requirement</button>
          </div>
          <div id="reqList" class="empty-note">Select a site to view requirements.</div>
        </div>`;

      document.getElementById("addSkillBtn")?.addEventListener("click", async () => {
        const name = document.getElementById("newSkillName").value.trim();
        if (!name) return;
        try {
          await Api.createSkill(name);
          toast("Skill added", "success");
          loadSkillsPage();
        } catch (err) {
          toast(err.message, "error");
        }
      });

      document.getElementById("tagSkillBtn")?.addEventListener("click", async () => {
        try {
          await Api.setWorkerSkill(
            document.getElementById("tagWorker").value,
            Number(document.getElementById("tagSkill").value),
            Number(document.getElementById("tagLevel").value) || 3
          );
          toast("Worker skill saved", "success");
        } catch (err) {
          toast(err.message, "error");
        }
      });

      async function refreshReqs() {
        const siteId = document.getElementById("reqSite")?.value;
        const list = document.getElementById("reqList");
        if (!siteId || !list) return;
        try {
          const rows = await Api.getSiteRequirements(siteId);
          list.innerHTML = rows.length
            ? `<table><thead><tr><th>Skill</th><th>Needed</th><th>Available</th><th></th></tr></thead><tbody>` +
              rows
                .map(
                  (r) => `<tr>
                <td>${escapeHtml(r.skill_name)}</td>
                <td class="mono">${r.workers_needed}</td>
                <td class="mono" style="color:${r.workers_available < r.workers_needed ? "var(--red)" : "var(--green)"}">${r.workers_available}</td>
                <td><button class="secondary-button" style="margin:0;color:var(--red);" data-rm-req="${r.skill_id}">Remove</button></td>
              </tr>`
                )
                .join("") +
              `</tbody></table>`
            : '<div class="empty-note">No requirements for this site.</div>';
          list.querySelectorAll("[data-rm-req]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              try {
                await Api.removeSiteRequirement(siteId, btn.dataset.rmReq);
                toast("Requirement removed", "success");
                refreshReqs();
              } catch (err) {
                toast(err.message, "error");
              }
            });
          });
        } catch (err) {
          list.innerHTML = `<div class="empty-note">${err.message}</div>`;
        }
      }

      document.getElementById("reqSite")?.addEventListener("change", refreshReqs);
      document.getElementById("reqSaveBtn")?.addEventListener("click", async () => {
        try {
          await Api.setSiteRequirement(
            document.getElementById("reqSite").value,
            Number(document.getElementById("reqSkill").value),
            Number(document.getElementById("reqNeeded").value) || 1
          );
          toast("Requirement saved", "success");
          refreshReqs();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      refreshReqs();
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${err.message}</div>`;
    }
  };

  // ---------- WORKER EDIT / DEACTIVATE in drawer ----------
  window.injectWorkerActions = function (userId, user) {
    const panel = document.getElementById("tab-overview");
    if (!panel || panel.querySelector("[data-worker-actions]")) return;
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
          <button id="saveWorkerBtn" style="border:none;background:var(--blue);color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;">Save profile</button>
          <button id="deactivateWorkerBtn" style="border:1px solid #f3c9c9;background:#fff;color:var(--red);border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;">${user.active === false ? "Reactivate" : "Deactivate account"}</button>
        </div>
      </div>`;
    panel.appendChild(box);

    document.getElementById("saveWorkerBtn")?.addEventListener("click", async () => {
      try {
        await Api.updateUser(userId, {
          fullName: document.getElementById("editFullName").value.trim(),
          phone: document.getElementById("editPhone").value.trim(),
        });
        toast("Worker updated", "success");
        state.team = null;
      } catch (err) {
        toast(err.message, "error");
      }
    });

    document.getElementById("deactivateWorkerBtn")?.addEventListener("click", async () => {
      const nextActive = user.active === false;
      if (!nextActive && !confirm("Deactivate this worker? They won't be able to log in.")) return;
      try {
        await Api.updateUser(userId, { active: nextActive });
        toast(nextActive ? "Worker reactivated" : "Worker deactivated", "success");
        state.team = null;
        if (typeof loadTeam === "function") loadTeam();
        closeDrawer();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  };

  // Hook openWorkerDrawer to inject actions
  const origOpen = window.openWorkerDrawer;
  if (typeof origOpen === "function") {
    window.openWorkerDrawer = async function (userId) {
      await origOpen(userId);
      try {
        const summary = await Api.workerSummary(userId);
        injectWorkerActions(userId, summary.user);
      } catch (_) {}
    };
  }

  // Hook showPage for sites/skills
  const origShow = window.showPage;
  if (typeof origShow === "function") {
    window.showPage = function (name) {
      origShow(name);
      if (name === "sites") loadSitesPage();
      if (name === "skills") loadSkillsPage();
      if (name === "anomalies") loadAnomaliesFull();
    };
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }
})();
