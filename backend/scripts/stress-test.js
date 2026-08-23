#!/usr/bin/env node
/**
 * One-shot HiTechNour attendance stress harness.
 * It never deletes application data except rows it creates with the TEST_RUN_ID.
 */
const { randomUUID } = require('crypto');
const base = (process.env.API_BASE_URL || '').replace(/\/$/, '');
const username = process.env.TEST_WORKER_USERNAME || process.env.TEST_WORKER_EMAIL;
const password = process.env.TEST_WORKER_PASSWORD;
const concurrency = Number(process.env.CONCURRENCY || 25);
const rounds = Number(process.env.ROUNDS || 3);

if (!base || !username || !password) {
  console.error('Set API_BASE_URL, TEST_WORKER_USERNAME (or TEST_WORKER_EMAIL), and TEST_WORKER_PASSWORD.');
  process.exit(2);
}

async function request(path, options = {}) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, body, ms: performance.now() - started };
}

function textOf(x) { return typeof x === 'string' ? x : JSON.stringify(x); }

async function login() {
  const r = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!r.res.ok || !r.body?.token) {
    throw new Error(`Login failed: ${r.res.status} ${textOf(r.body)}`);
  }
  return r.body.token;
}

function stats(values) {
  const a = [...values].sort((x, y) => x - y);
  const at = p => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
  return {
    count: a.length,
    min: a[0] || 0,
    avg: a.reduce((s, x) => s + x, 0) / (a.length || 1),
    p50: at(0.50), p95: at(0.95), p99: at(0.99), max: a.at(-1) || 0,
  };
}

async function runConcurrent(token, n, label, payloadFactory) {
  const headers = { authorization: `Bearer ${token}` };
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => (async () => {
    const payload = payloadFactory(i);
    const r = await request('/api/checkins', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    return { status: r.res.status, ok: r.res.ok, ms: r.ms, body: r.body };
  })()));
  const elapsed = performance.now() - started;
  const latencies = results.map(x => x.ms);
  const statusCounts = results.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
  console.log(label, { elapsed: Math.round(elapsed), statusCounts, latency: stats(latencies) });
  return results;
}

async function duplicateIdempotency(token) {
  const eventId = randomUUID();
  const payload = {
    type: 'check_in', latitude: 0, longitude: 0, accuracy: 10,
    device_id: `stress-${eventId}`, client_event_id: eventId,
  };
  const results = await runConcurrent(token, concurrency, 'idempotency', () => payload);
  const successes = results.filter(x => x.ok).length;
  if (successes > 1) throw new Error(`IDEMPOTENCY FAILURE: ${successes} identical requests succeeded`);
  return { successes, statuses: results.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {}) };
}

(async () => {
  console.log(`HiTechNour stress test: ${base}`);
  const health = await request('/api/health');
  console.log(`Health: ${health.res.status} (${Math.round(health.ms)}ms)`);
  if (!health.res.ok) throw new Error(`Health check failed: ${health.res.status}`);

  const token = await login();
  console.log('Authentication smoke: PASS');

  const levels = [10, 50, 100, 250, 500, 1000];
  const summary = [];
  for (const level of levels) {
    const ids = Array.from({ length: level }, () => randomUUID());
    const checkIns = await runConcurrent(token, level, `check-in ${level}`, i => ({
      type: 'check_in', latitude: 0, longitude: 0, accuracy: 10,
      device_id: `stress-${ids[i]}`, client_event_id: ids[i],
    }));
    summary.push({ level, checkIns: checkIns.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {}) });
  }

  const idem = await duplicateIdempotency(token);
  console.log('\nRESULT');
  console.log(JSON.stringify({ health: health.res.status, summary, idempotency: idem }, null, 2));
  console.log('ONE-SHOT TEST COMPLETE');
})().catch(err => {
  console.error('\n=== STRESS TEST FAILED ===');
  console.error(err.stack || err);
  process.exit(1);
});
