import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, analyseItem, normalizeName, detectMentions, cleanLink } from '../src/lib/feeds.js';

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

test('links are http(s) and bounded, far-future dates are dropped', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  const long = 'https://example.org/' + 'a'.repeat(16000);
  const xml = `<rss><channel>
    <item><title>Long</title><link>${long}</link><guid>${'g'.repeat(5000)}</guid><pubDate>Thu, 01 Jan 2099 00:00:00 GMT</pubDate></item>
    <item><title>Script</title><link>javascript:alert(1)</link><pubDate>Wed, 11 Nov 2026 09:00:00 GMT</pubDate></item>
    <item><title>Fine</title><link>https://example.org/ok</link><pubDate>Thu, 12 Nov 2026 20:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const [a, b, c] = parseFeed(xml, { now }).items;
  assert.equal(a.link, null);
  assert.equal(a.guid.length, 5000, 'the guid is only hashed, so it is kept whole and the item keeps its id');
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

// ---- Review of PR #1 (2026-11-13) ---------------------------------------------------------------------
test('a hostile prologue or unclosed tags cannot make parsing take long', () => {
  // Each of these took between a second and minutes with the old patterns; a linear scan takes a few ms.
  const item = (inner) => `<rss><item><title>a</title><description>${inner}</description></item>`;
  const bodies = {
    comments: '<!--a-->'.repeat(26) + '!',
    instructions: '<?a?>'.repeat(26) + '!',
    'unclosed items': '<rss>' + '<item '.repeat(50_000),
    'unclosed entries': '<feed>' + '<entry '.repeat(50_000),
    'unclosed titles': '<rss><item>' + '<title '.repeat(50_000) + '</item>',
    'unclosed guids': '<rss><item><title>a</title>' + '<guid>'.repeat(50_000) + '</item>',
    'unclosed CDATA': item('<![CDATA['.repeat(25_000)),
    'unclosed tags': item('<![CDATA[' + '<'.repeat(350_000) + ']]>'),
    'unclosed scripts': item('&lt;script'.repeat(30_000)),
  };
  for (const [name, body] of Object.entries(bodies)) {
    const started = performance.now();
    parseFeed(body);
    assert.ok(performance.now() - started < 150, `${name}: ${Math.round(performance.now() - started)} ms`);
  }
  assert.equal(parseFeed('<!--a-->'.repeat(40) + '!').valid, false);
  assert.equal(parseFeed('<!DOCTYPE rss [ <!ENTITY q "]"> ]>\n<rss><channel><item><title>A</title></item></channel></rss>').valid, true);
});

test('an item with no guid is known by its link as written, so items that share a title stay apart', () => {
  const xml = `<rss><channel>
    <item><title>Weekly update</title><link>/posts/1</link></item>
    <item><title>Weekly update</title><link>/posts/2</link></item>
    <item><title>Weekly update</title><link>https://example.org/posts/3</link></item>
    <item><title>Weekly update</title></item>
  </channel></rss>`;
  const items = parseFeed(xml).items;
  assert.deepEqual(items.map((i) => i.guid), ['/posts/1', '/posts/2', 'https://example.org/posts/3', 'Weekly update']);
  assert.deepEqual(items.map((i) => i.link), [null, null, 'https://example.org/posts/3', null], 'only a usable link is shown');
});

test('control characters and unpaired surrogates are dropped, and links are printable ASCII', () => {
  // 0x81 and 0x9D are the C1 codes Windows-1252 leaves undefined; the others in 0x80-0x9F are punctuation.
  const junk = '&#1;&#x1F;&#127;&#x81;&#157;&#xD800;\u0002\u009d';
  const xml = `<rss><channel><item><title>Ti${junk}tle${'😀'.repeat(200)}</title><link>https://example.org/${'&#1;'.repeat(50)}</link>
    <description>Ex${junk}cerpt</description></item>
    <item><title>Two</title><link>https://example.org/café?q=1</link></item></channel></rss>`;
  const [a, b] = parseFeed(xml).items;
  assert.ok(a.title.startsWith('Title😀'), JSON.stringify(a.title.slice(0, 10)));
  assert.equal(a.title.length, 300 - 1, 'the clip does not cut an emoji in half');
  assert.equal(a.excerpt, 'Excerpt');
  assert.equal(a.link, 'https://example.org/', 'the decoded control characters are gone from the link');
  assert.equal(b.link, 'https://example.org/caf%C3%A9?q=1');
  assert.equal(/\\u[0-9a-f]{4}/.test(JSON.stringify(a)), false, 'nothing is written as a 6-byte JSON escape');
  assert.equal(cleanLink('https://example.org/\u0001'), null);
  assert.equal(cleanLink('https://example.org/\ud800'), null);
  assert.equal(cleanLink('https://Bücher.example/x'), 'https://xn--bcher-kva.example/x');
});

test('Windows-1252 punctuation written as C1 codes is read as browsers read it, so the words and mentions around it stay', () => {
  const aliases = [['shrimp welfare project', 'shrimp-welfare-project', 'Shrimp Welfare Project'], ['hive', 'hive', 'Hive']];
  const feed = (title, body) => parseFeed(`<rss><channel><item><title>${title}</title><guid>g</guid>
    <description>${body}</description></item></channel></rss>`).items[0];
  // Decimal, hex, escaped inside HTML (decoded on the second pass), and the raw character.
  for (const apos of ['&#146;', '&#x92;', '&amp;#146;', '\u0092']) {
    const item = feed(`Shrimp Welfare Project${apos}s new report &#150; a review`, `Hive${apos}s survey of shrimp farms`);
    assert.equal(item.title, 'Shrimp Welfare Project’s new report – a review', apos);
    assert.equal(item.excerpt, 'Hive’s survey of shrimp farms', apos);
    assert.deepEqual(analyseItem(item, aliases, 'x').mentions, ['shrimp-welfare-project', 'hive'], apos);
    assert.equal(/\\u[0-9a-f]{4}/.test(JSON.stringify(item)), false, 'still nothing written as a JSON escape');
  }
  // Dashes and ellipses with no spaces around them keep the words apart.
  const joined = feed('Report&#150;Shrimp Welfare Project', 'Hive&#133;Shrimp Welfare Project');
  assert.equal(joined.title, 'Report–Shrimp Welfare Project');
  assert.equal(joined.excerpt, 'Hive…Shrimp Welfare Project');
  assert.deepEqual(analyseItem(joined, aliases, 'x').mentions.sort(), ['hive', 'shrimp-welfare-project']);

  // Every code from 0x80 to 0x9F decodes as Windows-1252 does; the five it leaves undefined are dropped.
  const decoder = new TextDecoder('windows-1252');
  for (let code = 0x80; code <= 0x9f; code++) {
    const expected = decoder.decode(Uint8Array.of(code));
    const want = expected.charCodeAt(0) <= 0x9f ? '' : expected;
    assert.equal(feed(`a&#${code};b`, 'x').title, `a${want}b`, code.toString(16));
  }
});
