const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { applyMigrations } = require("../src/migrate");
const pool = require("../src/db");
const { processCheckin } = require("../src/services/checkinService");

const hasDatabase = Boolean(process.env.DATABASE_URL);

test("attendance concurrency regression suite requires TEST_DATABASE_URL", { skip: !process.env.TEST_DATABASE_URL }, () => {});

if (!process.env.TEST_DATABASE_URL) {
  test("placeholder", { skip: "Set TEST_DATABASE_URL to run PostgreSQL concurrency tests." }, () => {});
} else {
  test.before(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await applyMigrations();
  });

  test("50 identical concurrent requests create exactly one attendance event", async () => {
    const ctx = await createFixture("idem");
    try {
      const clientEventId = crypto.randomUUID();
      const payload = validPayload(ctx, "check_in", clientEventId);

      const results = await Promise.all(
        Array.from({ length: 50 }, () => processCheckin(pool, ctx.userId, payload))
      );

      const created = results.filter((result) => !result.duplicate);
      const duplicates = results.filter((result) => result.duplicate);
      assert.equal(created.length, 1);
      assert.equal(duplicates.length, 49);
      assert.equal(new Set(results.map((result) => result.row.id)).size, 1);

      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM checkins WHERE user_id = $1 AND client_event_id = $2",
        [ctx.userId, clientEventId]
      );
      assert.equal(rows[0].count, 1);
    } finally {
      await cleanupFixture(ctx);
    }
  });

  test("concurrent unique check-ins allow only one state transition", async () => {
    const ctx = await createFixture("transition");
    try {
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          processCheckin(pool, ctx.userId, validPayload(ctx, "check_in", crypto.randomUUID()))
            .then((result) => ({ ok: true, result }))
            .catch((error) => ({ ok: false, error }))
        )
      );

      const successes = results.filter((item) => item.ok);
      const conflicts = results.filter(
        (item) => !item.ok && item.error.code === "ALREADY_CHECKED_IN"
      );
      assert.equal(successes.length, 1);
      assert.equal(conflicts.length, 24);

      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM checkins WHERE user_id = $1",
        [ctx.userId]
      );
      assert.equal(rows[0].count, 1);
    } finally {
      await cleanupFixture(ctx);
    }
  });

  test("concurrent unique check-outs allow only one transition from checked-in", async () => {
    const ctx = await createFixture("checkout");
    try {
      await processCheckin(pool, ctx.userId, validPayload(ctx, "check_in", crypto.randomUUID()));

      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          processCheckin(pool, ctx.userId, validPayload(ctx, "check_out", crypto.randomUUID()))
            .then((result) => ({ ok: true, result }))
            .catch((error) => ({ ok: false, error }))
        )
      );

      const successes = results.filter((item) => item.ok);
      const conflicts = results.filter(
        (item) => !item.ok && item.error.code === "NOT_CHECKED_IN"
      );
      assert.equal(successes.length, 1);
      assert.equal(conflicts.length, 24);

      const { rows } = await pool.query(
        "SELECT type FROM checkins WHERE user_id = $1 ORDER BY created_at ASC, id ASC",
        [ctx.userId]
      );
      assert.deepEqual(rows.map((row) => row.type), ["check_in", "check_out"]);
    } finally {
      await cleanupFixture(ctx);
    }
  });

  test("retrying the same client event returns the original event without a second row", async () => {
    const ctx = await createFixture("retry");
    try {
      const payload = validPayload(ctx, "check_in", crypto.randomUUID());
      const first = await processCheckin(pool, ctx.userId, payload);
      const second = await processCheckin(pool, ctx.userId, payload);

      assert.equal(first.duplicate, false);
      assert.equal(second.duplicate, true);
      assert.equal(second.row.id, first.row.id);

      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM checkins WHERE user_id = $1",
        [ctx.userId]
      );
      assert.equal(rows[0].count, 1);
    } finally {
      await cleanupFixture(ctx);
    }
  });

  test("invalid attendance type and missing idempotency key are rejected", async () => {
    const ctx = await createFixture("validation");
    try {
      await assert.rejects(
        processCheckin(pool, ctx.userId, validPayload(ctx, "banana", crypto.randomUUID())),
        (error) => error.status === 400 && /type must be either/.test(error.message)
      );

      const payload = validPayload(ctx, "check_in", crypto.randomUUID());
      delete payload.clientEventId;
      await assert.rejects(
        processCheckin(pool, ctx.userId, payload),
        (error) => error.status === 400 && /clientEventId/.test(error.message)
      );
    } finally {
      await cleanupFixture(ctx);
    }
  });

  test.after(async () => {
    await pool.end();
  });
}

async function createFixture(label) {
  const suffix = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const user = await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role, device_id, active)
     VALUES ($1, $2, $3, 'employee', $4, true)
     RETURNING id`,
    [`test-${suffix}`, "test-only", `Concurrency Test ${label}`, `device-${suffix}`]
  );
  const site = await pool.query(
    `INSERT INTO sites (name, lat, lng, radius_meters, active)
     VALUES ($1, $2, $3, 500, true)
     RETURNING id`,
    [`Test Site ${suffix}`, 30.0561, 31.3395]
  );
  return {
    userId: user.rows[0].id,
    siteId: site.rows[0].id,
    deviceId: `device-${suffix}`,
  };
}

function validPayload(ctx, type, clientEventId) {
  return {
    siteId: ctx.siteId,
    lat: 30.0561,
    lng: 31.3395,
    accuracyMeters: 10,
    deviceId: ctx.deviceId,
    isMockLocation: false,
    type,
    clientEventId,
  };
}

async function cleanupFixture(ctx) {
  await pool.query("DELETE FROM checkins WHERE user_id = $1", [ctx.userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [ctx.userId]);
  await pool.query("DELETE FROM sites WHERE id = $1", [ctx.siteId]);
}
