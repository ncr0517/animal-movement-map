// The /api/snapshot contract with Movement Match, which pulls this site's snapshot hourly and keeps each entity's
// names, kinds and tags (movement-match src/refdata.ts trimAmm; its src/core/funnel-schema.ts INTERVENTION_TYPES
// mirrors our intervention tags in snake_case). A change here needs a matching change there.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ENUMS, ROOT } from '../scripts/lib/seed.mjs';
import { createD1, ensureStaticBundle, installCache, makeCtx } from './helpers/d1.js';

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
