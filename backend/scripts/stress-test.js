#!/usr/bin/env node
/**
 * Safe, repeatable attendance stress harness.
 *
 * Usage:
 *   API_BASE_URL=https://... TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... node backend/scripts/stress-test.js
 *
 * This runner never deletes data. It uses a dedicated synthetic test user when
 * TEST_WORKER_EMAIL/PASSWORD are supplied and reports server-side integrity.
 */
const { randomUUID } = require('crypto');
const base = (process.env.API_BASE_URL || '').replace(/\/$/, '');
const email = process.env.TEST_WORKER_EMAIL;
const password = process.env.TEST_WORKER_PASSWORD;
const concurrency = Number(process.env.CONCURRENCY || 25);
const rounds = Number(process.env.ROUNDS || 3);

if (!base || !email || !password) {
  console.error('Set API_BASE_URL, TEST_WORKER_EMAIL and TEST_WORKER_PASSWORD.');
  process.exit(2);
}

async function request(path, options = {}) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, body, ms: performance.now() - started };
}

async function login() {
  const r = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password })
  });
  if (!r.res.ok || !r.body?.token) throw new Error(`Login failed: ${r.res.status} ${textOf(r.body)}`);
  return r.body.token;
}

function textOf(x) { return typeof x === 'string' ? x : JSON.stringify(x); }
function stats(values) {
  values.sort((a,b)=>a-b);
  const pct = p => values[Math.min(values.length-1, Math.floor(values.length*p))] || 0;
  return { count: values.length, min: values[0] || 0, avg: values.reduce((a,b)=>a+b,0)/(values.length||1), p50:pct(.50), p95:pct(.95), p99:pct(.99), max:values.at(-1)||0 };
}

async function duplicateIdempotency(token) {
  const eventId = randomUUID();
  const payload = { type: 'check_in', latitude: 0, longitude: 0, accuracy: 10, device_id: `stress-${eventId}`, client_event_id: eventId };
  const headers = { authorization: `Bearer ${token}` };
  const results = await Promise.all(Array.from({length: concurrency}, () => request('/api/checkins', { method:'POST', headers, body:JSON.stringify(payload) })));
  const success = results.filter(x => x.res.ok);
  const conflict = results.filter(x => x.res.status === 409);
  return { success: success.length, conflict: conflict.length, statuses: results.reduce((m,x)=>(m[x.res.status]=(m[x.res.status]||0)+1,m),{}) };
}

async function loadLogin() {
  const values = [];
  let errors = 0;
  for (let r=0;r<rounds;r++) {
    const batch = await Promise.all(Array.from({length: concurrency}, async () => {
      try { const x = await login(); values.push(x ? 1 : 0); return x; } catch { errors++; return null; }
    }));
    void batch;
  }
  return { requests: rounds*concurrency, errors };
}

(async () => {
  console.log(`HiTechNour stress test: ${base}`);
  const health = await request('/api/health');
  console.log(`Health: ${health.res.status} (${Math.round(health.ms)}ms)`);
  const token = await login();

  console.log(`Login concurrency: ${concurrency} x ${rounds}`);
  const loginResult = await loadLogin();
  console.log(loginResult);

  console.log(`Idempotency concurrency: ${concurrency} identical check-ins`);
  const idem = await duplicateIdempotency(token);
  console.log(idem);
  if (idem.success > 1) {
    console.error('FAIL: duplicate idempotent attendance writes detected.');
    process.exitCode = 1;
  }

  console.log('\nRESULT');
  console.log(JSON.stringify({ health: health.res.status, login: loginResult, idempotency: idem }, null, 2));
  console.log('\nNote: geofence validation may reject the synthetic coordinates; this test is primarily for request concurrency/idempotency.');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
