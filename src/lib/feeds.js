// Lightweight RSS/Atom parsing and change classification.
// Regex-based on purpose: Workers' free tier allows ~10ms CPU per invocation,
// so we avoid a full XML DOM and cap how much of each feed we read.

export const MAX_FEED_BYTES = 400_000;
const MAX_ITEMS = 25;
// A link longer than this, or not http(s), is dropped: one feed must not be able to inflate /api/snapshot.
export const MAX_LINK_CHARS = 2000;
const MAX_GUID_CHARS = 500;
// A feed date more than a day ahead is wrong; it is dropped so the item sorts by when we first saw it.
const MAX_FUTURE_MS = 86400_000;

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITY_MAP[n.toLowerCase()] ?? m);
}
function safeChar(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

export function stripTags(s) {
  return decodeEntities(decodeEntities(s || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
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

export function cleanLink(raw) {
  const u = (raw || '').trim();
  return u && u.length <= MAX_LINK_CHARS && /^https?:\/\/\S+$/i.test(u) ? u : null;
}

// The document's root element, after any BOM, XML declaration, processing instructions, comments and doctype.
// A substring test is not enough: an RSS item can quote "<feed>" in its HTML, and an HTML page can contain "<rss".
function rootElement(text) {
  const m = text.match(/^\uFEFF?\s*(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)\s*)*<([A-Za-z_][\w.:-]*)/i);
  return m ? m[1].toLowerCase().replace(/^[\w.-]+:(?=(?:rss|feed|rdf)$)/, '') : null;
}

export function parseFeed(xml, { now = Date.now() } = {}) {
  const text = xml.length > MAX_FEED_BYTES ? xml.slice(0, MAX_FEED_BYTES) : xml;
  const root = rootElement(text);
  const isAtom = root === 'feed';
  const valid = root === 'rss' || root === 'feed' || root === 'rdf';
  if (!valid) return { format: null, items: [], valid: false };
  const blocks = isAtom
    ? text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
    : text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const b of blocks.slice(0, MAX_ITEMS)) {
    const title = stripTags(tag(b, 'title') || '');
    if (!title) continue;
    const link = cleanLink(isAtom ? atomLink(b) : stripTags(tag(b, 'link') || ''));
    const guid = (stripTags(tag(b, 'guid') || tag(b, 'id') || '') || link || title).slice(0, MAX_GUID_CHARS);
    let published = toIsoDate(
      tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')
    );
    if (published && Date.parse(published) > now + MAX_FUTURE_MS) published = null;
    const body = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content') || '';
    const excerpt = stripTags(body).slice(0, 400);
    items.push({ title: title.slice(0, 300), link, guid, published, excerpt });
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
