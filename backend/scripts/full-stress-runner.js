const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Client } = require('pg');

const INTERNAL_API = process.env.STRESS_API_URL || 'http://welcoming-blessing.railway.internal:8080';
const WORKERS = Number(process.env.STRESS_WORKERS || 1000);
const LEVELS = (process.env.STRESS_LEVELS || '10,50,100,250,500,1000').split(',').map(Number);
const PASSWORD = `Stress-${randomUUID().slice(0, 8)}!`;
const PREFIX = `__stress_${Date.now()}_`;

function stats(values) {
  const a = [...values].sort((x, y) => x - y);
  const at = p => a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : 0;
  return { count: a.length, avg: +(a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)).toFixed(1), p50: +at(.50).toFixed(1), p95: +at(.95).toFixed(1), p99: +at(.99).toFixed(1), max: +at(1).toFixed(1) };
}

async function http(path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${INTERNAL_API}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, body: { error: error.message }, ms: performance.now() - started };
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  if (WORKERS < Math.max(...LEVELS)) throw new Error('STRESS_WORKERS must be >= max STRESS_LEVELS');

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const created = { userIds: [], siteId: null };

  try {
    console.log(`\n=== HiTechNour FULL STRESS RUN ===`);
    console.log(`API: ${INTERNAL_API}`);
    console.log(`Workers: ${WORKERS}`);

    const health = await http('/health');
    console.log(`Health: HTTP ${health.status} ${Math.round(health.ms)}ms`, health.body);
    if (health.status !== 200) throw new Error('Internal API health check failed');

    const site = await db.query(`INSERT INTO sites (name, address, lat, lng, radius_meters) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [`${PREFIX}Stress Site`, 'Synthetic test site', 30.0444, 31.2357, 1000]);
    created.siteId = site.rows[0].id;
    const hash = await bcrypt.hash(PASSWORD, 10);
    const values = Array.from({length: WORKERS}, (_, i) => ({ username: `${PREFIX}worker_${String(i + 1).padStart(4, '0')}`, fullName: `Stress Worker ${i + 1}`, deviceId: `${PREFIX}device_${i + 1}` }));

    for (let i = 0; i < values.length; i += 100) {
      for (const w of values.slice(i, i + 100)) {
        const r = await db.query(`INSERT INTO users (username,password_hash,full_name,role,device_id,active) VALUES ($1,$2,$3,'employee',$4,true) RETURNING id`, [w.username, hash, w.fullName, w.deviceId]);
        created.userIds.push(r.rows[0].id);
      }
      console.log(`Seeded ${Math.min(i + 100, WORKERS)}/${WORKERS} workers`);
    }

    // Login is intentionally rate-limited by the API. Five concurrent attempts
    // from one runner IP should produce one success followed by 429s. That is a
    // protection we want to verify, not a stress-suite failure.
    const loginChecks = await Promise.all(Array.from({length: 5}, (_, i) => http('/api/auth/login', { method:'POST', body:JSON.stringify({ username:values[i].username, password:PASSWORD }) })));
    const loginStatuses = loginChecks.map(x => x.status);
    const loginOk = loginStatuses.filter(s => s === 200).length;
    const loginLimited = loginStatuses.filter(s => s === 429).length;
    console.log('Authentication/rate-limit smoke:', loginStatuses);
    if (loginOk !== 1 || loginLimited !== 4) throw new Error(`Authentication/rate-limit smoke failed: expected 1x200 + 4x429, got ${JSON.stringify(loginStatuses)}`);

    const tokenFor = userId => jwt.sign({ id: userId, username: `${PREFIX}worker`, role: 'employee', tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '10m' });

    const runBatch = async (n, type) => {
      const ids = created.userIds.slice(0, n);
      const eventIds = [];
      const started = performance.now();
      const results = await Promise.all(ids.map((userId, index) => {
        const clientEventId = randomUUID(); eventIds.push(clientEventId);
        return http('/api/checkins', { method:'POST', headers:{authorization:`Bearer ${tokenFor(userId)}`}, body:JSON.stringify({siteId:created.siteId,lat:30.0444,lng:31.2357,accuracyMeters:5,deviceId:values[index].deviceId,isMockLocation:false,type,clientEventId}) });
      }));
      const elapsed = performance.now() - started;
      const latency = stats(results.map(r => r.ms));
      const counts = results.reduce((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{});
      const success = results.filter(r => r.status === 201).length;
      const idsResult = await db.query(`SELECT COUNT(*)::int AS count FROM checkins WHERE client_event_id = ANY($1::uuid[]) AND type = $2`, [eventIds,type]);
      console.log(`${type} ${n}: success=${success}/${n} statuses=${JSON.stringify(counts)} elapsed=${Math.round(elapsed)}ms latency=${JSON.stringify(latency)} dbRowsThisBatch=${idsResult.rows[0].count}`);
      if (success !== n || Number(idsResult.rows[0].count) !== n) throw new Error(`${type} integrity failure at ${n}`);
      return {n,type,elapsed,latency,counts,dbRowsThisBatch:Number(idsResult.rows[0].count)};
    };

    const results = [];
    for (const n of LEVELS) {
      if (!Number.isInteger(n) || n < 1 || n > WORKERS) continue;
      results.push(await runBatch(n,'check_in'));
      results.push(await runBatch(n,'check_out'));
    }

    const raceUser = created.userIds[0];
    const eventId = randomUUID();
    const duplicateResults = await Promise.all(Array.from({length:20},()=>http('/api/checkins',{method:'POST',headers:{authorization:`Bearer ${tokenFor(raceUser)}`},body:JSON.stringify({siteId:created.siteId,lat:30.0444,lng:31.2357,accuracyMeters:5,deviceId:values[0].deviceId,type:'check_in',clientEventId:eventId})})));
    const duplicateStatuses = duplicateResults.reduce((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{});
    const duplicateRows = await db.query(`SELECT COUNT(*)::int AS count FROM checkins WHERE user_id=$1 AND client_event_id=$2`,[raceUser,eventId]);
    console.log(`Idempotency: statuses=${JSON.stringify(duplicateStatuses)} dbRows=${duplicateRows.rows[0].count}`);
    if (Number(duplicateRows.rows[0].count)!==1) throw new Error('IDEMPOTENCY FAILURE: duplicate event created multiple rows');

    const raceWorker = created.userIds[1];
    const race = await Promise.all(Array.from({length:10},()=>http('/api/checkins',{method:'POST',headers:{authorization:`Bearer ${tokenFor(raceWorker)}`},body:JSON.stringify({siteId:created.siteId,lat:30.0444,lng:31.2357,accuracyMeters:5,deviceId:values[1].deviceId,type:'check_in',clientEventId:randomUUID()})})));
    const raceStatuses = race.reduce((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{});
    console.log(`State race (same worker, unique events): ${JSON.stringify(raceStatuses)}`);
    if ((raceStatuses[201]||0)!==1 || (raceStatuses[409]||0)!==9) throw new Error('STATE RACE FAILURE: expected 1 successful check-in and 9 conflicts');

    console.log('\n=== PASS: all stress assertions completed ===');
    console.log(JSON.stringify({levels:LEVELS,workers:WORKERS,results},null,2));
  } finally {
    console.log('Cleaning synthetic stress data...');
    if (created.userIds.length) {
      await db.query('DELETE FROM checkins WHERE user_id = ANY($1::int[])',[created.userIds]);
      await db.query('DELETE FROM notifications WHERE user_id = ANY($1::int[]) OR body LIKE $2',[created.userIds,`${PREFIX}%`]);
      await db.query('DELETE FROM assignments WHERE user_id = ANY($1::int[])',[created.userIds]);
      await db.query('DELETE FROM worker_skills WHERE user_id = ANY($1::int[])',[created.userIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])',[created.userIds]);
    }
    if (created.siteId) await db.query('DELETE FROM sites WHERE id=$1',[created.siteId]);
    await db.end(); console.log('Cleanup complete.');
  }
}
main().catch(error=>{console.error('\n=== STRESS TEST FAILED ===');console.error(error.stack||error);process.exit(1);});
