require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const pool = require("./db");

// Applies schema.sql and safe upgrades. Safe to call on every deployment.
async function applyMigrations() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("[migrate] Applying schema...");
  await pool.query(schema);
  console.log("[migrate] Schema applied.");

  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0"
  );
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT");
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'"
  );

  // Existing deployments may already have checkins rows created before
  // idempotency was introduced. Give those historical rows deterministic IDs,
  // then enforce the invariant for all future rows.
  await pool.query(
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS client_event_id UUID"
  );
  await pool.query(`
    UPDATE checkins
    SET client_event_id = md5(
      id::text || ':' || user_id::text || ':' || created_at::text
    )::uuid
    WHERE client_event_id IS NULL
  `);
  await pool.query(
    "ALTER TABLE checkins ALTER COLUMN client_event_id SET NOT NULL"
  );
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_user_client_event
    ON checkins (user_id, client_event_id)
  `);
  console.log("[migrate] Ensured idempotent check-in event IDs.");

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

if (require.main === module) {
  applyMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { applyMigrations };
