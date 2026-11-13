// The seed build (scripts/lib/seed.mjs): inputs, reconciliation, overrides, outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, rootOf, readInputs, buildSeed, seedSql, staticSnapshot, seedCounts, shrinkProblems } from '../scripts/lib/seed.mjs';

// ---- Minimal fixtures --------------------------------------------------------------------------------
const src = [{ url: 'https://example.org/about', accessed: '2026-11-05' }];
const ent = (id, extra = {}) => ({ id, name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), kind: 'organisation', categories: ['advocacy-campaigns'], sources: src, ...extra });
const grant = (id, extra = {}) => ({
  id, type: 'grant_awarded', title: `Grant ${id}`, summary: `Summary of ${id}`, event_date: '2026-03', accessed: '2026-11-05',
  source_url: 'https://funder.example/grants', amount: 1000, currency: 'USD', funder_id: 'big-funder', recipient_id: 'small-charity',
  entity_ids: ['big-funder', 'small-charity'], status: 'confirmed', ...extra,
});
const build = (events, { entities = [ent('big-funder', { kind: 'funder', categories: ['funding'] }), ent('small-charity')], overrides = {} } = {}) =>
  buildSeed({ entityFiles: [{ name: 'test-entities.json', dir: 'research', records: entities }], eventFiles: [{ name: 'test-events.json', dir: 'research', records: events }], overrides });

// ---- Paths and inputs ----------------------------------------------------------------------------------
test('the build finds the repository root on every platform', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package.json')), ROOT);
  assert.ok(fs.existsSync(path.join(ROOT, 'data/research')), ROOT);
  const spaced = path.join(os.tmpdir(), 'a b', 'checkout');
  assert.equal(path.resolve(rootOf(pathToFileURL(path.join(spaced, 'scripts', 'lib', 'seed.mjs')).href)), path.resolve(spaced));
});

test('an input file that does not parse stops the build instead of shrinking the directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amm-build-'));
  try {
    fs.mkdirSync(path.join(dir, 'data/research'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/research/x-entities.json'), '[{"id":"a","name":"A"},]');
    fs.writeFileSync(path.join(dir, 'data/research/x-events.json'), '[]');
    assert.throws(() => readInputs(dir), /x-entities\.json is not valid JSON/);
    fs.writeFileSync(path.join(dir, 'data/research/x-entities.json'), '{"id":"a"}');
    assert.throws(() => readInputs(dir), /must be a JSON array/);
    fs.rmSync(path.join(dir, 'data/research/x-entities.json'));
    assert.throws(() => readInputs(dir), /No \*-entities\.json files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a build that drops many entities or events is refused', () => {
  const counts = (researched, events, sections = { aquatic: 39, movement: researched - 39 }) => ({ entities: researched + 18, researched, events, sections });
  assert.deepEqual(shrinkProblems(counts(99, 104), counts(98, 103)), []);
  assert.equal(shrinkProblems(counts(99, 104), counts(55, 104)).length, 2, 'the total and the section that lost them');
  assert.equal(shrinkProblems(counts(99, 104), counts(99, 80)).length, 1);
  assert.deepEqual(shrinkProblems(null, counts(40, 1)), []);
  const r = build([], { entities: [ent('a-org'), ent('b-org', { name: "O'Brien Trust" })] });
  const sql = seedSql(r, '2026-11-12T00:00:00.000Z') + "INSERT INTO entities (id,name,kind,parent_id,primary_category,section,status,profile,stub,last_checked,updated_at) VALUES ('s','S','funder',NULL,'funding','funding','unclear','{\"x\":\"a,1,NULL,''b'');\"}',1,NULL,'2026-11-12');\n";
  assert.deepEqual(seedCounts(sql), { entities: 3, researched: 2, sections: { test: 2 }, events: 0 });
});

test('a build without one research file is refused, even though records keep its entries as stubs', () => {
  const committed = seedCounts(fs.readFileSync(path.join(ROOT, 'db/seed.sql'), 'utf8'));
  for (const mode of ['deleted', 'emptied']) {
    const inputs = readInputs(ROOT);
    inputs.entityFiles = mode === 'deleted'
      ? inputs.entityFiles.filter((f) => f.name !== 'aquatic-entities.json')
      : inputs.entityFiles.map((f) => (f.name === 'aquatic-entities.json' ? { ...f, records: [] } : f));
    const next = seedCounts(seedSql(buildSeed(inputs), '2026-11-13T00:00:00.000Z'));
    assert.ok(next.entities >= committed.entities * 0.9, 'the row count alone would not have caught it');
    assert.ok(shrinkProblems(committed, next).length > 0, `aquatic-entities.json ${mode}`);
  }
  assert.deepEqual(shrinkProblems(committed, seedCounts(seedSql(buildSeed(readInputs(ROOT)), '2026-11-13T00:00:00.000Z'))), []);
});

// ---- Grant reconciliation --------------------------------------------------------------------------------
test('two grants with the same amount and a year-only date are both kept', () => {
  const r = build([
    grant('g-direct-work', { event_date: '2026', notes: 'record id recX4eqj70gpLcdgr' }),
    grant('g-wild-caught', { event_date: '2026', summary: 'Different purpose', notes: 'record id rece7Ic0C8vO95CuU' }),
  ]);
  assert.ok(r.events.has('g-direct-work') && r.events.has('g-wild-caught'));
  assert.deepEqual(r.merges.filter((m) => m.startsWith('event')), []);
});

test('grants with distinct funder record ids are never merged or disputed, even in the same month', () => {
  const r = build([
    grant('g1', { notes: 'record id recAAAAAAAAAAAAAA' }),
    grant('g2', { amount: 2000, notes: 'record id recBBBBBBBBBBBBBB' }),
    grant('g3', { notes: 'record id recCCCCCCCCCCCCCC' }),
  ]);
  assert.equal(r.events.size, 3);
  for (const ev of r.events.values()) { assert.equal(ev.status, 'confirmed'); assert.deepEqual(ev.conflicts_with, []); }
});

test('same funder, recipient, month and amount is a warning, not a deletion', () => {
  const r = build([grant('ga'), grant('gb', { source_url: 'https://recipient.example/news', title: 'Another report' })]);
  assert.equal(r.events.size, 2);
  assert.ok(r.warnings.some((w) => /Possible duplicate grants kept separate: ga, gb/.test(w)));
});

test('an unknown amount is not a conflict; different amounts are a warning, and a person can mark a dispute', () => {
  const r = build([grant('ta'), grant('tb', { amount: null, title: 'B' })]);
  assert.equal(r.events.get('ta').status, 'confirmed');
  assert.equal(r.events.get('tb').status, 'confirmed');

  // Two real grants: general support and a project, to one recipient in one month. Both stay as they are (and
  // in the Funding totals) until a person says otherwise.
  const two = build([
    grant('g-general', { amount: 2_000_000, event_date: '2023-11', title: 'General support' }),
    grant('g-project', { amount: 500_000, event_date: '2023-11', title: 'Project grant' }),
  ]);
  for (const id of ['g-general', 'g-project']) {
    assert.equal(two.events.get(id).status, 'confirmed', id);
    assert.deepEqual(two.events.get(id).conflicts_with, [], id);
  }
  assert.ok(two.warnings.some((w) => /Possible conflicting grant reports kept as they are: g-general \(2000000 USD\), g-project \(500000 USD\)/.test(w)));

  const marked = build([grant('ca'), grant('cb', { amount: 1500, title: 'B' })], { overrides: { events: {
    ca: { status: 'disputed', conflicts_with: ['cb'], _why: 'one grant, two reports' },
    cb: { status: 'disputed', conflicts_with: ['ca'], _why: 'one grant, two reports' },
  } } });
  assert.deepEqual(marked.events.get('cb').conflicts_with, ['ca']);
  assert.equal(marked.events.get('cb').status, 'disputed');
  assert.equal(marked.events.get('ca').status, 'disputed');
});

test('same_as is followed through records already merged: two records naming each other become one, and chains resolve', () => {
  const call = (id, extra = {}) => ({ id, type: 'open_call', title: `Call ${id}`, source_url: `https://f.example/${id}`, accessed: '2026-11-05', ...extra });
  const mutual = build([call('call-one', { same_as: 'call-two' }), call('call-two', { same_as: 'call-one' })]);
  assert.deepEqual([...mutual.events.keys()], ['call-two']);
  assert.match(mutual.events.get('call-two').notes, /Also reported at https:\/\/f\.example\/call-one/);

  const viaOverride = build([call('call-one', { same_as: 'call-two' }), call('call-two')], { overrides: { events: { 'call-two': { same_as: 'call-one' } } } });
  assert.deepEqual([...viaOverride.events.keys()], ['call-two']);

  const chain = build([call('b', { same_as: 'c' }), call('c', { same_as: 'd' }), call('a', { same_as: 'b' }), call('d')]);
  assert.deepEqual([...chain.events.keys()], ['d']);
  assert.deepEqual(chain.merges.filter((m) => m.startsWith('event')), ['event b → c (same_as)', 'event c → d (same_as)', 'event a → d (same_as)']);
  assert.deepEqual(chain.warnings.filter((w) => /same_as/.test(w)), []);

  const unknown = build([call('x', { same_as: 'nowhere' })]);
  assert.ok(unknown.events.has('x'));
  assert.ok(unknown.warnings.some((w) => /event x: same_as "nowhere" is not a known event/.test(w)));
});

test('same_as merges two records and keeps both sources; identical records merge on their own', () => {
  const r = build([
    grant('keep-me', { deadline: null }),
    grant('dupe', { same_as: 'keep-me', source_url: 'https://recipient.example/thanks', entity_ids: ['small-charity', 'third-charity'] }),
    grant('copy-a', { source_url: 'https://x.example/', title: 'Copy', summary: 'Same', event_date: '2025-01' }),
    grant('copy-b', { source_url: 'https://x.example/', title: 'Copy', summary: 'Same', event_date: '2025-01' }),
  ], { entities: [ent('big-funder', { kind: 'funder' }), ent('small-charity'), ent('third-charity')], overrides: { events: { dupe: { title: 'Lost?' } } } });
  assert.ok(!r.events.has('dupe') && !r.events.has('copy-b'));
  const keep = r.events.get('keep-me');
  assert.deepEqual(keep.entity_ids.sort(), ['big-funder', 'small-charity', 'third-charity']);
  assert.match(keep.notes, /Also reported at https:\/\/recipient\.example\/thanks/);
  assert.ok(r.warnings.some((w) => /override for event dupe, which was merged into keep-me/.test(w)), 'an override on a merged record is reported, not lost');
});

test('other duplicate records are flagged: same funder and deadline', () => {
  const call = (id, extra) => ({ id, type: 'open_call', title: id, source_url: 'https://f.example/rfp', funder_id: 'big-funder', deadline: '2026-11-18', event_date: '2026-10-06', accessed: '2026-11-05', ...extra });
  const r = build([call('c1'), call('c2', { source_url: 'https://news.example/' })]);
  assert.ok(r.warnings.some((w) => /Possible duplicate records kept separate: c1, c2/.test(w)));
});

// ---- Fields ----------------------------------------------------------------------------------------------
test('currency must be a 3-letter code and deadlines must be YYYY-MM-DD dates', () => {
  const r = build([
    grant('bad-cur', { currency: '<img src=x onerror="alert(1)">' }),
    grant('low-cur', { currency: 'gbp', title: 'gbp' }),
    { id: 'call-tbc', type: 'open_call', title: 'TBC', source_url: 'https://c.example/', deadline: 'TBC', accessed: '2026-11-05' },
    { id: 'call-month', type: 'open_call', title: 'Month', source_url: 'https://c.example/2', deadline: '2026-11', accessed: '2026-11-05' },
  ], { overrides: { events: { 'low-cur': { currency: 'not a code' } } } });
  assert.equal(r.events.get('bad-cur').currency, null);
  assert.equal(r.events.get('low-cur').currency, 'GBP');
  assert.equal(r.events.get('call-tbc').deadline, null);
  assert.equal(r.events.get('call-month').deadline, null);
  assert.ok(r.warnings.some((w) => /override low-cur: bad currency/.test(w)));
});

test("an event's last checked date is its own accessed date, never the build date", () => {
  const r = build([grant('dated'), grant('undated', { accessed: undefined, amount: 5, title: 'u' })]);
  assert.equal(r.events.get('dated').last_checked, '2026-11-05');
  assert.equal(r.events.get('undated').last_checked, null);
  assert.ok(r.warnings.some((w) => /undated: no accessed date/.test(w)));
});

test('entity overrides are cleaned like research records and their aliases are indexed', () => {
  const r = build([grant('g', { funder_id: 'ukri-funder', entity_ids: ['ukri-funder'] })], {
    overrides: { entities: {
      'ukri-funder': { aliases: ['UFAW', 'Universities Federation for Animal Welfare'], kind: 'fundr', categories: ['fundng'] },
      'small-charity': { name: 'Small Charity International', species: ['shrimp', 'dragons'] },
    } },
  });
  const funder = r.entities.get('ukri-funder');
  assert.equal(funder.kind, 'funder', 'a typo in kind is not published');
  assert.deepEqual(funder.categories, ['funding']);
  assert.deepEqual(r.entities.get('small-charity').species, ['crustaceans']);
  const forms = r.mentionAliases.map((a) => `${a.form}|${a.entity_id}`);
  assert.ok(forms.includes('ufaw|ukri-funder'));
  assert.ok(forms.includes('universities federation for animal welfare|ukri-funder'));
  assert.ok(forms.includes('small charity international|small-charity'));
  assert.ok(r.warnings.some((w) => /bad kind "fundr"/.test(w)));
});

test('mention names keep generic words, keep their capitals, and leave out names two entities share', () => {
  const r = build([], { entities: [
    ent('animal-law-foundation', { name: 'The Animal Law Foundation' }),
    ent('aquatic-animal-alliance', { name: 'Aquatic Animal Alliance', aliases: ['AAA', 'ALPS'] }),
    ent('animal-advocacy-africa', { name: 'Animal Advocacy Africa', aliases: ['AAA', 'ALPS'] }),
  ] });
  const forms = Object.fromEntries(r.mentionAliases.map((a) => [a.form, a]));
  assert.equal(forms['animal law foundation'].alias, 'The Animal Law Foundation');
  assert.equal(forms['animal law'], undefined);
  assert.equal(forms.alps, undefined, 'a name two entities share is not used');
  assert.equal(forms.aaa, undefined, 'names under 4 characters are not stored');
});

test('headline-only feeds are marked on their source rows', () => {
  const r = build([], { entities: [ent('news-site', { website: 'https://news.example/', feeds: [{ url: 'https://news.example/feed', verified: true, reuse: 'headline' }] })] });
  const feed = r.sources.find((s) => s.kind === 'feed');
  assert.equal(feed.reuse, 'headline');
  assert.match(seedSql(r, '2026-11-12T00:00:00.000Z'), /'https:\/\/news\.example\/feed','feed','daily','public','headline'\)/);
});

test('the static snapshot closes calls whose deadline has passed, whatever the override says', () => {
  const r = build([{ id: 'late', type: 'open_call', title: 'Late', source_url: 'https://c.example/', deadline: '2027-09-23', accessed: '2026-11-05' }],
    { overrides: { events: { late: { call_state: 'forthcoming' } } } });
  const before = staticSnapshot(r, '2027-09-01T00:00:00.000Z').events[0];
  const after = staticSnapshot(r, '2027-10-01T00:00:00.000Z').events[0];
  assert.equal(before.call_state, 'forthcoming');
  assert.equal(after.call_state, 'closed');
  assert.equal(before._sameAs, undefined, 'build-internal fields are not published');
});

// ---- The real research data ------------------------------------------------------------------------------
test('the research data builds without losing the second Shrimp Welfare Project grant or listing calls twice', () => {
  const r = buildSeed(readInputs(ROOT));
  assert.ok(r.events.has('awf-shrimp-welfare-project-2026-q1-direct-work'));
  assert.ok(r.events.has('awf-shrimp-welfare-project-2026-q1-wild-caught'));
  const calls = (url) => [...r.events.values()].filter((e) => e.type === 'open_call' && e.source_url === url);
  assert.equal(calls('https://www.fishwelfareinitiative.org/post/rfp-india').length, 1);
  assert.ok(!r.events.has('aim-animal-incubation-round-call-2026'));
  assert.ok([...r.events.values()].every((e) => e.last_checked === '2026-11-05'), 'events carry their research date');
  assert.deepEqual(r.roundTotals.sort(), ['ace-movement-grants-round-11-2026', 'wai-2026-research-grants']);
  assert.equal(r.events.get('ace-movement-grants-round-11-2026').event_date, '2026-06');
  assert.deepEqual(r.sources.filter((s) => s.reuse === 'headline').map((s) => s.entity_id).sort(), ['animal-charity-evaluators', 'faunalytics', 'sentient-media']);
  assert.deepEqual(r.warnings.filter((w) => !/^alias "AAA"/.test(w)), [], 'no new warnings in the research data');
});
