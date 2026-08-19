const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { checkinLimiter } = require("../middleware/rateLimit");
const { haversineMeters } = require("../utils/geo");
const { isImpossibleTravel } = require("../utils/impossibleTravel");
const { isValidLat, isValidLng, isNonEmptyString } = require("../utils/validate");
const { getMonthlyAttendance } = require("../utils/attendance");

const router = express.Router();

const BLOCK_ON_DEVICE_MISMATCH = process.env.BLOCK_ON_DEVICE_MISMATCH !== "false";
const WORK_HOURS_START = Number(process.env.WORK_HOURS_START ?? 6);
const WORK_HOURS_END = Number(process.env.WORK_HOURS_END ?? 20);
const MAX_ACCEPTABLE_ACCURACY_METERS = Number(process.env.MAX_ACCEPTABLE_ACCURACY_METERS ?? 100);

function isOffHours(date) {
  const hour = date.getHours();
  return hour < WORK_HOURS_START || hour >= WORK_HOURS_END;
}

router.post("/", requireAuth, checkinLimiter, async (req, res, next) => {
  try {
    const { siteId, lat, lng, accuracyMeters, deviceId, isMockLocation, type } = req.body;

    // ---- Input validation ----
    if (!siteId || !isValidLat(lat) || !isValidLng(lng) || !isNonEmptyString(deviceId, 200)) {
      return res.status(400).json({ error: "siteId, valid lat/lng, and deviceId are required." });
    }
    const checkinType = type === "check_out" ? "check_out" : "check_in";
    if (accuracyMeters !== undefined && accuracyMeters !== null) {
      if (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
        return res.status(400).json({ error: "accuracyMeters must be a non-negative number." });
      }
    }

    const siteResult = await pool.query(
      "SELECT id, lat, lng, radius_meters FROM sites WHERE id = $1 AND active = true",
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) return res.status(404).json({ error: "Site not found." });

    const userResult = await pool.query(
      "SELECT id, device_id, pending_device_id FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = userResult.rows[0];

    // ---- Device binding (with admin-approval workflow) ----
    // No device bound yet: register this device as PENDING and require an
    // admin to approve it before any check-in is accepted. This is what
    // closes the race condition where anyone holding the password could
    // become the "trusted" device just by checking in first.
    let deviceMatched = true;
    if (!user.device_id) {
      if (!user.pending_device_id) {
        await pool.query("UPDATE users SET pending_device_id = $1 WHERE id = $2", [deviceId, user.id]);
      }
      return res.status(403).json({
        error:
          "This device is awaiting admin approval before it can be used for check-ins. Ask your admin to approve it.",
        pending: true,
      });
    } else if (user.device_id !== deviceId) {
      deviceMatched = false;
      if (BLOCK_ON_DEVICE_MISMATCH) {
        return res.status(403).json({
          error:
            "This device isn't the one approved for your account. Ask an admin to reset your device binding if you're on a new phone.",
        });
      }
    }

    // ---- Distance - computed server-side, the client's opinion is ignored ----
    const distance = haversineMeters(lat, lng, site.lat, site.lng);
    const status = distance <= site.radius_meters ? "inside" : "outside";

    // ---- Impossible travel check against this user's last event ----
    const prevResult = await pool.query(
      "SELECT lat, lng, created_at FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    const now = new Date();
    const impossibleTravel = isImpossibleTravel(prevResult.rows[0], lat, lng, now);
    const offHours = isOffHours(now);
    const lowAccuracy =
      accuracyMeters != null && accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS;

    // A check-out with no open check-in is worth a human glance, not a block.
    let checkoutWithoutCheckin = false;
    if (checkinType === "check_out") {
      const lastEventResult = await pool.query(
        "SELECT type FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [user.id]
      );
      const lastType = lastEventResult.rows[0]?.type;
      if (lastType !== "check_in") checkoutWithoutCheckin = true;
    }

    let flagged = false;
    let flagReason = null;
    if (!deviceMatched) {
      flagged = true;
      flagReason = "device_mismatch";
    } else if (isMockLocation) {
      flagged = true;
      flagReason = "mock_location";
    } else if (impossibleTravel) {
      flagged = true;
      flagReason = "impossible_travel";
    } else if (status === "outside") {
      flagged = true;
      flagReason = "outside_radius";
    } else if (lowAccuracy) {
      flagged = true;
      flagReason = "low_accuracy";
    } else if (checkoutWithoutCheckin) {
      flagged = true;
      flagReason = "checkout_without_checkin";
    } else if (offHours) {
      flagged = true;
      flagReason = "off_hours";
    }

    const inserted = await pool.query(
      `INSERT INTO checkins
        (user_id, site_id, type, lat, lng, accuracy_meters, distance_meters, status,
         device_id, device_matched, is_mock_location, is_off_hours, flagged, flag_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, type, distance_meters, status, flagged, flag_reason, created_at`,
      [
        user.id,
        siteId,
        checkinType,
        lat,
        lng,
        accuracyMeters ?? null,
        distance,
        status,
        deviceId,
        deviceMatched,
        !!isMockLocation,
        offHours,
        flagged,
        flagReason,
      ]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    next(err);
  }
});

// A user's own recent check-ins/outs, plus whether they currently have an
// open shift (last event was a check_in with no matching check_out yet).
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

// Worker: their own "days present this month" - the same number the admin
// sees on the worker-detail dashboard, so there's no room for it to look
// different depending on who's asking. ?month=YYYY-MM, defaults to current.
router.get("/me/summary", requireAuth, async (req, res, next) => {
  try {
    const summary = await getMonthlyAttendance(req.user.id, req.query.month);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Admin: full log, optionally filtered to flagged-and-unreviewed only
// (the actual review queue - reviewed items drop out automatically).
router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const flaggedOnly = req.query.flagged === "true";
    const { rows } = await pool.query(
      `SELECT c.id, u.full_name, u.username, s.name AS site_name, c.type, c.lat, c.lng,
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

// Admin: mark a flagged entry as reviewed so the queue doesn't grow forever.
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

// Admin: CSV export for a date range, e.g. for payroll.
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
       WHERE c.created_at BETWEEN $1 AND $2
       ORDER BY c.created_at DESC`,
      [startDate, endDate]
    );

    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    let csv = "Full Name,Username,Site,Type,Status,Distance (m),Flagged,Flag Reason,Timestamp\n";
    for (const r of rows) {
      csv += [
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
