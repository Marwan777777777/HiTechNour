const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { checkinLimiter } = require("../middleware/rateLimit");
const { processCheckin } = require("../services/checkinService");
const { getMonthlyAttendance } = require("../utils/attendance");

const router = express.Router();

async function notifyAdmins(title, body, kind) {
  try {
    const { rows: admins } = await pool.query(
      `SELECT id FROM users WHERE role = 'admin' AND active = true`
    );
    for (const a of admins) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
        [a.id, title, body, kind]
      );
    }
  } catch (_) {
    // Never fail an already-committed attendance event because notification delivery failed.
  }
}

router.post("/", requireAuth, checkinLimiter, async (req, res, next) => {
  try {
    const result = await processCheckin(pool, req.user.id, req.body);
    const row = result.row;

    // Duplicate/idempotent retries return the original event without creating
    // another notification or changing attendance state.
    if (!result.duplicate) {
      const workerName = result.user.full_name || result.user.username;
      const action = row.type === "check_out" ? "checked out" : "checked in";
      const flagNote = row.flagged
        ? ` · FLAG: ${(row.flag_reason || "").replace(/_/g, " ")}`
        : "";
      await notifyAdmins(
        `${workerName} ${action}`,
        `${result.siteName} · ${row.status}${flagNote}`,
        row.flagged ? "flag" : "checkin"
      );
    }

    res.status(result.duplicate ? 200 : 201).json(row);
  } catch (err) {
    if (err.status) {
      const body = { error: err.message };
      if (err.pending) body.pending = true;
      if (err.code) body.code = err.code;
      return res.status(err.status).json(body);
    }
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, site_id, type, lat, lng, distance_meters, status, flagged, flag_reason, created_at
       FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    const isCheckedIn = rows[0]?.type === "check_in";
    res.json({ isCheckedIn, history: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/me/summary", requireAuth, async (req, res, next) => {
  try {
    const summary = await getMonthlyAttendance(req.user.id, req.query.month);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const flaggedOnly = req.query.flagged === "true";
    const { rows } = await pool.query(
      `SELECT c.id, c.user_id, u.full_name, u.username, s.name AS site_name, c.type, c.lat, c.lng,
              c.distance_meters, c.status, c.device_matched, c.is_mock_location, c.is_off_hours,
              c.flagged, c.flag_reason, c.reviewed, c.created_at
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       JOIN sites s ON s.id = c.site_id
       ${flaggedOnly ? "WHERE c.flagged = true AND c.reviewed = false" : ""}
       ORDER BY c.created_at DESC
       LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/review", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE checkins SET reviewed = true, reviewed_by = $1, reviewed_at = now()
       WHERE id = $2 RETURNING id, reviewed, reviewed_at`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Check-in not found." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get("/export", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate query params are required (YYYY-MM-DD)." });
    }
    const { rows } = await pool.query(
      `SELECT u.full_name, u.username, s.name AS site, c.type, c.status,
              c.distance_meters, c.flagged, c.flag_reason, c.created_at
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.created_at >= $1::date
         AND c.created_at < ($2::date + INTERVAL '1 day')
       ORDER BY c.created_at DESC`,
      [startDate, endDate]
    );

    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    let csv = "Full Name,Username,Site,Type,Status,Distance (m),Flagged,Flag Reason,Timestamp\n";
    for (const r of rows) {
      csv +=
        [
          escapeCsv(r.full_name),
          escapeCsv(r.username),
          escapeCsv(r.site),
          escapeCsv(r.type),
          escapeCsv(r.status),
          r.distance_meters,
          r.flagged,
          escapeCsv(r.flag_reason),
          escapeCsv(r.created_at.toISOString()),
        ].join(",") + "\n";
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="HTN_Attendance_Report.csv"');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
