// The /api/snapshot contract with Movement Match, which pulls this site's snapshot hourly and keeps each entity's
// names, kinds and tags (movement-match src/refdata.ts trimAmm; its src/core/funnel-schema.ts INTERVENTION_TYPES
// mirrors our intervention tags in snake_case). A change here needs a matching change there.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ENUMS, ROOT } from '../scripts/lib/seed.mjs';
import { createD1, ensureStaticBundle, installCache, makeCtx } from './helpers/d1.js';
import { parseFeed } from '../src/lib/feeds.js';

// movement-match INTERVENTION_TYPES, minus its own three (technology, wild_animal_welfare, other), in our kebab-case.
const MM_INTERVENTIONS = ['alt-proteins', 'capacity-building', 'careers-talent', 'certification-standards', 'corporate-campaigns',
  'data-tools', 'diet-change', 'direct-action', 'education', 'farm-practices', 'grantmaking', 'humane-slaughter', 'investigations',
  'legislation-policy', 'litigation', 'open-rescue', 'producer-engagement', 'protest', 'public-awareness', 'research', 'sanctuary'];

// The fields trimAmm reads, and what it accepts.
function checkEntity(e) {
  const where = e?.id;
  assert.equal(typeof e.id, 'string', where);
  assert.equal(typeof e.name, 'string', where);
  assert.ok(ENUMS.kind.includes(e.kind), `${where}: kind ${e.kind}`);
  assert.ok(ENUMS.status.includes(e.status), `${where}: status ${e.status}`);
  assert.ok(ENUMS.section.includes(e.section), `${where}: section ${e.section}`);
  assert.ok(ENUMS.approach.includes(e.approach), `${where}: approach ${e.approach}`);
  for (const [k, allowed] of [['interventions', ENUMS.interventions], ['species', ENUMS.species], ['categories', ENUMS.categories]]) {
    assert.ok(Array.isArray(e[k]), `${where}: ${k}`);
    assert.ok(e[k].length <= 30, `${where}: ${k} is cut to 30 by trimAmm`);
    for (const v of e[k]) assert.ok(allowed.includes(v), `${where}: ${k} ${v}`);
  }
  assert.ok(e.categories.length >= 1, `${where}: at least one category`);
  assert.ok(e.website === null || /^https?:\/\//.test(e.website), `${where}: website`);
}

const pick = (e) => ({ id: e.id, name: e.name, kind: e.kind, status: e.status, section: e.section, approach: e.approach,
  interventions: e.interventions, species: e.species, categories: e.categories, website: e.website });

test('our intervention tags are exactly the ones Movement Match mirrors', () => {
  assert.deepEqual([...ENUMS.interventions].sort(), [...MM_INTERVENTIONS].sort());
});

test('the built snapshot gives Movement Match the entity fields it reads, with known values', () => {
  const snap = JSON.parse(fs.readFileSync(`${ROOT}/public/snapshot.json`, 'utf8'));
  assert.equal(typeof snap.generated_at, 'string');
  assert.ok(snap.entities.length > 100);
  for (const e of snap.entities) checkEntity(e);
});

let worker;
before(async () => {
  ensureStaticBundle();
  ({ default: worker } = await import('../src/index.js'));
});

test('/api/snapshot serves the same entity fields as the built snapshot, well under the 4 MB Movement Match accepts', async () => {
  installCache();
  const env = { DB: createD1().load('db/schema.sql').load('db/seed.sql') };
  const ctx = makeCtx();
  const res = await worker.fetch(new Request('https://amm.test/api/snapshot'), env, ctx);
  await ctx.settle();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const text = await res.text();
  assert.ok(Buffer.byteLength(text) < 4_000_000);
  const live = JSON.parse(text);
  assert.ok(live.generated_at);
  for (const e of live.entities) checkEntity(e);
  const built = JSON.parse(fs.readFileSync(`${ROOT}/public/snapshot.json`, 'utf8'));
  assert.deepEqual(live.entities.map(pick), built.entities.map(pick));
});

// One hostile or merely wordy feed must not be able to push the snapshot past what Movement Match accepts.
test('no feed content can push /api/snapshot past 4 MB', async () => {
  const snapshotBytes = async (db) => {
    installCache();
    const ctx = makeCtx();
    const res = await worker.fetch(new Request('https://amm.test/api/snapshot'), { DB: db }, ctx);
    await ctx.settle();
    assert.equal(res.status, 200);
    const text = await res.text();
    return { bytes: Buffer.byteLength(text), changes: JSON.parse(text).changes.length };
  };
  const seeded = () => createD1().load('db/schema.sql').load('db/seed.sql');
  const now = Date.now();
  const store = (db, rows) => {
    const source = db.sqlite.prepare("SELECT id, entity_id FROM sources WHERE kind='feed' AND reuse='full' ORDER BY id LIMIT 1").get();
    const ins = db.sqlite.prepare(`INSERT INTO feed_items (id, source_id, entity_id, title, link, published, first_seen, excerpt, signal, species, mentions, meaningful)
      VALUES (?,?,?,?,?,?,?,?,'report','["farmed-fish"]','[]',1)`);
    rows.forEach((r, k) => {
      const at = new Date(now - k * 60_000).toISOString();
      ins.run(`item-${k}`, source.id, source.entity_id, r.title, r.link, at, at, r.excerpt);
    });
  };

  // A feed under the 400 KB read cap whose every field is packed with control characters (6 bytes each in
  // JSON), served with new guids every day until it holds all 400 places, interleaved with items as large as
  // the parser allows in ordinary text.
  const ctl = (n) => '&#1;'.repeat(n);
  const hostile = '<rss><channel>' + Array.from({ length: 25 }, (_, i) =>
    `<item><title>T${i}${ctl(400)}</title><link>https://e.example/${ctl(1980)}</link><description>${ctl(600)}</description></item>`).join('') + '</channel></rss>';
  assert.ok(hostile.length < 400_000);
  const parsed = parseFeed(hostile).items;
  const large = { title: '€'.repeat(300), link: 'https://e.example/' + 'a'.repeat(1980), excerpt: '€'.repeat(400) };
  const db = seeded();
  store(db, Array.from({ length: 400 }, (_, k) => (k % 2 ? parsed[k % parsed.length] : large)));
  const fromFeeds = await snapshotBytes(db);
  assert.ok(fromFeeds.bytes < 4_000_000, `${fromFeeds.bytes} bytes`);

  // Rows stored before control characters were dropped: the snapshot stops adding changes at its byte budget.
  const raw = seeded();
  const c1 = '\u0001';
  store(raw, Array.from({ length: 400 }, () => ({ title: c1.repeat(300), link: 'https://e.example/' + c1.repeat(1980), excerpt: c1.repeat(400) })));
  const fromOldRows = await snapshotBytes(raw);
  assert.ok(fromOldRows.bytes < 4_000_000, `${fromOldRows.bytes} bytes`);
  assert.ok(fromOldRows.changes < 400, 'the oldest changes are left out once the budget is used');
});
