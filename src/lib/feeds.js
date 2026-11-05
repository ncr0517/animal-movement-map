// Lightweight RSS/Atom parsing and change classification.
// Regex-based on purpose: Workers' free tier allows ~10ms CPU per invocation,
// so we avoid a full XML DOM and cap how much of each feed we read.

const MAX_FEED_BYTES = 400_000;
const MAX_ITEMS = 25;

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

export function parseFeed(xml) {
  const text = xml.length > MAX_FEED_BYTES ? xml.slice(0, MAX_FEED_BYTES) : xml;
  const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
  const blocks = isAtom
    ? text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
    : text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const b of blocks.slice(0, MAX_ITEMS)) {
    const title = stripTags(tag(b, 'title') || '');
    if (!title) continue;
    const link = isAtom ? atomLink(b) : stripTags(tag(b, 'link') || '') || null;
    const guid = stripTags(tag(b, 'guid') || tag(b, 'id') || '') || link || title;
    const published = toIsoDate(
      tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')
    );
    const body = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content') || '';
    const excerpt = stripTags(body).slice(0, 400);
    items.push({ title: title.slice(0, 300), link, guid, published, excerpt });
  }
  return { format: isAtom ? 'atom' : 'rss', items, valid: blocks.length > 0 || /<rss|<feed|<rdf/i.test(text) };
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

// aliasIndex: array of [aliasNorm, entityId]; only aliases >= 4 chars are used for
// mention detection, to avoid matching short acronyms inside ordinary words.
export function detectMentions(text, aliasIndex, selfId) {
  const norm = ' ' + normalizeName(text) + ' ';
  const found = new Set();
  for (const [alias, id] of aliasIndex) {
    if (id === selfId || alias.length < 4) continue;
    if (norm.includes(' ' + alias + ' ')) found.add(id);
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
