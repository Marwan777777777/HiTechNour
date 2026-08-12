const jwt = require("jsonwebtoken");
const pool = require("../db");

// Verifies the JWT AND re-checks the user's active status in the DB on
// every request. This closes the "fired employee keeps working for up to
// 12 hours because their token is still valid" gap - a stale token alone
// is not enough, the account must still be active right now.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }
  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT active, role, token_version FROM users WHERE id = $1",
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: "Account disabled or invalid session." });
    }
    // Tokens are long-lived (365d) so daily re-login isn't needed. Bumping
    // token_version (e.g. on a lost-phone force-logout) invalidates every
    // token issued before the bump, instantly, without touching `active`.
    if (payload.tokenVersion !== user.token_version) {
      return res.status(401).json({ error: "Session no longer valid. Please sign in again." });
    }
    // Trust the DB's current role, not whatever was baked into an old token.
    req.user = { id: payload.id, username: payload.username, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
