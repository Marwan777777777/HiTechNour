const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isNonEmptyString } = require("../utils/validate");

const router = express.Router();

function isValidDateString(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

async function notifyWorker(userId, title, body, kind = "assignment") {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
      [userId, title, body, kind]
    );
  } catch (_) {}
}

async function logActivity(userId, kind, detail = "") {
  try {
    await pool.query(`INSERT INTO activity_logs (user_id, kind, detail) VALUES ($1, $2, $3)`, [userId, kind, detail]);
  } catch (_) {}
}

router.get("/me/today", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.site_id, s.name AS site_name, s.lat, s.lng, s.radius_meters,
              a.task, a.start_date, a.end_date
       FROM assignments a JOIN sites s ON s.id = a.site_id
       WHERE a.user_id = $1 AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
       ORDER BY a.start_date`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.site_id, s.name AS site_name, a.task, a.start_date, a.end_date
       FROM assignments a JOIN sites s ON s.id = a.site_id
       WHERE a.user_id = $1 ORDER BY a.start_date DESC LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const date = isValidDateString(req.query.date) ? req.query.date : null;
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.full_name, u.username, a.site_id, s.name AS site_name,
              a.task, a.start_date, a.end_date
       FROM assignments a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id
       ${date ? "WHERE $1::date BETWEEN a.start_date AND a.end_date" : ""}
       ORDER BY a.start_date DESC, u.full_name LIMIT 500`,
      date ? [date] : []
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId, siteId, task, startDate, endDate } = req.body;
    if (!userId || !siteId || !isValidDateString(startDate)) {
      return res.status(400).json({ error: "userId, siteId, and a valid startDate are required." });
    }
    const finalEndDate = isValidDateString(endDate) ? endDate : startDate;
    if (finalEndDate < startDate) return res.status(400).json({ error: "endDate can't be before startDate." });
    if (task !== undefined && task !== null && !isNonEmptyString(task, 500)) {
      return res.status(400).json({ error: "task must be text under 500 characters." });
    }

    const { rows } = await pool.query(
      `INSERT INTO assignments (user_id, site_id, task, start_date, end_date, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, site_id, task, start_date, end_date`,
      [userId, siteId, task || null, startDate, finalEndDate, req.user.id]
    );

    const site = await pool.query("SELECT name FROM sites WHERE id = $1", [siteId]);
    const siteName = site.rows[0]?.name || "a site";
    const taskLabel = task ? ` · ${task}` : "";
    await notifyWorker(
      userId,
      "New assignment",
      `You are assigned to ${siteName} (${startDate}${finalEndDate !== startDate ? " → " + finalEndDate : ""})${taskLabel}`
    );
    await logActivity(req.user.id, "assignment_create", `Assigned user ${userId} to ${siteName}`);

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { siteId, task, startDate, endDate } = req.body;
    if (startDate !== undefined && !isValidDateString(startDate)) return res.status(400).json({ error: "startDate must be YYYY-MM-DD." });
    if (endDate !== undefined && !isValidDateString(endDate)) return res.status(400).json({ error: "endDate must be YYYY-MM-DD." });

    const existing = await pool.query(
      `SELECT a.id, a.user_id, a.site_id, a.task, a.start_date, a.end_date, s.name AS site_name
       FROM assignments a JOIN sites s ON s.id = a.site_id WHERE a.id = $1`,
      [req.params.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Assignment not found." });
    const old = existing.rows[0];

    const nextSiteId = siteId !== undefined ? siteId : old.site_id;
    const nextTask = task !== undefined ? (task === null ? null : String(task).trim()) : old.task;
    const nextStart = startDate !== undefined ? startDate : old.start_date;
    const nextEnd = endDate !== undefined ? endDate : old.end_date;
    if (nextTask !== null && !isNonEmptyString(nextTask, 500)) return res.status(400).json({ error: "task must be text under 500 characters." });
    if (nextEnd < nextStart) return res.status(400).json({ error: "endDate can't be before startDate." });

    const { rows } = await pool.query(
      `UPDATE assignments SET site_id = $1, task = $2, start_date = $3, end_date = $4
       WHERE id = $5 RETURNING id, user_id, site_id, task, start_date, end_date`,
      [nextSiteId, nextTask, nextStart, nextEnd, req.params.id]
    );

    const site = await pool.query("SELECT name FROM sites WHERE id = $1", [nextSiteId]);
    const siteName = site.rows[0]?.name || "a site";
    await notifyWorker(
      old.user_id,
      "Assignment updated",
      `Your assignment changed to ${siteName} (${nextStart}${nextEnd !== nextStart ? " → " + nextEnd : ""})${nextTask ? " · " + nextTask : ""}`
    );
    await logActivity(req.user.id, "assignment_update", `Updated assignment ${req.params.id}`);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT a.id, a.user_id, s.name AS site_name FROM assignments a JOIN sites s ON s.id = a.site_id WHERE a.id = $1`,
      [req.params.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Assignment not found." });

    await pool.query("DELETE FROM assignments WHERE id = $1", [req.params.id]);
    await notifyWorker(existing.rows[0].user_id, "Assignment removed", `Your assignment at ${existing.rows[0].site_name} was removed.`, "assignment_removed");
    await logActivity(req.user.id, "assignment_delete", `Removed assignment ${req.params.id}`);
    res.json({ message: "Assignment removed." });
  } catch (err) { next(err); }
});

module.exports = router;
