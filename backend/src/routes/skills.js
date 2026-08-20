const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isNonEmptyString } = require("../utils/validate");

const router = express.Router();

function isValidLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= 5;
}

// ---- Skill catalog ----

// Anyone logged in can see the list of skill tags (needed to render labels).
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, name FROM skills ORDER BY name");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "name is required." });
    }
    const { rows } = await pool.query(
      `INSERT INTO skills (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---- Which workers have a given skill (the "click Software, see everyone
// good at it" view) - sorted best-first. ----
router.get("/:id/workers", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.phone, u.active, ws.level, ws.notes
       FROM worker_skills ws
       JOIN users u ON u.id = ws.user_id
       WHERE ws.skill_id = $1
       ORDER BY ws.level DESC, u.full_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---- Worker <-> skill tagging ----

router.post("/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { skillId, level, notes } = req.body;
    const lvl = level === undefined ? 3 : Number(level);
    if (!skillId || !isValidLevel(lvl)) {
      return res.status(400).json({ error: "skillId is required and level must be 1-5." });
    }
    const { rows } = await pool.query(
      `INSERT INTO worker_skills (user_id, skill_id, level, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, skill_id) DO UPDATE SET level = EXCLUDED.level, notes = EXCLUDED.notes
       RETURNING user_id, skill_id, level, notes`,
      [req.params.userId, skillId, lvl, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:userId/:skillId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM worker_skills WHERE user_id = $1 AND skill_id = $2", [
      req.params.userId,
      req.params.skillId,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Site skill requirements ----

// What a site needs, plus how many workers currently qualify for each
// requirement - so the admin instantly sees a shortfall (e.g. "needs 3,
// only 1 available").
router.get("/sites/:siteId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.skill_id, s.name AS skill_name, r.workers_needed,
              (SELECT COUNT(*) FROM worker_skills ws WHERE ws.skill_id = r.skill_id) AS workers_available
       FROM site_skill_requirements r
       JOIN skills s ON s.id = r.skill_id
       WHERE r.site_id = $1
       ORDER BY s.name`,
      [req.params.siteId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/sites/:siteId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { skillId, workersNeeded } = req.body;
    const needed = workersNeeded === undefined ? 1 : Number(workersNeeded);
    if (!skillId || !Number.isInteger(needed) || needed < 1) {
      return res.status(400).json({ error: "skillId is required and workersNeeded must be a positive integer." });
    }
    const { rows } = await pool.query(
      `INSERT INTO site_skill_requirements (site_id, skill_id, workers_needed)
       VALUES ($1, $2, $3)
       ON CONFLICT (site_id, skill_id) DO UPDATE SET workers_needed = EXCLUDED.workers_needed
       RETURNING site_id, skill_id, workers_needed`,
      [req.params.siteId, skillId, needed]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/sites/:siteId/:skillId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM site_skill_requirements WHERE site_id = $1 AND skill_id = $2", [
      req.params.siteId,
      req.params.skillId,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
