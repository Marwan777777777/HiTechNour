require("dotenv").config();
const express = require("express");
const cors = require("cors");

const pool = require("./db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const siteRoutes = require("./routes/sites");
const checkinRoutes = require("./routes/checkins");
const assignmentRoutes = require("./routes/assignments");

const app = express();

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
app.listen(PORT, () => {
  console.log(`HighTechNour attendance backend listening on port ${PORT}`);
});
