const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isNonEmptyString } = require("../utils/validate");
const { getMonthlyAttendance, resolveMonth, getDailyHours } = require("../utils/attendance");

const router = express.Router();

async function logActivity(userId, kind, detail = "") {
  try {
    await pool.query(
      `INSERT INTO activity_logs (user_id, kind, detail) VALUES ($1, $2, $3)`,
      [userId, kind, detail]
    );
  } catch (_) {}
}

// Admin: list users. By default only active employees+admins.
router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
    const role = req.query.role;
    const clauses = [];
    const params = [];
    if (!includeInactive) clauses.push("active = true");
    if (role === "employee" || role === "admin") {
      params.push(role);
      clauses.push(`role = $${params.length}`);
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, username, full_name, phone, role, title, active, locale,
              device_id IS NOT NULL AS device_approved,
              pending_device_id IS NOT NULL AND device_id IS NULL AS device_pending,
              device_bound_at, created_at
       FROM users ${where} ORDER BY full_name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Worker: update own profile.
router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const { fullName, phone, locale } = req.body;
    if (fullName !== undefined && !isNonEmptyString(fullName, 120)) {
      return res.status(400).json({ error: "Full name is required and must be under 120 characters." });
    }
    if (phone !== undefined && phone !== null && typeof phone !== "string") {
      return res.status(400).json({ error: "Phone must be text." });
    }
    if (locale !== undefined && locale !== "ar" && locale !== "en") {
      return res.status(400).json({ error: "locale must be 'en' or 'ar'." });
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         locale = COALESCE($3, locale)
       WHERE id = $4
       RETURNING id, username, full_name, phone, role, locale, active`,
      [
        fullName !== undefined ? fullName.trim() : null,
        phone !== undefined ? phone.trim() : null,
        locale || null,
        req.user.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await logActivity(req.user.id, "profile_update", "Updated profile");
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Worker: change own password. Revokes every existing token, including the
// current one; the client should sign in again after a successful change.
router.post("/me/password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!isNonEmptyString(currentPassword, 200) || !isNonEmptyString(newPassword, 200)) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must be different from the current password." });
    }

    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1 AND active = true",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });

    const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!matches) return res.status(401).json({ error: "Current password is incorrect." });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
      [hash, req.user.id]
    );
    await logActivity(req.user.id, "password_change", "Changed password and revoked existing sessions");
    res.json({ ok: true, message: "Password changed. Please sign in again." });
  } catch (err) {
    next(err);
  }
});

// Worker: privacy-preserving account deletion. Attendance/audit history is
// retained for company records, while personal identity and access are
// erased/revoked. This avoids breaking foreign-key history.
router.delete("/me", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id, username, role, full_name FROM users WHERE id = $1 AND active = true FOR UPDATE",
      [req.user.id]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Account not found or already deleted." });
    }

    if (rows[0].role === "admin") {
      const count = await client.query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND active = true");
      if (count.rows[0].c <= 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Cannot delete the last admin account." });
      }
    }

    const oldName = rows[0].full_name;
    const deletedUsername = `deleted_${rows[0].id}_${Date.now()}`;
    await client.query("DELETE FROM worker_skills WHERE user_id = $1", [req.user.id]);
    await client.query("DELETE FROM assignments WHERE user_id = $1", [req.user.id]);
    await client.query("DELETE FROM notifications WHERE user_id = $1", [req.user.id]);
    await client.query(
      `UPDATE users SET
         username = $1,
         password_hash = $2,
         full_name = 'Deleted user',
         phone = NULL,
         role = 'employee',
         device_id = NULL,
         pending_device_id = NULL,
         device_bound_at = NULL,
         active = false,
         token_version = token_version + 1
       WHERE id = $3`,
      [deletedUsername, await bcrypt.hash(cryptoRandomSecret(), 12), req.user.id]
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, kind, detail) VALUES ($1, $2, $3)`,
      [req.user.id, "account_deleted", `Account deleted (${oldName || "user"})`]
    );
    await client.query("COMMIT");
    res.json({ ok: true, message: "Account deleted and access revoked." });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

function cryptoRandomSecret() {
  return `${Date.now()}-${Math.random()}-${Math.random()}-${Math.random()}`;
}

// Admin: hard-delete a user is intentionally retained for cleaning test
// accounts. Production users should normally be deactivated instead.
router.delete("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: "You cannot delete your own account from here." });
    const target = await pool.query("SELECT id, role, username FROM users WHERE id = $1", [targetId]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found." });
    if (target.rows[0].role === "admin") {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND active = true`);
      if (rows[0].c <= 1) return res.status(400).json({ error: "Cannot delete the last admin account." });
    }
    await pool.query("DELETE FROM worker_skills WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM assignments WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM notifications WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM users WHERE id = $1", [targetId]);
    await logActivity(req.user.id, "admin_delete_user", `Deleted ${target.rows[0].username}`);
    res.json({ ok: true, message: `Deleted ${target.rows[0].username}.` });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/summary", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      "SELECT id, username, full_name, phone, role, title, active, created_at FROM users WHERE id = $1",
      [req.params.id]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });

    const attendance = await getMonthlyAttendance(req.params.id, req.query.month);
    const { start, end } = resolveMonth(req.query.month);

    const tasksResult = await pool.query(
      `SELECT a.id, a.site_id, s.name AS site_name, a.task, a.start_date, a.end_date
       FROM assignments a JOIN sites s ON s.id = a.site_id
       WHERE a.user_id = $1 AND a.start_date < $3 AND a.end_date >= $2
       ORDER BY a.start_date`,
      [req.params.id, start, end]
    );

    const teamResult = await pool.query(
      `SELECT DISTINCT u.id, u.full_name, u.username, s.name AS site_name
       FROM assignments a
       JOIN assignments mine ON mine.site_id = a.site_id
         AND mine.user_id = $1
         AND a.start_date <= mine.end_date AND a.end_date >= mine.start_date
       JOIN users u ON u.id = a.user_id
       JOIN sites s ON s.id = a.site_id
       WHERE a.user_id != $1 AND a.start_date < $3 AND a.end_date >= $2
       ORDER BY u.full_name`,
      [req.params.id, start, end]
    );

    const skillsResult = await pool.query(
      `SELECT s.id AS skill_id, s.name, ws.level, ws.notes
       FROM worker_skills ws JOIN skills s ON s.id = ws.skill_id
       WHERE ws.user_id = $1 ORDER BY ws.level DESC, s.name`,
      [req.params.id]
    );

    res.json({
      user: { id: user.id, username: user.username, fullName: user.full_name, phone: user.phone, role: user.role, title: user.title, active: user.active },
      attendance,
      tasks: tasksResult.rows,
      teammates: teamResult.rows,
      skills: skillsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/daily", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const breakdown = await getDailyHours(req.params.id, req.query.month);
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, fullName, phone, role } = req.body;
    if (!isNonEmptyString(username) || !isNonEmptyString(password, 100) || !isNonEmptyString(fullName)) {
      return res.status(400).json({ error: "username, password, and fullName are required." });
    }
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const finalRole = role === "admin" ? "admin" : "employee";
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username.trim()]);
    if (existing.rows[0]) return res.status(409).json({ error: "That username is already taken." });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, phone, role, active, created_at`,
      [username.trim(), hash, fullName.trim(), phone || null, finalRole]
    );
    await logActivity(req.user.id, "admin_create_user", `Created ${username.trim()}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { fullName, phone, active, role, title } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($1, full_name), phone = COALESCE($2, phone),
         active = COALESCE($3, active), role = COALESCE($4, role), title = COALESCE($5, title)
       WHERE id = $6
       RETURNING id, username, full_name, phone, role, title, active`,
      [fullName || null, phone || null, active === undefined ? null : !!active, role || null, title === undefined ? null : title, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await logActivity(req.user.id, "admin_update_user", `Updated user ${req.params.id}`);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve-device", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET device_id = pending_device_id, pending_device_id = NULL, device_bound_at = now()
       WHERE id = $1 AND pending_device_id IS NOT NULL
       RETURNING id, username, device_id, device_bound_at`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(400).json({ error: "No pending device to approve for this user." });
    await pool.query(`INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`, [req.params.id, "Device approved", "You can now check in from this phone.", "device"]);
    await logActivity(req.user.id, "device_approve", `Approved device for ${rows[0].username}`);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post("/:id/reset-device", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET device_id = NULL, pending_device_id = NULL, device_bound_at = NULL WHERE id = $1 RETURNING id, username`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await logActivity(req.user.id, "device_reset", `Reset device for ${rows[0].username}`);
    res.json({ message: `Device binding cleared for ${rows[0].username}.` });
  } catch (err) { next(err); }
});

router.post("/:id/force-logout", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING id, username",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await logActivity(req.user.id, "force_logout", `Signed out ${rows[0].username}`);
    res.json({ message: `${rows[0].username} has been signed out on all devices.` });
  } catch (err) { next(err); }
});

router.post("/:id/reset-password", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!isNonEmptyString(newPassword, 100) || newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters." });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const { rows } = await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, username",
      [hash, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await logActivity(req.user.id, "admin_password_reset", `Reset password for ${rows[0].username}`);
    res.json({ message: `Password reset for ${rows[0].username}. Existing sessions were revoked.` });
  } catch (err) { next(err); }
});

module.exports = router;
