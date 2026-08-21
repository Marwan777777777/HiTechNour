const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isNonEmptyString } = require("../utils/validate");

const router = express.Router();

// ---------- Helper: create a notification for one or more users ----------
async function notify(userIds, title, body, kind = "info") {
  if (!Array.isArray(userIds)) userIds = [userIds];
  for (const uid of userIds) {
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
      [uid, title, body, kind]
    );
  }
}

async function logActivity(userId, kind, detail = "") {
  await pool.query(
    `INSERT INTO activity_logs (user_id, kind, detail) VALUES ($1, $2, $3)`,
    [userId, kind, detail]
  );
}

// ---------- FIELD REPORTS ----------

// Worker: submit a field report
router.post("/reports", requireAuth, async (req, res, next) => {
  try {
    const { title, body, siteId } = req.body;
    if (!isNonEmptyString(title, 120) || !isNonEmptyString(body, 4000)) {
      return res.status(400).json({ error: "Title and body are required." });
    }
    const { rows } = await pool.query(
      `INSERT INTO reports (user_id, site_id, title, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, body, status, created_at`,
      [req.user.id, siteId || null, title.trim(), body.trim()]
    );
    await logActivity(req.user.id, "report", title.trim());

    // Notify all admins
    const { rows: admins } = await pool.query(
      `SELECT id FROM users WHERE role = 'admin' AND active = true`
    );
    const name = req.user.full_name || req.user.username;
    await notify(
      admins.map((a) => a.id),
      "New field report",
      `${name}: ${title.trim()}`,
      "report"
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Worker: my recent reports
router.get("/reports/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, body, status, site_id, created_at
       FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Admin: all reports (optionally only unreviewed)
router.get("/reports", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const onlyOpen = req.query.open === "true";
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.body, r.status, r.created_at,
              u.full_name, u.username, s.name AS site_name
       FROM reports r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN sites s ON s.id = r.site_id
       ${onlyOpen ? "WHERE r.status = 'submitted'" : ""}
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Admin: mark report reviewed
router.patch("/reports/:id/review", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE reports SET status = 'reviewed', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2 RETURNING id, status, reviewed_at`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Report not found." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------- SURVEYS ----------

// Worker: list active surveys + whether I already answered
router.get("/surveys", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.body,
              EXISTS (
                SELECT 1 FROM survey_answers a
                WHERE a.survey_id = s.id AND a.user_id = $1
              ) AS answered
       FROM surveys s
       WHERE s.active = true
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Worker: answer a survey
router.post("/surveys/:id/answer", requireAuth, async (req, res, next) => {
  try {
    const answer = (req.body.answer || "").trim();
    if (!answer || answer.length > 2000) {
      return res.status(400).json({ error: "Answer is required (max 2000 chars)." });
    }
    await pool.query(
      `INSERT INTO survey_answers (survey_id, user_id, answer)
       VALUES ($1, $2, $3)
       ON CONFLICT (survey_id, user_id) DO UPDATE SET answer = EXCLUDED.answer`,
      [req.params.id, req.user.id, answer]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Admin: create survey
router.post("/surveys", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, body } = req.body;
    if (!isNonEmptyString(title, 200) || !isNonEmptyString(body, 2000)) {
      return res.status(400).json({ error: "Title and body are required." });
    }
    const { rows } = await pool.query(
      `INSERT INTO surveys (title, body, created_by)
       VALUES ($1, $2, $3) RETURNING id, title, body, active, created_at`,
      [title.trim(), body.trim(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------- ANNOUNCEMENTS ----------

router.get("/announcements", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, body, created_at
       FROM announcements ORDER BY created_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/announcements", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, body } = req.body;
    if (!isNonEmptyString(title, 200) || !isNonEmptyString(body, 4000)) {
      return res.status(400).json({ error: "Title and body are required." });
    }
    const { rows } = await pool.query(
      `INSERT INTO announcements (title, body, created_by)
       VALUES ($1, $2, $3) RETURNING id, title, body, created_at`,
      [title.trim(), body.trim(), req.user.id]
    );

    // Notify everyone
    const { rows: all } = await pool.query(`SELECT id FROM users WHERE active = true`);
    await notify(
      all.map((u) => u.id),
      title.trim(),
      body.trim().slice(0, 200),
      "announcement"
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------- NOTIFICATIONS ----------

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, body, kind, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/notifications/read", requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- ACTIVITY LOG (admin) ----------

router.get("/activity", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.full_name, a.kind, a.detail, a.created_at
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
