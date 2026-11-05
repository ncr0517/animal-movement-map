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
