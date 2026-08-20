require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const pool = require("./db");

// Applies schema.sql (all CREATE TABLE IF NOT EXISTS / safe ALTERs) and
// seeds the first admin if none exists yet. Safe to call on every server
// startup - nothing here destroys or overwrites existing data, so it can
// run automatically on every deploy instead of needing a manual command.
async function applyMigrations() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("[migrate] Applying schema...");
  await pool.query(schema);
  console.log("[migrate] Schema applied.");

  // CREATE TABLE IF NOT EXISTS in schema.sql won't add columns to a table
  // that's already there - this covers upgrading an existing deployment.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0"
  );
  console.log("[migrate] Ensured token_version column exists.");

  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length === 0) {
    const username = process.env.SEED_ADMIN_USERNAME;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!username || !password) {
      console.log(
        "[migrate] No admin exists yet, and SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD are not set - skipping admin seed."
      );
    } else {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')",
        [username, hash, "Admin"]
      );
      console.log(`[migrate] Seeded admin account: ${username}`);
    }
  } else {
    console.log("[migrate] Admin account already exists - skipping seed.");
  }
}

// Only run as a standalone CLI script (`node src/migrate.js`) if invoked
// directly - when imported by server.js on startup, the caller owns the
// pool's lifecycle instead.
if (require.main === module) {
  applyMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { applyMigrations };
