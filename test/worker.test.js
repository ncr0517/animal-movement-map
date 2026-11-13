// The Worker's routes (src/index.js) over an in-memory D1 loaded with db/schema.sql and db/seed.sql.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, ensureStaticBundle, installCache, makeCtx } from './helpers/d1.js';
import { refresherHealth } from '../src/lib/health.js';

let worker;

before(async () => {
  ensureStaticBundle();
  ({ default: worker } = await import('../src/index.js'));
});

const ORIGIN = 'https://amm.test';
const seeded = () => createD1().load('db/schema.sql').load('db/seed.sql');
async function call(env, path, init = {}) {
  const ctx = makeCtx();
  const res = await worker.fetch(new Request(ORIGIN + path, init), env, ctx);
  await ctx.settle();
  return res;
}

test('a query string does not get past the snapshot cache', async () => {
  installCache();
  const db = seeded();
  const env = { DB: db };
  const first = await (await call(env, '/api/snapshot')).json();
  const builds = () => db.calls.filter((s) => s === 'SELECT * FROM entities').length;
  assert.equal(builds(), 1);
  for (const q of ['?x=1', '?x=2', '?verify=111093034']) {
    const r = await call(env, '/api/snapshot' + q);
    assert.equal((await r.json()).generated_at, first.generated_at, q);
  }
  assert.equal(builds(), 1, 'served from the cache, not rebuilt from D1');
});

test('an empty database answers 503 and is not cached', async () => {
  const cache = installCache();
  const env = { DB: createD1().load('db/schema.sql') }; // mid-reseed: tables exist, seed not loaded yet
  const r = await call(env, '/api/snapshot');
  assert.equal(r.status, 503);
  assert.equal(cache.size, 0);
  env.DB.sqlite.exec((await import('node:fs')).readFileSync(new URL('../db/seed.sql', import.meta.url), 'utf8'));
  const ok = await call(env, '/api/snapshot');
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).entities.length > 100);
});

const post = (body, headers = { 'content-type': 'application/json' }) => ({ method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const note = { note: 'The founding year on this profile is wrong.', entity_id: 'hive', kind: 'correction' };

test('corrections must be JSON and at most 16 KB', async () => {
  const env = { DB: seeded() };
  assert.equal((await call(env, '/api/corrections', post(note, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await call(env, '/api/corrections', post(note, {}))).status, 415);
  const big = { ...note, note: '€'.repeat(4000), proposed_value: '€'.repeat(2000) };
  assert.equal((await call(env, '/api/corrections', post(big))).status, 413);
  const r = await call(env, '/api/corrections', post(note));
  assert.equal(r.status, 201);
  const count = env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM corrections').get().n;
  assert.equal(count, 1, 'only the valid JSON correction was stored');
});

test('new corrections are capped per hour, and an optional rate limiter is used when bound', async () => {
  const env = { DB: seeded() };
  for (let i = 0; i < 30; i++) assert.equal((await call(env, '/api/corrections', post(note))).status, 201, `submission ${i + 1}`);
  const r = await call(env, '/api/corrections', post(note));
  assert.equal(r.status, 429);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM corrections').get().n, 30);

  const limited = { DB: seeded(), CORRECTIONS_LIMITER: { limit: async ({ key }) => ({ success: key !== '203.0.113.9' }) } };
  const blocked = await call(limited, '/api/corrections', post(note, { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }));
  assert.equal(blocked.status, 429);
});

test('admin can page through corrections and reject or delete them in bulk', async () => {
  const env = { DB: seeded(), ADMIN_TOKEN: 'test-token' };
  const auth = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
  const ins = env.DB.sqlite.prepare("INSERT INTO corrections (note, kind, created_at) VALUES (?, 'correction', '2026-11-01T00:00:00Z')");
  for (let i = 1; i <= 250; i++) ins.run(`note ${i}`);
  const page1 = await (await call(env, '/api/admin/corrections', { headers: auth })).json();
  assert.equal(page1.length, 200);
  const page2 = await (await call(env, `/api/admin/corrections?before_id=${page1.at(-1).id}`, { headers: auth })).json();
  assert.equal(page2.length, 50);
  assert.equal(page2[0].id, page1.at(-1).id - 1);

  const rej = await (await call(env, '/api/admin/corrections/bulk', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'reject', from_id: 1, to_id: 100 }) })).json();
  assert.equal(rej.changed, 100);
  const ids = Array.from({ length: 150 }, (_, i) => 101 + i);
  const del = await (await call(env, '/api/admin/corrections/bulk', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'delete', ids }) })).json();
  assert.equal(del.changed, 150);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM corrections').get().n, 100);
  assert.equal((await call(env, '/api/admin/corrections/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('admin can mark feed items reviewed', async () => {
  const env = { DB: seeded(), ADMIN_TOKEN: 'test-token' };
  const auth = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
  const ins = env.DB.sqlite.prepare("INSERT INTO feed_items (id, source_id, title, first_seen) VALUES (?, 'hive-feed', ?, ?)");
  ins.run('i1', 'One', '2026-11-01T00:00:00Z');
  ins.run('i2', 'Two', '2026-11-05T00:00:00Z');
  ins.run('i3', 'Three', '2026-11-09T00:00:00Z');
  const one = await (await call(env, '/api/admin/items/reviewed', { method: 'POST', headers: auth, body: JSON.stringify({ ids: ['i3'] }) })).json();
  assert.equal(one.changed, 1);
  const older = await (await call(env, '/api/admin/items/reviewed', { method: 'POST', headers: auth, body: JSON.stringify({ seen_before: '2026-11-06T00:00:00Z' }) })).json();
  assert.equal(older.changed, 2);
  assert.deepEqual(await (await call(env, '/api/admin/items', { headers: auth })).json(), []);
});

test('pages are served with a script-src Content-Security-Policy', async () => {
  const r = await call({ DB: seeded() }, '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
});

test('snapshot: passed deadlines close calls, restricted excerpts and bad links are withheld, stale mentions are rechecked', async () => {
  installCache();
  const env = { DB: seeded() };
  const db = env.DB.sqlite;
  db.exec(`INSERT INTO events (id,type,title,source_url,deadline,call_state,status,origin,created_at)
           VALUES ('past-call','open_call','Past call','https://c.example/','2026-01-15','forthcoming','confirmed','curated','2026-01-01'),
                  ('tbc-call','open_call','TBC call','https://c.example/2','TBC',NULL,'confirmed','curated','2026-01-01')`);
  const now = new Date().toISOString();
  const item = db.prepare(`INSERT INTO feed_items (id, source_id, entity_id, title, link, published, first_seen, excerpt, mentions, meaningful)
                           VALUES (?,?,?,?,?,?,?,?,?,1)`);
  item.run('fa', 'faunalytics-feed', 'faunalytics', 'Study out', 'https://faunalytics.org/s', now, now, 'Text we may not republish', '[]');
  item.run('long', 'hive-feed', 'hive', 'Long link', 'https://x.example/' + 'a'.repeat(5000), now, now, 'x', '[]');
  item.run('podcast', 'our-hen-house-feed', 'our-hen-house', 'The Animal Law Podcast #136', 'https://ourhenhouse.org/alp136', now, now,
    'A conversation about animal law, with The Humane League.', '["animal-law","humane-league"]');
  const snap = await (await call(env, '/api/snapshot')).json();
  const ev = Object.fromEntries(snap.events.map((e) => [e.id, e]));
  assert.equal(ev['past-call'].call_state, 'closed', 'a passed deadline beats a stored override');
  assert.equal(ev['tbc-call'].call_state, 'rolling-or-unstated', 'an unreadable deadline is not "open" for ever');
  const ch = Object.fromEntries(snap.changes.map((c) => [c.id, c]));
  assert.equal(ch.fa.excerpt, null);
  assert.equal(ch.long.link, null);
  assert.deepEqual(ch.podcast.mentions, ['humane-league']);
  assert.equal('source_id' in ch.fa, false, 'change items keep their published shape');
});

test('the refresher status turns degraded when runs stop finishing', async () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const MIN = 60_000;
  assert.equal(refresherHealth({}, now).status, 'waiting');
  assert.equal(refresherHealth({ lastAttempt: { started_at: iso(10 * MIN), finished_at: iso(9 * MIN) }, lastFinishedAt: iso(9 * MIN), lastSourceCheck: iso(9 * MIN) }, now).status, 'ok');
  assert.equal(refresherHealth({ lastAttempt: { started_at: iso(40 * MIN), finished_at: null }, lastFinishedAt: iso(100 * MIN), lastSourceCheck: iso(100 * MIN) }, now).status, 'degraded');
  assert.equal(refresherHealth({ lastAttempt: { started_at: iso(5 * 60 * MIN), finished_at: iso(5 * 60 * MIN) }, lastFinishedAt: iso(5 * 60 * MIN) }, now).status, 'degraded');
  assert.equal(refresherHealth({ lastAttempt: { started_at: iso(MIN), finished_at: iso(MIN) }, lastFinishedAt: iso(MIN), lastSourceCheck: iso(30 * 60 * MIN) }, now).status, 'degraded');

  installCache();
  const env = { DB: seeded() };
  env.DB.sqlite.exec(`INSERT INTO refresh_runs (started_at, trigger) VALUES ('${new Date(Date.now() - 40 * MIN).toISOString()}', 'cron')`);
  const health = await (await call(env, '/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.refresher.status, 'degraded');
  const snap = await (await call(env, '/api/snapshot')).json();
  assert.equal(snap.refresher.status, 'degraded');
});
