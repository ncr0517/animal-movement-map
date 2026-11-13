// Lightweight RSS/Atom parsing and change classification.
// Regex-based on purpose: Workers' free tier allows ~10ms CPU per invocation,
// so we avoid a full XML DOM and cap how much of each feed we read.
//
// Every scan of the document is linear in its length. A span with no closing tag is looked for once, not once
// per opening tag, and no pattern can backtrack across a terminator. (A nested lazy pattern used to take
// seconds of CPU on a 220-byte body, and a body full of unclosed "<item" tags over a second at 360 KB.)

export const MAX_FEED_BYTES = 400_000;
const MAX_ITEMS = 25;
// A link longer than this, or not http(s), is dropped: one feed must not be able to inflate /api/snapshot.
export const MAX_LINK_CHARS = 2000;
// A feed date more than a day ahead is wrong; it is dropped so the item sorts by when we first saw it.
const MAX_FUTURE_MS = 86400_000;

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Each `open` match up to the next `close` match (both global regexes), at most `max` of them. Once a span has
// no closing tag, no later span has one either, so the scan stops there.
function spans(s, open, close, max = Infinity) {
  const out = [];
  let pos = 0;
  while (out.length < max) {
    open.lastIndex = pos;
    const o = open.exec(s);
    if (!o) break;
    close.lastIndex = o.index + o[0].length;
    const c = close.exec(s);
    if (!c) break;
    out.push({ start: o.index, inner: o.index + o[0].length, innerEnd: c.index, end: c.index + c[0].length });
    pos = c.index + c[0].length;
  }
  return out;
}

function replaceSpans(s, open, close, fn) {
  const found = spans(s, open, close);
  if (!found.length) return s;
  let out = '';
  let pos = 0;
  for (const f of found) {
    out += s.slice(pos, f.start) + fn(s.slice(f.inner, f.innerEnd));
    pos = f.end;
  }
  return out + s.slice(pos);
}

export function decodeEntities(s) {
  return replaceSpans(s, /<!\[CDATA\[/g, /\]\]>/g, (inner) => inner)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITY_MAP[n.toLowerCase()] ?? m);
}

// Codes 0x80-0x9F are C1 control characters in Unicode, but in feeds they are almost always Windows-1252
// punctuation: "&#146;" for an apostrophe, "&#150;" for a dash, "&#133;" for an ellipsis, or the same bytes
// carried over from Windows-1252 text read as Latin-1. Browsers read such references as Windows-1252 (HTML's
// numeric character reference rules), and so does this, for references and raw characters alike: deleting them
// would join "Project&#146;s" into "Projects" and lose the mention. The five codes Windows-1252 leaves undefined
// (0x81, 0x8D, 0x8F, 0x90, 0x9D) are still dropped as control characters.
const CP1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

// Control characters (other than tab, newline and carriage return) and unpaired surrogates are not text. JSON
// writes each one as a 6-byte escape, so a feed made of them could inflate /api/snapshot six-fold. (The
// Windows-1252 characters above are ordinary characters, which JSON writes as they are.)
const isJunkCode = (c) => (c < 0x20 && c !== 9 && c !== 10 && c !== 13) || (c >= 0x7f && c <= 0x9f) || (c >= 0xd800 && c <= 0xdfff);
function safeChar(code) {
  const c = CP1252[code] ?? code;
  if (isJunkCode(c)) return '';
  try { return String.fromCodePoint(c); } catch { return ''; }
}
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const LONE_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const dropJunk = (s) => s.replace(CONTROLS, (ch) => safeChar(ch.charCodeAt(0))).replace(LONE_SURROGATES, '');

// The first n UTF-16 units, without cutting a surrogate pair in half.
function clipText(s, n) {
  const t = s.slice(0, n);
  return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t;
}

export function stripTags(s) {
  let text = dropJunk(decodeEntities(decodeEntities(s || '')));
  text = replaceSpans(text, /<script/gi, /<\/script>/gi, () => ' ');
  text = replaceSpans(text, /<style/gi, /<\/style>/gi, () => ' ');
  text = replaceSpans(text, /</g, />/g, (inner) => (inner ? ' ' : '<>')); // a tag; "<>" is not one
  return text.replace(/\s+/g, ' ').trim();
}

// The content of the first <name> or <name attrs> element. The opening tag ends at the first ">" after it; if
// there is none, or no closing tag after it, no later element can match either.
function tag(block, name) {
  const open = new RegExp(`<${name}(?=[\\s>])`, 'i').exec(block);
  if (!open) return null;
  const gt = block.indexOf('>', open.index + open[0].length);
  if (gt < 0) return null;
  const close = new RegExp(`</${name}>`, 'gi');
  close.lastIndex = gt + 1;
  const c = close.exec(block);
  return c ? block.slice(gt + 1, c.index) : null;
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)].map((m) => m[1]);
  let best = null;
  for (const attrs of links) {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const rel = attrs.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1] || 'alternate';
    if (href && rel === 'alternate') return href;
    if (href && !best) best = href;
  }
  return best;
}

export function toIsoDate(raw) {
  if (!raw) return null;
  const t = Date.parse(stripTags(raw));
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

// A link is kept only as a printable-ASCII http(s) URL of at most MAX_LINK_CHARS, so its size in JSON is its
// length. A link with control characters or spaces is dropped; other non-ASCII characters are percent-encoded
// (the host in punycode) by the URL parser.
export function cleanLink(raw) {
  const u = (raw || '').trim();
  if (!u || u.length > MAX_LINK_CHARS || !/^https?:\/\/[^\s\u0000-\u001f\u007f-\u009f]+$/i.test(u) || u.search(LONE_SURROGATES) >= 0) return null;
  let href;
  try { href = new URL(u).href; } catch { return null; }
  return href.length <= MAX_LINK_CHARS && /^https?:\/\/[\x21-\x7e]+$/.test(href) ? href : null;
}

// The document's root element, after any BOM, XML declaration, processing instructions, comments and doctype.
// A substring test is not enough: an RSS item can quote "<feed>" in its HTML, and an HTML page can contain "<rss".
// Walked with indexOf, so no amount of prologue can make it backtrack.
function rootElement(text) {
  const space = /\s*/y;
  let i = 0;
  for (;;) {
    space.lastIndex = i;
    space.exec(text);
    i = space.lastIndex;
    let end;
    if (text.startsWith('<?', i)) end = after(text, '?>', i + 2);
    else if (text.startsWith('<!--', i)) end = after(text, '-->', i + 4);
    else if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) end = doctypeEnd(text, i + 9);
    else break;
    if (end < 0) return null;
    i = end;
  }
  const name = /<([A-Za-z_][\w.:-]*)/y;
  name.lastIndex = i;
  const m = name.exec(text);
  return m ? m[1].toLowerCase().replace(/^[\w.-]+:(?=(?:rss|feed|rdf)$)/, '') : null;
}
function after(text, terminator, from) {
  const j = text.indexOf(terminator, from);
  return j < 0 ? -1 : j + terminator.length;
}
// <!DOCTYPE name ...> or <!DOCTYPE name ... [internal subset]>: the subset ends at the first "]" followed by
// optional space and ">".
function doctypeEnd(text, i) {
  while (i < text.length && text[i] !== '>' && text[i] !== '[') i++;
  if (text[i] === '>') return i + 1;
  if (text[i] !== '[') return -1;
  for (let from = i + 1; ;) {
    const j = text.indexOf(']', from);
    if (j < 0) return -1;
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === '>') return k + 1;
    from = j + 1;
  }
}

export function parseFeed(xml, { now = Date.now() } = {}) {
  const text = xml.length > MAX_FEED_BYTES ? xml.slice(0, MAX_FEED_BYTES) : xml;
  const root = rootElement(text);
  const isAtom = root === 'feed';
  const valid = root === 'rss' || root === 'feed' || root === 'rdf';
  if (!valid) return { format: null, items: [], valid: false };
  const blocks = (isAtom ? spans(text, /<entry[\s>]/gi, /<\/entry>/gi, MAX_ITEMS) : spans(text, /<item[\s>]/gi, /<\/item>/gi, MAX_ITEMS))
    .map((s) => text.slice(s.start, s.end));
  const items = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title') || '');
    if (!title) continue;
    // The item's identity is its guid, else its link as written (relative, too long or not, as before links
    // were cleaned), else its title: the stored id is a hash of it, so it must not change for items seen before.
    const rawLink = isAtom ? atomLink(b) : stripTags(tag(b, 'link') || '') || null;
    const link = cleanLink(rawLink);
    const guid = stripTags(tag(b, 'guid') || tag(b, 'id') || '') || rawLink || title;
    let published = toIsoDate(
      tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')
    );
    if (published && Date.parse(published) > now + MAX_FUTURE_MS) published = null;
    const body = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content') || '';
    const excerpt = clipText(stripTags(body), 400);
    items.push({ title: clipText(title, 300), link, guid, published, excerpt });
  }
  return { format: isAtom ? 'atom' : 'rss', items, valid };
}

// ---- Classification -------------------------------------------------------
// Heuristics only. Everything produced here is shown as "auto-detected, unreviewed".

const SIGNALS = [
  ['open_call', /\b(open call|applications? (?:are )?(?:now )?open|call for (?:proposals|applications|ideas)|apply (?:now|by|before|today)|now accepting applications|request for proposals|rfp|funding (?:call|opportunit(?:y|ies))|deadline)\b/i],
  ['funding', /\b(grants?|grantees?|awarded|funding|funded|donat(?:ion|ed)|matching (?:campaign|challenge)|recommended charit(?:y|ies)|movement grants)\b/i],
  ['legal', /\b(bill|laws?|legislat\w*|ban(?:s|ned)?|court|ruling|lawsuit|parliament|ministry|regulations?|directive|statute|senate|assembly)\b/i],
  ['campaign_outcome', /\b(commit(?:s|ted|ments?)|pledge[sd]?|victory|agrees? to|phas(?:e|es|ed|ing) out|cage-free|policy change)\b/i],
  ['report', /\b(report|annual review|year in review|study|studies|survey|paper|findings|results|dataset|data release|evaluation|randomi[sz]ed|trial|retract(?:ion|ed)?|new research|publish(?:es|ed) (?:a|our|new))\b/i],
  ['launch', /\b(launch(?:es|ed|ing)?|introduc(?:es|ing|ed)|new (?:program(?:me)?|project|initiative|organi[sz]ation|office|country)|expan(?:ds?|sion) (?:to|into)|international expansion)\b/i],
  ['people', /\b(hiring|we'?re hiring|jobs?|vacanc(?:y|ies)|joins? (?:as|our)|appoint(?:s|ed)|new (?:ceo|executive director|director))\b/i],
];

const SPECIES = [
  ['farmed-fish', /\b(aquaculture|fish ?farm\w*|farmed fish(?:es)?|salmon|trout|tilapia|carps?|catfish|pangasius|sea ?bass|sea ?bream|milkfish|rohu|stocking density|water quality|sea lice|lice infections?)\b/i],
  ['wild-fish', /\b(wild[- ]caught|fisher(?:y|ies)|bycatch|trawl\w*|fishing|bait ?fish(?:es)?|fishmeal|wild fish(?:es)?)\b/i],
  ['crustaceans', /\b(shrimp|prawns?|crabs?|lobsters?|crustaceans?|decapods?|crayfish|krill)\b/i],
  ['cephalopods', /\b(octop(?:us|uses|i)|squid|cuttlefish|cephalopods?)\b/i],
  ['chickens', /\b(chickens?|broilers?|hens?|cage-free|eggs?|poultry|better chicken commitment)\b/i],
  ['pigs', /\b(pigs?|sows?|gestation crates?|pork)\b/i],
  ['cows', /\b(cows?|cattle|dairy|calves|beef)\b/i],
  ['insects', /\b(insects?|black soldier fl(?:y|ies)|mealworms?|crickets?)\b/i],
  ['wild-animals', /\b(wild animal (?:welfare|suffering)|wildlife)\b/i],
];

// Signals that count as a "meaningful change" worth surfacing on the Changes view.
// Plain blog posts, opinion pieces and hiring news are stored but not surfaced.
const MEANINGFUL = new Set(['open_call', 'funding', 'legal', 'campaign_outcome', 'report', 'launch']);

export function classify(text) {
  for (const [name, re] of SIGNALS) if (re.test(text)) return name;
  return null;
}

export function detectSpecies(text) {
  const found = SPECIES.filter(([, re]) => re.test(text)).map(([n]) => n);
  // A bare "fish"/"fishes" with no farmed/wild context: infer from nearby words, else leave untagged.
  if (!found.includes('farmed-fish') && !found.includes('wild-fish') && /\bfish(?:es)?\b/i.test(text)) {
    if (/\bfarm/i.test(text)) found.push('farmed-fish');
    else if (/\b(catch|caught|ocean|sea)\b/i.test(text)) found.push('wild-fish');
  }
  return found;
}

export function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|inc|ltd|llc|org|e v|ev|foundation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// How a name is written for matching mentions in feed text. Unlike normalizeName it keeps generic words such
// as "foundation", so "The Animal Law Foundation" becomes "animal law foundation", not "animal law".
export function mentionForm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// Ordinary phrases that happen to be an entity's name once generic words are removed. Rows built before
// mentionForm existed still hold these forms, so they are skipped until the next reseed replaces them.
const GENERIC_MENTIONS = new Set(['animal law']);

const stripAccents = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

// aliasIndex: array of [aliasNorm, entityId, alias?]. Aliases shorter than 4 characters are never used, to
// avoid matching short acronyms inside ordinary words. A one-word alias ("Hive", "Lever", "AWASH") only
// matches when the text writes it with the same capitals as the alias, so "a hive of activity" or
// "the market is awash" do not count; a one-word alias with no capitals is not used at all.
export function detectMentions(text, aliasIndex, selfId) {
  const norm = ' ' + mentionForm(text) + ' ';
  const words = new Set(stripAccents(text).split(/[^A-Za-z0-9]+/).filter(Boolean));
  const found = new Set();
  for (const [alias, id, raw] of aliasIndex) {
    if (id === selfId || alias.length < 4 || GENERIC_MENTIONS.has(alias) || found.has(id)) continue;
    if (alias.includes(' ')) {
      if (norm.includes(' ' + alias + ' ')) found.add(id);
      continue;
    }
    const word = stripAccents(raw).replace(/[^A-Za-z0-9]+/g, '');
    if (word.toLowerCase() === alias && /[A-Z]/.test(word) && words.has(word)) found.add(id);
  }
  return [...found];
}

export function analyseItem(item, aliasIndex, selfId) {
  const text = `${item.title}. ${item.excerpt || ''}`;
  const signal = classify(text);
  return {
    signal,
    species: detectSpecies(text),
    mentions: detectMentions(text, aliasIndex, selfId),
    meaningful: signal && MEANINGFUL.has(signal) ? 1 : 0,
  };
}
