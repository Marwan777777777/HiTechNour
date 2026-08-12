const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { loginLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const { rows } = await pool.query(
      "SELECT id, username, password_hash, full_name, role, active, token_version FROM users WHERE username = $1",
      [username.trim()]
    );
    const user = rows[0];

    // Same generic error whether the username doesn't exist or the password
    // is wrong - never leak which one it was.
    if (!user || !user.active) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    // Long-lived on purpose - workers shouldn't have to re-login daily.
    // Real revocation happens two ways: requireAuth re-checks `active` on
    // every request (disable = instant cutoff), and tokenVersion below lets
    // an admin force a specific device to log out without disabling the
    // account (e.g. lost phone) via POST /users/:id/force-logout.
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tokenVersion: user.token_version },
      process.env.JWT_SECRET,
      { expiresIn: "365d" }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// Lets the frontend confirm a stored token is still good on app open,
// without waiting for a check-in attempt to find out it's dead.
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, username, full_name, role, phone, device_id, pending_device_id FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    const u = rows[0];
    res.json({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      phone: u.phone,
      deviceApproved: !!u.device_id,
      devicePending: !!u.pending_device_id && !u.device_id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
