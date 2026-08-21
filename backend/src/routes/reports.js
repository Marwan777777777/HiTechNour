const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Simple global "what counts as late" assumption, since there's no
// per-site or per-worker schedule yet - just a single cutoff time. Fine
// as a starting point; ask to make this configurable per site later if
// different sites need different start times.
const LATE_CUTOFF_HOUR = Number(process.env.LATE_CUTOFF_HOUR ?? 9);
const LATE_CUTOFF_MINUTE = Number(process.env.LATE_CUTOFF_MINUTE ?? 15);

function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function isLate(checkInAt) {
  const h = checkInAt.getHours();
  const m = checkInAt.getMinutes();
  return h > LATE_CUTOFF_HOUR || (h === LATE_CUTOFF_HOUR && m > LATE_CUTOFF_MINUTE);
}

// One worker's status for a single day: first check-in, last check-out (if
// any), and the site of that first check-in. Shared by the KPI cards, the
// recent-attendance table, and the weekly trend so all three numbers are
// always computed the exact same way.
async function getDayStatuses(date) {
  const { start, end } = dayBounds(date);
  const { rows: workers } = await pool.query(
    "SELECT id, full_name, username FROM users WHERE role != 'admin' AND active = true"
  );
  if (workers.length === 0) return [];

  const { rows: events } = await pool.query(
    `SELECT c.user_id, c.type, c.created_at, s.name AS site_name
     FROM checkins c JOIN sites s ON s.id = c.site_id
     WHERE c.created_at >= $1 AND c.created_at < $2
     ORDER BY c.created_at ASC`,
    [start, end]
  );

  const firstIn = {};
  const lastOut = {};
  for (const e of events) {
    if (e.type === "check_in" && !firstIn[e.user_id]) firstIn[e.user_id] = e;
    if (e.type === "check_out") lastOut[e.user_id] = e;
  }

  return workers.map((w) => {
    const inEvent = firstIn[w.id];
    const outEvent = lastOut[w.id];
    let status;
    if (!inEvent) status = "absent";
    else if (outEvent) status = "completed";
    else if (isLate(new Date(inEvent.created_at))) status = "late";
    else status = "present";
    return {
      userId: w.id,
      fullName: w.full_name,
      username: w.username,
      siteName: inEvent?.site_name || null,
      checkInAt: inEvent?.created_at || null,
      checkOutAt: outEvent?.created_at || null,
      status,
    };
  });
}

// Admin dashboard Overview page: KPI cards, a 6-day trend, today's site
// breakdown, the most recent activity, and the flagged review queue.
router.get("/overview", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const today = new Date();
    const todayStatuses = await getDayStatuses(today);

    const totalWorkers = todayStatuses.length;
    const presentToday = todayStatuses.filter((s) => s.status === "present" || s.status === "completed").length;
    const lateToday = todayStatuses.filter((s) => s.status === "late").length;
    const absentToday = todayStatuses.filter((s) => s.status === "absent").length;

    const bySiteMap = {};
    todayStatuses.forEach((s) => {
      if (!s.siteName) return;
      bySiteMap[s.siteName] = (bySiteMap[s.siteName] || 0) + 1;
    });
    const bySite = Object.entries(bySiteMap).map(([name, count]) => ({ name, count }));

    const weekly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const statuses = await getDayStatuses(d);
      weekly.push({
        date: d.toISOString().slice(0, 10),
        present: statuses.filter((s) => s.status === "present" || s.status === "completed").length,
        late: statuses.filter((s) => s.status === "late").length,
        absent: statuses.filter((s) => s.status === "absent").length,
      });
    }

    const recentAttendance = todayStatuses
      .filter((s) => s.checkInAt)
      .sort((a, b) => new Date(b.checkInAt) - new Date(a.checkInAt))
      .slice(0, 8);

    const { rows: reviewQueue } = await pool.query(
      `SELECT c.id, u.full_name, s.name AS site_name, c.flag_reason, c.created_at
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.flagged = true AND c.reviewed = false
       ORDER BY c.created_at DESC
       LIMIT 8`
    );

    res.json({
      totalWorkers,
      presentToday,
      lateToday,
      absentToday,
      bySite,
      weekly,
      recentAttendance,
      reviewQueue,
    });
  } catch (err) {
    next(err);
  }
});

// Admin Team page: workers grouped by their site for today (based on
// today's assignment), with their skills and this-month attendance %.
// Workers with no assignment covering today land in "Unassigned".
router.get("/team", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { rows: workers } = await pool.query(
      "SELECT id, full_name, username, title FROM users WHERE role != 'admin' AND active = true ORDER BY full_name"
    );

    const { rows: todaysAssignments } = await pool.query(
      `SELECT a.user_id, s.name AS site_name
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
       WHERE a.start_date <= $1 AND a.end_date >= $1`,
      [today]
    );
    const siteByUser = {};
    todaysAssignments.forEach((a) => {
      siteByUser[a.user_id] = a.site_name;
    });

    const { rows: skillRows } = await pool.query(
      `SELECT ws.user_id, s.name, ws.level
       FROM worker_skills ws
       JOIN skills s ON s.id = ws.skill_id
       ORDER BY ws.level DESC`
    );
    const skillsByUser = {};
    skillRows.forEach((r) => {
      if (!skillsByUser[r.user_id]) skillsByUser[r.user_id] = [];
      skillsByUser[r.user_id].push({ name: r.name, level: r.level });
    });

    const monthStart = today.slice(0, 7) + "-01";
    const { rows: attendanceRows } = await pool.query(
      `SELECT user_id, COUNT(DISTINCT DATE(created_at)) AS days_present
       FROM checkins
       WHERE type = 'check_in' AND created_at >= $1
       GROUP BY user_id`,
      [monthStart]
    );
    const attendanceByUser = {};
    attendanceRows.forEach((r) => {
      attendanceByUser[r.user_id] = Number(r.days_present);
    });
    const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();

    const grouped = {};
    workers.forEach((w) => {
      const siteName = siteByUser[w.id] || "Unassigned";
      if (!grouped[siteName]) grouped[siteName] = [];
      grouped[siteName].push({
        id: w.id,
        fullName: w.full_name,
        username: w.username,
        title: w.title,
        skills: skillsByUser[w.id] || [],
        attendancePct: Math.round(((attendanceByUser[w.id] || 0) / daysInMonth) * 100),
      });
    });

    res.json(
      Object.entries(grouped).map(([siteName, members]) => ({ siteName, members }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
