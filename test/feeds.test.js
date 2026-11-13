import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, analyseItem, normalizeName, detectMentions } from '../src/lib/feeds.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>X</title>
<item><title><![CDATA[Applications now open for our 2027 Movement Grants]]></title>
<link>https://example.org/a</link><guid>a1</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
<description>&lt;p&gt;We fund work on &amp;amp; for shrimp and fish welfare.&lt;/p&gt;</description></item>
<item><title>Meet our new volunteer coordinator</title><link>https://example.org/b</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Y</title>
<entry><title>Washington bans octopus farming</title><link rel="alternate" href="https://example.org/c"/>
<id>tag:c</id><updated>2025-04-01T00:00:00Z</updated><summary>The law passed.</summary></entry></feed>`;

test('parses RSS items with CDATA and entities', () => {
  const f = parseFeed(RSS);
  assert.equal(f.format, 'rss');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'Applications now open for our 2027 Movement Grants');
  assert.equal(f.items[0].published, '2026-11-03T10:00:00.000Z');
  assert.match(f.items[0].excerpt, /shrimp and fish/);
  assert.ok(!f.items[0].excerpt.includes('<p>'));
});

test('parses Atom entries and alternate links', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.format, 'atom');
  assert.equal(f.items[0].link, 'https://example.org/c');
  assert.equal(f.items[0].guid, 'tag:c');
});

test('classifies open calls, legal news and noise', () => {
  const [a, b] = parseFeed(RSS).items;
  const r1 = analyseItem(a, [], null);
  assert.equal(r1.signal, 'open_call');
  assert.equal(r1.meaningful, 1);
  assert.ok(r1.species.includes('crustaceans'));
  const r2 = analyseItem(b, [], null);
  assert.equal(r2.meaningful, 0);
  const r3 = analyseItem(parseFeed(ATOM).items[0], [], null);
  assert.equal(r3.signal, 'legal');
  assert.ok(r3.species.includes('cephalopods'));
});

test('normalizes names for reconciliation', () => {
  assert.equal(normalizeName('The Humane League'), 'humane league');
  assert.equal(normalizeName('Albert Schweitzer Stiftung e.V.'), 'albert schweitzer stiftung');
  assert.equal(normalizeName('Fish & Welfare'), 'fish and welfare');
});

test('detects mentions of other entities, ignoring short acronyms and self', () => {
  const idx = [['shrimp welfare project', 'swp'], ['thl', 'thl'], ['aquatic life institute', 'ali']];
  const m = detectMentions('Shrimp Welfare Project and THL partner with Aquatic Life Institute', idx, 'ali');
  assert.deepEqual(m, ['swp']);
});

test('open calls beat generic funding; plural fishes is tagged', () => {
  const r = analyseItem({ title: 'Open Call: Funding New Ideas to Improve the Welfare of Farmed Fishes in India', excerpt: '' }, [], null);
  assert.equal(r.signal, 'open_call');
  assert.ok(r.species.includes('farmed-fish'));
});

test('generic posts are not surfaced as meaningful', () => {
  for (const title of ['The Puppy and the Pond: Reflections on my internship', 'We are hiring a programme manager', 'Thank you to our volunteers']) {
    assert.equal(analyseItem({ title, excerpt: '' }, [], null).meaningful, 0, title);
  }
});

// ---- Audit 2026-11-10 ---------------------------------------------------------------------------------
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('format comes from the root element, not from tags quoted inside items', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>One</title><description><![CDATA[<p>An Atom document has a <feed> root and <entry> children.</p>]]></description></item>
    <item><title>Two</title></item></channel></rss>`;
  const f = parseFeed(rss);
  assert.equal(f.format, 'rss');
  assert.equal(f.items.length, 2);
  assert.equal(f.valid, true);
});

test('an HTML page that merely contains "<rss" is not a valid feed', () => {
  const f = parseFeed('<!doctype html><html><body><rss-widget src="x"></rss-widget></body></html>');
  assert.equal(f.valid, false);
  assert.equal(f.items.length, 0);
});

test('a feed after a BOM, stylesheet instruction, comment and doctype is still recognised', () => {
  const f = parseFeed('﻿<?xml version="1.0"?>\n<?xml-stylesheet href="s.xsl"?>\n<!-- c -->\n<!DOCTYPE rss>\n<rss><channel><item><title>A</title></item></channel></rss>');
  assert.equal(f.valid, true);
  assert.equal(f.items.length, 1);
});

test('links are http(s) and bounded, guids are clipped, far-future dates are dropped', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  const long = 'https://example.org/' + 'a'.repeat(16000);
  const xml = `<rss><channel>
    <item><title>Long</title><link>${long}</link><guid>${'g'.repeat(5000)}</guid><pubDate>Thu, 01 Jan 2099 00:00:00 GMT</pubDate></item>
    <item><title>Script</title><link>javascript:alert(1)</link><pubDate>Wed, 11 Nov 2026 09:00:00 GMT</pubDate></item>
    <item><title>Fine</title><link>https://example.org/ok</link><pubDate>Thu, 12 Nov 2026 20:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const [a, b, c] = parseFeed(xml, { now }).items;
  assert.equal(a.link, null);
  assert.equal(a.guid.length, 500);
  assert.equal(a.published, null);
  assert.equal(b.link, null);
  assert.equal(b.published, '2026-11-11T09:00:00.000Z');
  assert.equal(c.link, 'https://example.org/ok');
  assert.equal(c.published, '2026-11-12T20:00:00.000Z');
});

// The alias rows the build writes to db/seed.sql (the same rows the refresher loads).
function seedAliasIndex() {
  const sql = fs.readFileSync(fileURLToPath(new URL('../db/seed.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const unq = (s) => s.replace(/''/g, "'");
  return [...sql.matchAll(/^INSERT OR IGNORE INTO aliases \(alias_norm,alias,entity_id\) VALUES \('((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)'\);$/gm)]
    .map((m) => [unq(m[1]), unq(m[3]), unq(m[2])]);
}

test('ordinary words and phrases are not mentions of entities (seed alias table)', () => {
  const idx = seedAliasIndex();
  assert.ok(idx.length > 100);
  assert.deepEqual(detectMentions('The market is awash with shrimp; companies pull every lever', idx, null), []);
  assert.deepEqual(detectMentions('Join the hive of activity, viva la revolution', idx, null), []);
  assert.deepEqual(detectMentions('The Animal Law Podcast, episode 136', idx, null), []);
  assert.deepEqual(detectMentions("Canada's leading animal law organization", idx, null), []);
  assert.deepEqual(detectMentions('protect sentient crabs and lobsters', idx, null), []);
});

test('real names are still found, including one-word names written as the entity writes them', () => {
  const idx = seedAliasIndex();
  const m = detectMentions('Hive and AWASH join Lever Foundation and The Animal Law Foundation; UFAW and the Universities Federation for Animal Welfare comment', idx, null);
  for (const id of ['hive', 'awash', 'lever', 'animal-law', 'science-for-animal-welfare']) assert.ok(m.includes(id), id);
  assert.ok(detectMentions('Biotechnology and Biological Sciences Research Council funds salmon study', idx, null).includes('bbsrc'));
});

test('rows from the old alias table (lower case, generic words stripped) do not produce false mentions', () => {
  const oldRows = [['animal law', 'animal-law', 'animal law'], ['lever', 'lever', 'lever'], ['hive', 'hive', 'hive'], ['humane league', 'thl', 'humane league']];
  assert.deepEqual(detectMentions('The Animal Law Podcast: pull every lever in the Hive', oldRows, null), []);
  assert.deepEqual(detectMentions('The Humane League wins again', oldRows, null), ['thl']);
});
