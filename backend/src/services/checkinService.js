const { haversineMeters } = require("../utils/geo");
const { isImpossibleTravel } = require("../utils/impossibleTravel");
const { isValidLat, isValidLng, isNonEmptyString } = require("../utils/validate");

const BLOCK_ON_DEVICE_MISMATCH = process.env.BLOCK_ON_DEVICE_MISMATCH !== "false";
const WORK_HOURS_START = Number(process.env.WORK_HOURS_START ?? 6);
const WORK_HOURS_END = Number(process.env.WORK_HOURS_END ?? 20);
const MAX_ACCEPTABLE_ACCURACY_METERS = Number(process.env.MAX_ACCEPTABLE_ACCURACY_METERS ?? 100);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOffHours(date) {
  const hour = date.getHours();
  return hour < WORK_HOURS_START || hour >= WORK_HOURS_END;
}

function validateClientEventId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

async function processCheckin(pool, userId, payload) {
  const {
    siteId,
    lat,
    lng,
    accuracyMeters,
    deviceId,
    isMockLocation,
    type,
    clientEventId,
  } = payload || {};

  if (
    !siteId ||
    !isValidLat(lat) ||
    !isValidLng(lng) ||
    !isNonEmptyString(deviceId, 200) ||
    !validateClientEventId(clientEventId)
  ) {
    const error = new Error(
      "siteId, valid lat/lng, deviceId, and a valid clientEventId are required."
    );
    error.status = 400;
    throw error;
  }

  if (type !== "check_in" && type !== "check_out") {
    const error = new Error("type must be either check_in or check_out.");
    error.status = 400;
    throw error;
  }

  if (accuracyMeters !== undefined && accuracyMeters !== null) {
    if (
      typeof accuracyMeters !== "number" ||
      !Number.isFinite(accuracyMeters) ||
      accuracyMeters < 0
    ) {
      const error = new Error("accuracyMeters must be a non-negative number.");
      error.status = 400;
      throw error;
    }
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");

    // Lock the worker row for the whole attendance state transition. This
    // serializes concurrent check-in/check-out requests for one worker while
    // still allowing different workers to check in concurrently.
    const userResult = await client.query(
      `SELECT id, device_id, pending_device_id, full_name, username
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) {
      const error = new Error("User not found.");
      error.status = 401;
      throw error;
    }

    // Idempotency is checked inside the same transaction as the insert. The
    // unique index is the final authority if two identical requests arrive at
    // exactly the same time.
    const existingResult = await client.query(
      `SELECT id, type, distance_meters, status, flagged, flag_reason, created_at
       FROM checkins
       WHERE user_id = $1 AND client_event_id = $2
       LIMIT 1`,
      [user.id, clientEventId]
    );
    if (existingResult.rows[0]) {
      await client.query("COMMIT");
      committed = true;
      return { row: existingResult.rows[0], duplicate: true, siteName: null, user };
    }

    const siteResult = await client.query(
      "SELECT id, name, lat, lng, radius_meters FROM sites WHERE id = $1 AND active = true",
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) {
      const error = new Error("Site not found.");
      error.status = 404;
      throw error;
    }

    let deviceMatched = true;
    if (!user.device_id) {
      if (!user.pending_device_id) {
        await client.query("UPDATE users SET pending_device_id = $1 WHERE id = $2", [deviceId, user.id]);
      }
      const error = new Error(
        "This device is awaiting admin approval before it can be used for check-ins. Ask your admin to approve it."
      );
      error.status = 403;
      error.pending = true;
      throw error;
    } else if (user.device_id !== deviceId) {
      deviceMatched = false;
      if (BLOCK_ON_DEVICE_MISMATCH) {
        const error = new Error(
          "This device isn't the one approved for your account. Ask an admin to reset your device binding if you're on a new phone."
        );
        error.status = 403;
        throw error;
      }
    }

    const distance = haversineMeters(lat, lng, site.lat, site.lng);
    const status = distance <= site.radius_meters ? "inside" : "outside";
    const prevResult = await client.query(
      `SELECT id, type, lat, lng, created_at
       FROM checkins
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [user.id]
    );
    const previous = prevResult.rows[0];
    const now = new Date();
    const impossibleTravel = isImpossibleTravel(previous, lat, lng, now);
    const offHours = isOffHours(now);
    const lowAccuracy =
      accuracyMeters != null && accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS;

    // The worker row lock makes this state transition atomic for one worker.
    // Reject duplicate consecutive events rather than creating invalid state.
    if (type === "check_in" && previous?.type === "check_in") {
      const error = new Error("You are already checked in.");
      error.status = 409;
      error.code = "ALREADY_CHECKED_IN";
      throw error;
    }
    if (type === "check_out" && previous?.type !== "check_in") {
      const error = new Error("You are not currently checked in.");
      error.status = 409;
      error.code = "NOT_CHECKED_IN";
      throw error;
    }

    let flagged = false;
    let flagReason = null;
    if (!deviceMatched) {
      flagged = true;
      flagReason = "device_mismatch";
    } else if (isMockLocation) {
      flagged = true;
      flagReason = "mock_location";
    } else if (impossibleTravel) {
      flagged = true;
      flagReason = "impossible_travel";
    } else if (status === "outside") {
      flagged = true;
      flagReason = "outside_radius";
    } else if (lowAccuracy) {
      flagged = true;
      flagReason = "low_accuracy";
    } else if (offHours) {
      flagged = true;
      flagReason = "off_hours";
    }

    const inserted = await client.query(
      `INSERT INTO checkins
        (user_id, site_id, type, client_event_id, lat, lng, accuracy_meters, distance_meters, status,
         device_id, device_matched, is_mock_location, is_off_hours, flagged, flag_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (user_id, client_event_id) DO NOTHING
       RETURNING id, type, distance_meters, status, flagged, flag_reason, created_at`,
      [
        user.id,
        siteId,
        type,
        clientEventId,
        lat,
        lng,
        accuracyMeters ?? null,
        distance,
        status,
        deviceId,
        deviceMatched,
        !!isMockLocation,
        offHours,
        flagged,
        flagReason,
      ]
    );

    if (!inserted.rows[0]) {
      const duplicate = await client.query(
        `SELECT id, type, distance_meters, status, flagged, flag_reason, created_at
         FROM checkins WHERE user_id = $1 AND client_event_id = $2 LIMIT 1`,
        [user.id, clientEventId]
      );
      await client.query("COMMIT");
      committed = true;
      return { row: duplicate.rows[0], duplicate: true, siteName: site.name, user };
    }

    await client.query("COMMIT");
    committed = true;
    return { row: inserted.rows[0], duplicate: false, siteName: site.name, user };
  } catch (err) {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processCheckin, validateClientEventId };
