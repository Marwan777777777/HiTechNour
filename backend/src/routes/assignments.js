const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isNonEmptyString } = require("../utils/validate");

const router = express.Router();

function isValidDateString(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

router.get("/me/today", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.site_id, s.name AS site_name, s.lat, s.lng, s.radius_meters,
              a.task, a.start_date, a.end_date
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
       WHERE a.user_id = $1 AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
       ORDER BY a.start_date`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.site_id, s.name AS site_name, a.task, a.start_date, a.end_date
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
       WHERE a.user_id = $1
       ORDER BY a.start_date DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const date = isValidDateString(req.query.date) ? req.query.date : null;
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.full_name, u.username, a.site_id, s.name AS site_name,
              a.task, a.start_date, a.end_date
       FROM assignments a
       JOIN users u ON u.id = a.user_id
       JOIN sites s ON s.id = a.site_id
       ${date ? "WHERE $1::date BETWEEN a.start_date AND a.end_date" : ""}
       ORDER BY a.start_date DESC, u.full_name
       LIMIT 500`,
      date ? [date] : []
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId, siteId, task, startDate, endDate } = req.body;
    if (!userId || !siteId || !isValidDateString(startDate)) {
      return res.status(400).json({ error: "userId, siteId, and a valid startDate are required." });
    }
    const finalEndDate = isValidDateString(endDate) ? endDate : startDate;
    if (finalEndDate < startDate) {
      return res.status(400).json({ error: "endDate can't be before startDate." });
    }
    if (task !== undefined && task !== null && !isNonEmptyString(task, 500)) {
      return res.status(400).json({ error: "task must be text under 500 characters." });
    }

    const { rows } = await pool.query(
      `INSERT INTO assignments (user_id, site_id, task, start_date, end_date, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, site_id, task, start_date, end_date`,
      [userId, siteId, task || null, startDate, finalEndDate, req.user.id]
    );

    // Notify the worker about team / site assignment
    try {
      const site = await pool.query("SELECT name FROM sites WHERE id = $1", [siteId]);
      const siteName = site.rows[0]?.name || "a site";
      const taskLabel = task ? ` · ${task}` : "";
      await pool.query(
        `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
        [
          userId,
          "New assignment",
          `You are assigned to ${siteName} (${startDate}${finalEndDate !== startDate ? " → " + finalEndDate : ""})${taskLabel}`,
          "assignment",
        ]
      );
    } catch (_) {}

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { siteId, task, startDate, endDate } = req.body;
    if (startDate !== undefined && !isValidDateString(startDate)) {
      return res.status(400).json({ error: "startDate must be YYYY-MM-DD." });
    }
    if (endDate !== undefined && !isValidDateString(endDate)) {
      return res.status(400).json({ error: "endDate must be YYYY-MM-DD." });
    }

    const { rows } = await pool.query(
      `UPDATE assignments SET
         site_id    = COALESCE($1, site_id),
         task       = COALESCE($2, task),
         start_date = COALESCE($3, start_date),
         end_date   = COALESCE($4, end_date)
       WHERE id = $5
       RETURNING id, user_id, site_id, task, start_date, end_date`,
      [siteId || null, task ?? null, startDate || null, endDate || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Assignment not found." });
    if (rows[0].end_date < rows[0].start_date) {
      return res.status(400).json({ error: "endDate can't be before startDate." });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query("DELETE FROM assignments WHERE id = $1 RETURNING id", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Assignment not found." });
    res.json({ message: "Assignment removed." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
