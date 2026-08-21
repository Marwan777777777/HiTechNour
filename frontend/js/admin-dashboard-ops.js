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

  // RESTORED - full file continues via second push if truncated
  console.warn('admin-dashboard-ops partial - will complete');
})();
