const pool = require("../db");

function isValidMonthString(s) {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
}

// Resolves a "YYYY-MM" string (or defaults to the current month) into a
// [start, end) date range plus how many days are in that month - shared by
// both the worker's own summary and the admin worker-detail view so the
// two numbers can never drift apart.
function resolveMonth(monthParam) {
  const month = isValidMonthString(monthParam) ? monthParam : new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { month, start, end, daysInMonth };
}

// A "day present" = at least one check_in on that calendar date. Uses the
// checkin's own timestamp, grouped by date, so a worker who checks in twice
// in one day is only counted once.
async function getMonthlyAttendance(userId, monthParam) {
  const { month, start, end, daysInMonth } = resolveMonth(monthParam);

  const { rows } = await pool.query(
    `SELECT DISTINCT DATE(created_at) AS day
     FROM checkins
     WHERE user_id = $1 AND type = 'check_in' AND created_at >= $2 AND created_at < $3
     ORDER BY day`,
    [userId, start, end]
  );

  return {
    month,
    daysInMonth,
    daysPresent: rows.length,
    presentDates: rows.map((r) => r.day.toISOString().slice(0, 10)),
  };
}

module.exports = { resolveMonth, getMonthlyAttendance, isValidMonthString };
