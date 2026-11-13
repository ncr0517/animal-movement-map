// The hourly refresher (src/refresh.js) against a local HTTP server and an in-memory D1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createD1 } from './helpers/d1.js';
import { runRefresh } from '../src/refresh.js';

const RSS = (title, extra = '') => `<?xml version="1.0"?><rss><channel><title>t</title>
  <item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><guid>${title}</guid>
  <description>Applications now open: grants for The Animal Law Podcast listeners and shrimp welfare work.${extra}</description></item>
</channel></rss>`;

const hits = [];
let base;
const server = http.createServer((req, res) => {
  hits.push(req.url);
  res.on('error', () => {});
  req.socket.on('error', () => {});
  const path = req.url.split('?')[0];
  if (path === '/ok.xml') return res.end(RSS('Fresh post'));
  if (path === '/trickle.xml') {
    // Headers at once, then one byte every 200 ms for ever.
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.write('<?xml version="1.0"?><rss><channel>');
    const t = setInterval(() => res.write(' '), 200);
    res.on('close', () => clearInterval(t));
    return;
  }
  if (path === '/endless.xml') {
    // A valid start, then an endless body as fast as the client reads it.
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.write('<?xml version="1.0"?><rss><channel><item><title>First</title><guid>f</guid></item>');
    const chunk = '<!-- ' + 'x'.repeat(64 * 1024) + ' -->';
    const pump = () => { while (res.write(chunk)); };
    res.on('drain', pump);
    pump();
    return;
  }
  if (path === '/hang.xml') { res.on('close', () => {}); return; } // never answers
  if (path === '/slow503') { setTimeout(() => { res.statusCode = 503; res.end('busy'); }, 300); return; }
  if (path === '/home') {
    if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304, { etag: '"v1"' }); return res.end(); }
    res.writeHead(200, { etag: '"v1"', 'content-type': 'text/html' });
    return res.end('<html>home</html>');
  }
  if (path === '/headline.xml') return res.end(RSS('Restricted post'));
  res.statusCode = 404;
  res.end();
});

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

function freshDb(sources) {
  const db = createD1().load('db/schema.sql');
  db.sqlite.exec(`INSERT INTO entities (id,name,kind,primary_category,section,status,profile,updated_at,last_checked)
    VALUES ('org','Org','organisation','advocacy-campaigns','movement','active','{}','2026-01-01','2026-06-01'),
           ('animal-law','The Animal Law Foundation','organisation','policy-law','aquatic','active','{}','2026-01-01',NULL)`);
  // An alias row as the old build wrote it (generic word stripped): it must not match "The Animal Law Podcast".
  db.sqlite.exec("INSERT INTO aliases (alias_norm, alias, entity_id) VALUES ('animal law','animal law','animal-law')");
  const ins = db.sqlite.prepare(`INSERT INTO sources (id,entity_id,url,kind,cadence,visibility,reuse,last_checked,etag,consecutive_failures)
    VALUES (?,?,?,?,?,'public',?,?,?,0)`);
  for (const s of sources) ins.run(s.id, s.entity_id ?? 'org', base + s.path, s.kind ?? 'feed', s.cadence ?? 'daily', s.reuse ?? 'full', s.last_checked ?? null, s.etag ?? null);
  return db;
}
const row = (db, id) => ({ ...db.sqlite.prepare('SELECT * FROM sources WHERE id=?').get(id) });
const runs = (db) => db.sqlite.prepare('SELECT * FROM refresh_runs ORDER BY id').all().map((r) => ({ ...r }));

test('a feed that trickles its body times out, is recorded as a failure, and the run finishes', { timeout: 15_000 }, async () => {
  const db = freshDb([
    { id: 'a-trickle', path: '/trickle.xml', last_checked: '2026-01-01T00:00:00.000Z' },
    { id: 'b-ok', path: '/ok.xml', last_checked: '2026-01-02T00:00:00.000Z' },
  ]);
  const started = Date.now();
  const out = await runRefresh({ DB: db }, { timeoutMs: 800 });
  assert.ok(Date.now() - started < 5000, 'the body read is inside the deadline');
  assert.equal(out.sources_checked, 2);
  assert.equal(out.errors, 1);
  const a = row(db, 'a-trickle');
  assert.match(a.error, /Timed out/);
  assert.equal(a.consecutive_failures, 1);
  assert.equal(row(db, 'b-ok').error, null, 'the source behind it was checked too');
  assert.ok(runs(db)[0].finished_at);
});

test('an endless feed body is read only up to the size cap', { timeout: 15_000 }, async () => {
  const db = freshDb([{ id: 'endless', path: '/endless.xml' }]);
  const out = await runRefresh({ DB: db }, { timeoutMs: 5000 });
  assert.equal(out.errors, 0);
  assert.equal(out.new_items, 1);
  assert.equal(row(db, 'endless').error, null);
});

test('a source is claimed before it is fetched, so a killed run cannot keep it at the front of the queue', { timeout: 15_000 }, async () => {
  const db = freshDb([
    { id: 'a-hang', path: '/hang.xml', last_checked: '2026-01-01T00:00:00.000Z' },
    { id: 'b-ok', path: '/ok.xml', last_checked: '2026-01-02T00:00:00.000Z' },
  ]);
  const running = runRefresh({ DB: db }, { timeoutMs: 1500, batch: 1 });
  while (!hits.includes('/hang.xml')) await new Promise((r) => setTimeout(r, 20));
  // The request is in flight: if the platform killed the invocation now, this is what would be left.
  const mid = row(db, 'a-hang');
  assert.notEqual(mid.last_checked, '2026-01-01T00:00:00.000Z');
  assert.equal(mid.consecutive_failures, 1);
  const order = db.sqlite.prepare("SELECT id FROM sources ORDER BY last_checked IS NOT NULL, last_checked ASC").all().map((r) => r.id);
  assert.deepEqual(order, ['b-ok', 'a-hang'], 'the next run starts with the other source');
  await running;
});

test('overlapping runs do not check the same source twice or count one failure twice', { timeout: 15_000 }, async () => {
  hits.length = 0;
  const db = freshDb(['x', 'y', 'z'].map((n) => ({ id: `home-${n}`, path: `/slow503?${n}`, kind: 'homepage', cadence: 'monthly' })));
  const [manual, cron] = await Promise.all([
    runRefresh({ DB: db }, { trigger: 'manual', batch: 10, timeoutMs: 3000 }),
    new Promise((r) => setTimeout(r, 50)).then(() => runRefresh({ DB: db }, { trigger: 'cron', timeoutMs: 3000 })),
  ]);
  assert.equal(hits.filter((h) => h.startsWith('/slow503')).length, 3, 'each URL fetched once');
  assert.equal(manual.sources_checked + cron.sources_checked, 3);
  for (const n of ['x', 'y', 'z']) {
    const r = row(db, `home-${n}`);
    assert.equal(r.consecutive_failures, 1);
    assert.equal(r.error, 'HTTP 503');
  }
});

test("a homepage that answers 304 still refreshes the entity's last checked date", async () => {
  const db = freshDb([{ id: 'org-home', path: '/home', kind: 'homepage', cadence: 'monthly', etag: '"v1"', last_checked: '2026-06-01T00:00:00.000Z' }]);
  await runRefresh({ DB: db });
  const src = row(db, 'org-home');
  assert.equal(src.last_status, 304);
  assert.equal(src.consecutive_failures, 0);
  const ent = db.sqlite.prepare("SELECT last_checked FROM entities WHERE id='org'").get();
  assert.equal(ent.last_checked, src.last_checked);
});

test('headline-only feeds store no excerpt; mentions use the stricter rules', async () => {
  const db = freshDb([{ id: 'news-feed', path: '/headline.xml', reuse: 'headline' }, { id: 'open-feed', path: '/ok.xml' }]);
  await runRefresh({ DB: db });
  const items = db.sqlite.prepare('SELECT source_id, excerpt, signal, mentions FROM feed_items ORDER BY source_id').all().map((r) => ({ ...r }));
  assert.equal(items.length, 2);
  const [news, open] = items;
  assert.equal(news.source_id, 'news-feed');
  assert.equal(news.excerpt, null, 'no excerpt stored for a headline-only source');
  assert.equal(news.signal, 'open_call', 'the excerpt was still used to classify the item');
  assert.match(open.excerpt, /Applications now open/);
  assert.equal(open.mentions, '[]', '"The Animal Law Podcast" is not The Animal Law Foundation');
});

test('a run that crashes part-way is still marked finished', async () => {
  const db = freshDb([{ id: 'feed', path: '/ok.xml' }]);
  db.sqlite.exec('DROP TABLE aliases'); // loading the alias index now throws
  await assert.rejects(runRefresh({ DB: db }));
  const [r] = runs(db);
  assert.ok(r.finished_at, 'finished_at is written in finally');
  assert.equal(r.errors, 1);
});
