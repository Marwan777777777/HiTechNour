require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const pool = require("./db");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("Applying schema...");
  await pool.query(schema);
  console.log("Schema applied.");

  // CREATE TABLE IF NOT EXISTS in schema.sql won't add columns to a table
  // that's already there - this covers upgrading an existing deployment.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0"
  );
  console.log("Ensured token_version column exists.");

  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length === 0) {
    const username = process.env.SEED_ADMIN_USERNAME;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!username || !password) {
      console.log(
        "No admin exists yet, and SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD are not set - skipping admin seed."
      );
    } else {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')",
        [username, hash, "Admin"]
      );
      console.log(`Seeded admin account: ${username}`);
    }
  } else {
    console.log("Admin account already exists - skipping seed.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
