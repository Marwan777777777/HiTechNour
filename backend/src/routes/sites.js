const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isValidLat, isValidLng, isValidRadius, isNonEmptyString } = require("../utils/validate");

const router = express.Router();

// Any logged-in user can list active sites (needed to check in/out).
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, address, lat, lng, radius_meters FROM sites WHERE active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, address, lat, lng, radiusMeters } = req.body;
    if (!isNonEmptyString(name) || !isValidLat(lat) || !isValidLng(lng)) {
      return res.status(400).json({ error: "name, lat, and lng are required and must be valid." });
    }
    const radius = radiusMeters === undefined ? 200 : radiusMeters;
    if (!isValidRadius(radius)) {
      return res.status(400).json({ error: "radiusMeters must be a number between 1 and 5000." });
    }

    const { rows } = await pool.query(
      `INSERT INTO sites (name, address, lat, lng, radius_meters)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, address, lat, lng, radius_meters`,
      [name.trim(), address || null, lat, lng, radius]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, address, lat, lng, radiusMeters, active } = req.body;

    if (lat !== undefined && lat !== null && !isValidLat(lat)) {
      return res.status(400).json({ error: "lat must be a valid latitude." });
    }
    if (lng !== undefined && lng !== null && !isValidLng(lng)) {
      return res.status(400).json({ error: "lng must be a valid longitude." });
    }
    if (radiusMeters !== undefined && radiusMeters !== null && !isValidRadius(radiusMeters)) {
      return res.status(400).json({ error: "radiusMeters must be a number between 1 and 5000." });
    }

    const { rows } = await pool.query(
      `UPDATE sites SET
         name = COALESCE($1, name),
         address = COALESCE($2, address),
         lat = COALESCE($3, lat),
         lng = COALESCE($4, lng),
         radius_meters = COALESCE($5, radius_meters),
         active = COALESCE($6, active)
       WHERE id = $7
       RETURNING id, name, address, lat, lng, radius_meters, active`,
      [name || null, address || null, lat ?? null, lng ?? null, radiusMeters ?? null, active === undefined ? null : !!active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Site not found." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
