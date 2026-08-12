const rateLimit = require("express-rate-limit");

// Brute-force protection on login: 10 attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes and try again." },
});

// Check-in/out spam protection: 20 requests per 10 minutes per logged-in user.
// Must run AFTER requireAuth so req.user exists.
const checkinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user.id) : req.ip),
  message: { error: "Too many check-in attempts. Please slow down." },
});

module.exports = { loginLimiter, checkinLimiter };
