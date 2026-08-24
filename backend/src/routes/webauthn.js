const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoUint8Array } = require("@simplewebauthn/server/helpers");

const router = express.Router();

const rpID = (process.env.WEBAUTHN_RP_ID || "hightechnour-app.vercel.app").trim();
const rpName = process.env.WEBAUTHN_RP_NAME || "HiTechNour Attendance";
const origins = (process.env.WEBAUTHN_ORIGIN || "https://hightechnour-app.vercel.app")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function issueToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.token_version,
    },
    process.env.JWT_SECRET,
    { expiresIn: "365d" }
  );
}

function base64UrlToBuffer(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function normalizeTransports(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => typeof item === "string").join(",");
}

function transportsFromDb(value) {
  if (!value) return undefined;
  return value.split(",").filter(Boolean);
}

async function clearExpiredChallenges() {
  await pool.query("DELETE FROM webauthn_challenges WHERE expires_at < now()");
}

async function saveChallenge(kind, userId, challenge) {
  await clearExpiredChallenges();
  await pool.query(
    "DELETE FROM webauthn_challenges WHERE kind = $1 AND user_id IS NOT DISTINCT FROM $2",
    [kind, userId ?? null]
  );
  await pool.query(
    "INSERT INTO webauthn_challenges (user_id, kind, challenge, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')",
    [userId ?? null, kind, challenge]
  );
}

async function consumeChallenge(kind, userId) {
  const { rows } = await pool.query(
    `DELETE FROM webauthn_challenges
     WHERE id = (
       SELECT id FROM webauthn_challenges
       WHERE kind = $1 AND user_id IS NOT DISTINCT FROM $2 AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING challenge`,
    [kind, userId ?? null]
  );
  return rows[0]?.challenge || null;
}

// Password login remains the bootstrap. This endpoint is only available after
// the worker has already authenticated with the normal session token.
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM webauthn_credentials WHERE user_id = $1) AS enabled FROM users WHERE id = $1 AND active = true",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    res.json({ enabled: rows[0].enabled });
  } catch (err) {
    next(err);
  }
});

// Start biometric/passkey enrollment for the currently authenticated worker.
router.get("/registration-options", requireAuth, async (req, res, next) => {
  try {
    const { rows: users } = await pool.query(
      "SELECT id, username, full_name, active FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = users[0];
    if (!user || !user.active) return res.status(401).json({ error: "Account is inactive." });

    const { rows: credentials } = await pool.query(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1",
      [user.id]
    );

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.username,
      userID: isoUint8Array.fromUTF8String(`htn-user-${user.id}`),
      userDisplayName: user.full_name,
      timeout: 60000,
      attestationType: "none",
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credential_id,
        transports: transportsFromDb(credential.transports),
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    await saveChallenge("registration", user.id, options.challenge);
    res.json(options);
  } catch (err) {
    next(err);
  }
});

router.post("/registration-verify", requireAuth, async (req, res, next) => {
  try {
    const expectedChallenge = await consumeChallenge("registration", req.user.id);
    if (!expectedChallenge) return res.status(400).json({ error: "Registration request expired. Try again." });

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Biometric registration could not be verified." });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const transports = normalizeTransports(req.body?.response?.transports || credential.transports);

    await pool.query(
      `INSERT INTO webauthn_credentials
        (user_id, credential_id, public_key, counter, transports, device_type, backed_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (credential_id) DO NOTHING`,
      [
        req.user.id,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        transports,
        credentialDeviceType,
        credentialBackedUp,
      ]
    );

    res.json({ verified: true, enabled: true });
  } catch (err) {
    console.error("[webauthn] registration verification failed:", err);
    next(err);
  }
});

// Usernameless login: the browser/authenticator chooses a discoverable
// credential. The credential ID returned by the authenticator identifies the
// worker account on the server, so username/password are not needed again.
router.get("/authentication-options", async (req, res, next) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      allowCredentials: [],
      userVerification: "required",
    });
    await saveChallenge("authentication", null, options.challenge);
    res.json(options);
  } catch (err) {
    next(err);
  }
});

router.post("/authentication-verify", async (req, res, next) => {
  try {
    const body = req.body || {};
    const credentialId = body.id || body.rawId;
    if (!credentialId) return res.status(400).json({ error: "Missing biometric credential." });

    const { rows: credentials } = await pool.query(
      `SELECT c.id, c.user_id, c.credential_id, c.public_key, c.counter, c.transports,
              u.username, u.full_name, u.role, u.token_version, u.active
       FROM webauthn_credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.credential_id = $1
       LIMIT 1`,
      [credentialId]
    );
    const stored = credentials[0];
    if (!stored || !stored.active) {
      return res.status(401).json({ error: "This biometric sign-in is no longer available." });
    }

    const expectedChallenge = await consumeChallenge("authentication", null);
    if (!expectedChallenge) return res.status(400).json({ error: "Biometric sign-in expired. Try again." });

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(stored.public_key),
        counter: Number(stored.counter),
        transports: transportsFromDb(stored.transports),
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Biometric verification failed." });
    }

    await pool.query(
      `UPDATE webauthn_credentials
       SET counter = $1, last_used_at = now(), device_type = $2, backed_up = $3
       WHERE id = $4`,
      [
        verification.authenticationInfo.newCounter,
        verification.authenticationInfo.credentialDeviceType,
        verification.authenticationInfo.credentialBackedUp,
        stored.id,
      ]
    );

    const token = issueToken(stored);
    res.json({
      token,
      user: {
        id: stored.user_id,
        username: stored.username,
        fullName: stored.full_name,
        role: stored.role,
      },
    });
  } catch (err) {
    console.error("[webauthn] authentication verification failed:", err);
    next(err);
  }
});

// Worker can remove their own registered biometric/passkey. Password login
// remains available and can be used to register a new one later.
router.delete("/credentials", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM webauthn_credentials WHERE user_id = $1", [req.user.id]);
    res.json({ ok: true, removed: result.rowCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
