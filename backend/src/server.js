require("dotenv").config();
const express = require("express");
const cors = require("cors");

const pool = require("./db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const siteRoutes = require("./routes/sites");
const checkinRoutes = require("./routes/checkins");
const assignmentRoutes = require("./routes/assignments");
const skillRoutes = require("./routes/skills");
const reportRoutes = require("./routes/reports");

const app = express();

// Railway (like most hosts) puts the app behind a reverse proxy and sets
// X-Forwarded-For. Without telling Express to trust exactly one hop of
// proxy, express-rate-limit refuses to read that header and throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request that hits a rate
// limiter (login, check-ins) - which was crashing login entirely.
app.set("trust proxy", 1);

app.use(express.json({ limit: "100kb" }));

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow no-origin requests (curl, server-to-server health checks).
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  })
);

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/checkins", checkinRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/skills", skillRoutes);
app.use("/api/reports", reportRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Central error handler - keeps stack traces out of responses.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  res.status(500).json({ error: "Internal server error." });
});

const PORT = process.env.PORT || 4000;
const { applyMigrations } = require("./migrate");

// Applies any pending schema changes before accepting traffic, so a
// deploy that adds new tables/columns just works - no separate manual
// migration step needed on every push.
applyMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`HighTechNour attendance backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[migrate] Failed to apply migrations, server not started:", err);
    process.exit(1);
  });
