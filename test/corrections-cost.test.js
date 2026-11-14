// What a refused correction costs the database, measured on workerd's own D1 (wrangler's getPlatformProxy, local
// only: a throwaway config with no account and no remote bindings, nothing persisted). The stand-in in
// helpers/d1.js runs the same SQL but cannot count the rows a statement reads; workerd reports them as D1 does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureStaticBundle, makeCtx, metered, together, ROOT } from './helpers/d1.js';

process.env.WRANGLER_SEND_METRICS = 'false';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
let worker;
let proxy;
let dir;
let unavailable;

before(async () => {
  ensureStaticBundle();
  ({ default: worker } = await import('../src/index.js'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amm-d1-'));
  const configPath = path.join(dir, 'wrangler.json');
  fs.writeFileSync(configPath, JSON.stringify({
    name: 'amm-corrections-test',
    compatibility_date: '2026-10-01',
    d1_databases: [{ binding: 'DB', database_name: 'amm-corrections-test', database_id: '00000000-0000-4000-8000-000000000000' }],
  }));
  try {
    const { getPlatformProxy } = await import('wrangler');
    proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  } catch (err) {
    unavailable = `workerd's local D1 did not start: ${err?.message || err}`;
  }
});

after(async () => {
  await proxy?.dispose();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// The corrections tables of db/schema.sql, empty.
async function freshCorrections() {
  const db = proxy.env.DB;
  for (const t of ['corrections', 'correction_clients', 'correction_gate']) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  const schema = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8').replace(/--.*$/gm, '');
  for (const sql of schema.split(';').map((s) => s.trim()).filter((s) => /\bcorrection(s|_clients|_gate)\b/.test(s))) {
    await db.prepare(sql).run();
  }
  return db;
}

async function addCorrections(db, times) {
  const list = times.map((t) => db.prepare("INSERT INTO corrections (note, kind, created_at) VALUES ('x', 'correction', ?)").bind(t));
  for (let i = 0; i < list.length; i += 100) await db.batch(list.slice(i, i + 100));
}

const note = JSON.stringify({ note: 'The founding year on this profile is wrong.', entity_id: 'hive', kind: 'correction' });
// One request with its own metered binding; returns its status and the rows it read and wrote.
async function send(db, ip, wait) {
  const DB = metered(db, wait);
  const ctx = makeCtx();
  const res = await worker.fetch(new Request('https://amm.test/api/corrections', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: note,
  }), { DB, ADMIN_TOKEN: 'test-token' }, ctx);
  await ctx.settle();
  return { status: res.status, ...DB.meter };
}
const sendAtOnce = (db, ips) => { const wait = together(ips.length); return Promise.all(ips.map((ip) => send(db, ip, wait))); };
const gate = async (db) => (await db.prepare('SELECT closed_until FROM correction_gate').first())?.closed_until;

// A refused request that does not count the recent queue reads about 10 rows; one that counts it reads 200 or more.
const SMALL = 30;

test('one address sending many corrections at once: its refusals do not read the recent queue', { timeout: 60_000 }, async (t) => {
  if (unavailable) return t.skip(unavailable);
  const db = await freshCorrections();
  const now = Date.now();
  // The overall caps have room: 20 counted corrections in the last hour, 170 in the last day.
  await addCorrections(db, [
    ...Array.from({ length: 20 }, (_, i) => new Date(now - 10 * 60_000 - i * 1000).toISOString()),
    ...Array.from({ length: 150 }, (_, i) => new Date(now - 2 * HOUR - i * 60_000).toISOString()),
  ]);
  const out = await sendAtOnce(db, Array(50).fill('198.51.100.77'));
  const refused = out.filter((r) => r.status === 429);
  assert.equal(out.filter((r) => r.status === 201).length, 5);
  assert.equal(refused.length, 45);
  const most = Math.max(...refused.map((r) => r.rows));
  assert.ok(most <= SMALL, `a refusal by the sender's own cap read ${most} rows`);
  assert.equal(refused.reduce((n, r) => n + r.written, 0), 0, 'refusals write nothing');
  assert.equal(await gate(db), undefined, 'the overall caps are not full, so the form is not marked closed');
});

test('many addresses at once while the caps are full: one request reads the queue and marks the form closed', { timeout: 60_000 }, async (t) => {
  if (unavailable) return t.skip(unavailable);
  const db = await freshCorrections();
  const now = Date.now();
  // The daily cap is full: 200 corrections from 2 to 22 hours ago.
  const times = Array.from({ length: 200 }, (_, i) => new Date(now - 2 * HOUR - i * 6 * 60_000).toISOString());
  await addCorrections(db, times);
  // A mark whose time has passed, the same state as an admin change (which deletes the mark) while the caps are
  // still full.
  await db.prepare('INSERT INTO correction_gate (id, closed_until) VALUES (1, ?)').bind(new Date(now - 1000).toISOString()).run();

  const out = await sendAtOnce(db, Array.from({ length: 50 }, (_, i) => `203.0.113.${i}`));
  assert.deepEqual([...new Set(out.map((r) => r.status))], [429]);
  const costly = out.filter((r) => r.rows > SMALL);
  assert.equal(costly.length, 1, `requests that read the queue: ${out.map((r) => r.rows).join(', ')}`);
  assert.ok(costly[0].rows < 500, `the request that marked the form closed read ${costly[0].rows} rows`);
  assert.equal(out.filter((r) => r.written > 0).length, 1, 'the mark is written once');
  assert.equal(await gate(db), new Date(Date.parse(times[199]) + DAY).toISOString());

  // After that, one at a time: the pre-check alone.
  for (const ip of ['192.0.2.1', '192.0.2.2']) {
    const r = await send(db, ip);
    assert.equal(r.status, 429);
    assert.ok(r.rows <= 3, `${ip} read ${r.rows} rows`);
  }
});
