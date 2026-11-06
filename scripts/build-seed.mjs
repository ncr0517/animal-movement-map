// Build the D1 seed + a static snapshot from the research files.
//   data/research/*-entities.json  → entities, aliases, sources
//   data/research/*-events.json    → events, event_entities
//   data/curated/*.json            → hand-maintained overrides (same schemas), applied last
// Outputs: db/seed.sql, public/snapshot.json, data/seed/build-report.md
import fs from 'node:fs';
import path from 'node:path';
import { normalizeName } from '../src/lib/feeds.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const R = (...p) => path.join(ROOT, ...p);
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

const ENUMS = {
  kind: ['organisation', 'programme', 'funder', 'resource', 'network', 'banner'],
  categories: ['advocacy-campaigns', 'welfare-science', 'welfare-technology', 'policy-law', 'funding', 'incubation-careers',
    'movement-infrastructure', 'community-media', 'direct-action', 'sanctuary-rescue', 'alt-protein'],
  species: ['farmed-fish', 'wild-fish', 'crustaceans', 'cephalopods', 'chickens', 'pigs', 'cows', 'farmed-animals', 'wild-animals',
    'insects', 'companion-animals', 'animals-in-research', 'fur-animals', 'all-animals'],
  regions: ['global', 'europe', 'uk', 'north-america', 'latin-america', 'asia', 'south-asia', 'southeast-asia', 'east-asia',
    'africa', 'middle-east', 'oceania'],
  interventions: ['corporate-campaigns', 'legislation-policy', 'litigation', 'research', 'humane-slaughter', 'farm-practices',
    'producer-engagement', 'certification-standards', 'alt-proteins', 'public-awareness', 'diet-change', 'protest', 'open-rescue',
    'direct-action', 'investigations', 'capacity-building', 'grantmaking', 'careers-talent', 'data-tools', 'education', 'sanctuary'],
  approach: ['welfare-reform', 'abolitionist', 'mixed', 'research', 'neutral-infrastructure', 'unclear'],
  status: ['active', 'inactive', 'unclear'],
  eventType: ['grant_awarded', 'open_call', 'announcement', 'plan_announced', 'project_active', 'report_published',
    'campaign_outcome', 'legal_development'],
  eventStatus: ['confirmed', 'reported', 'uncertain', 'disputed', 'superseded'],
};
const SPECIES_ALIASES = { fish: 'farmed-fish', shrimp: 'crustaceans', octopus: 'cephalopods', 'broiler-chickens': 'chickens', 'laying-hens': 'chickens' };
const CATEGORY_ALIASES = { 'alt-proteins': 'alt-protein', 'advocacy': 'advocacy-campaigns', 'abolitionist': 'direct-action', 'sanctuary': 'sanctuary-rescue' };

const warnings = [];
const merges = [];
const stubs = [];

const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { warnings.push(`Could not read ${path.relative(ROOT, f)}: ${e.message}`); return []; }
};
const listFiles = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : []);
const slug = (s) => normalizeName(s).replace(/\s+/g, '-');
const uniq = (a) => [...new Set((a || []).filter(Boolean))];

function cleanEnum(list, allowed, aliases, label, id) {
  const out = [];
  for (let v of list || []) {
    v = String(v).toLowerCase().trim();
    v = aliases?.[v] || v;
    if (allowed.includes(v)) out.push(v);
    else warnings.push(`${id}: dropped unknown ${label} "${v}"`);
  }
  return uniq(out);
}

function cleanEntity(raw, section) {
  const id = raw.id ? slug(raw.id) : slug(raw.name);
  const e = {
    id,
    name: String(raw.name || id).trim(),
    aliases: uniq((raw.aliases || []).map((a) => String(a).trim())),
    kind: ENUMS.kind.includes(raw.kind) ? raw.kind : (warnings.push(`${id}: unknown kind "${raw.kind}" → organisation`), 'organisation'),
    parent_id: raw.parent_id ? slug(raw.parent_id) : null,
    categories: cleanEnum(raw.categories, ENUMS.categories, CATEGORY_ALIASES, 'category', id),
    species: cleanEnum(raw.species, ENUMS.species, SPECIES_ALIASES, 'species', id),
    regions: cleanEnum(raw.regions, ENUMS.regions, null, 'region', id),
    countries: uniq((raw.countries || []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))),
    interventions: cleanEnum(raw.interventions, ENUMS.interventions, null, 'intervention', id),
    approach: ENUMS.approach.includes(raw.approach) ? raw.approach : 'unclear',
    summary: raw.summary ? String(raw.summary).trim() : null,
    website: raw.website && /^https?:\/\//.test(raw.website) ? raw.website : null,
    hq: raw.hq || null,
    founded: raw.founded ? String(raw.founded).slice(0, 4) : null,
    status: ENUMS.status.includes(raw.status) ? raw.status : 'unclear',
    feeds: (raw.feeds || []).filter((f) => f && f.url && f.verified),
    sources: (raw.sources || []).filter((s) => s && s.url),
    notes: raw.notes || null,
    section,
    last_checked: raw.last_checked || (raw.sources || []).map((s) => s.accessed).filter(Boolean).sort().pop() || null,
  };
  if (!e.categories.length) {
    e.categories = ['movement-infrastructure'];
    warnings.push(`${id}: no valid category, defaulted to movement-infrastructure`);
  }
  if (!e.sources.length) warnings.push(`${id}: has no sources`);
  return e;
}

function mergeEntity(a, b) {
  merges.push(`${b.id} (${b.section}) → ${a.id} (${a.section})`);
  for (const k of ['aliases', 'categories', 'species', 'regions', 'countries', 'interventions']) a[k] = uniq([...a[k], ...b[k]]);
  if (b.name !== a.name) a.aliases = uniq([...a.aliases, b.name]);
  if (b.id !== a.id) a.aliases = uniq([...a.aliases]);
  a.summary ||= b.summary;
  a.website ||= b.website;
  a.hq ||= b.hq;
  a.founded ||= b.founded;
  if (a.status === 'unclear') a.status = b.status;
  if (a.approach === 'unclear') a.approach = b.approach;
  const feedUrls = new Set(a.feeds.map((f) => f.url));
  a.feeds.push(...b.feeds.filter((f) => !feedUrls.has(f.url)));
  const srcUrls = new Set(a.sources.map((s) => s.url));
  a.sources.push(...b.sources.filter((s) => !srcUrls.has(s.url)));
  a.notes = [a.notes, b.notes].filter(Boolean).join(' | ') || null;
  if (b.section === 'aquatic') a.section = 'aquatic';
  if ((b.last_checked || '') > (a.last_checked || '')) a.last_checked = b.last_checked;
  a._mergedIds = uniq([...(a._mergedIds || []), b.id]);
  return a;
}

// ---- Entities ---------------------------------------------------------------
const entities = new Map();   // id → entity
const aliasIdx = new Map();   // normalized alias → id

const ambiguous = new Set(); // aliases claimed by more than one entity (e.g. "AAA")
const hostIdx = new Map();    // website host → id
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

function indexAliases(e) {
  for (const a of [e.id.replace(/-/g, ' '), e.name, ...e.aliases, ...(e._mergedIds || []).map((x) => x.replace(/-/g, ' '))]) {
    const n = normalizeName(a);
    if (!n) continue;
    const prev = aliasIdx.get(n);
    if (prev && prev !== e.id) { ambiguous.add(n); warnings.push(`alias "${a}" is used by both ${prev} and ${e.id} — not used for matching`); }
    else if (!prev) aliasIdx.set(n, e.id);
  }
  const h = e.website && hostOf(e.website);
  // only index org homepages, not shared hosts like wikipedia or a parent org's subpage
  if (h && !hostIdx.has(h) && !/wikipedia\.org$|facebook\.com$|instagram\.com$|linktr\.ee$/.test(h) && new URL(e.website).pathname.length <= 1) hostIdx.set(h, e.id);
}
function resolve(ref) {
  if (!ref) return null;
  if (entities.has(slug(ref))) return slug(ref);
  const n = normalizeName(String(ref).replace(/-/g, ' '));
  return ambiguous.has(n) ? null : aliasIdx.get(n) || null;
}
// Strict matching for merging two profiles: id, full name, distinctive alias (≥6 chars), or same homepage.
function findSame(e) {
  if (entities.has(e.id)) return entities.get(e.id);
  const strong = [e.name, ...e.aliases].map(normalizeName).filter((n) => n && (n === normalizeName(e.name) || n.replace(/ /g, '').length >= 6));
  for (const n of strong) { const id = !ambiguous.has(n) && aliasIdx.get(n); if (id) return entities.get(id); }
  const h = e.website && hostOf(e.website);
  if (h && hostIdx.has(h) && new URL(e.website).pathname.length <= 1) {
    const other = entities.get(hostIdx.get(h));
    // a programme often shares its parent's homepage: that is not the same entity
    const related = e.parent_id === other.id || other.parent_id === e.id;
    if (!related && other.kind === e.kind) return other;
  }
  return null;
}
function addEntity(e) {
  const existing = findSame(e);
  if (existing) { mergeEntity(existing, e); indexAliases(existing); return existing; }
  entities.set(e.id, e);
  indexAliases(e);
  return e;
}

const entityFiles = [
  ...listFiles(R('data/research'), /-entities\.json$/),
  ...listFiles(R('data/curated'), /-entities\.json$/),
];
for (const f of entityFiles) {
  const section = path.basename(f).split('-')[0];
  for (const raw of readJson(f)) addEntity(cleanEntity(raw, section === 'curated' ? 'movement' : section));
}

// ---- Events -----------------------------------------------------------------
function ensureEntity(ref, kind, contextId) {
  if (!ref) return null;
  const hit = resolve(ref);
  if (hit) return hit;
  const id = slug(ref);
  const name = id.split('-').map((w) => (w.length <= 3 && w !== 'the' ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
  const e = cleanEntity({
    id, name, kind, categories: [kind === 'funder' ? 'funding' : 'advocacy-campaigns'], status: 'unclear',
    summary: null, sources: [], notes: `Stub: referenced by record ${contextId}; profile not yet researched.`,
  }, 'funding');
  e.stub = true;
  warnings.pop(); // the "no sources" warning is expected for stubs
  stubs.push(`${id} (from ${contextId})`);
  addEntity(e);
  return id;
}

const events = new Map();
const eventFiles = [
  ...listFiles(R('data/research'), /-events\.json$/),
  ...listFiles(R('data/curated'), /-events\.json$/),
];
for (const f of eventFiles) {
  for (const raw of readJson(f)) {
    const id = slug(raw.id || `${raw.title}-${raw.event_date || ''}`);
    if (!ENUMS.eventType.includes(raw.type)) { warnings.push(`event ${id}: unknown type "${raw.type}" — skipped`); continue; }
    if (!raw.source_url) { warnings.push(`event ${id}: no source_url — skipped`); continue; }
    const funder = ensureEntity(raw.funder_id, 'funder', id);
    const recipient = ensureEntity(raw.recipient_id, 'organisation', id);
    const linked = uniq([...(raw.entity_ids || []).map((r) => ensureEntity(r, 'organisation', id)), funder, recipient]);
    const ev = {
      id,
      type: raw.type,
      title: String(raw.title || '').trim(),
      summary: raw.summary || null,
      event_date: raw.event_date || null,
      source_published: raw.source_published || null,
      last_checked: raw.last_checked || TODAY,
      source_url: raw.source_url,
      source_title: raw.source_title || null,
      amount: typeof raw.amount === 'number' ? raw.amount : null,
      currency: raw.currency || null,
      funder_id: funder,
      recipient_id: recipient,
      deadline: raw.deadline || null,
      call_state: null,
      status: ENUMS.eventStatus.includes(raw.status) ? raw.status : 'reported',
      conflicts_with: [],
      origin: 'curated',
      notes: raw.notes || null,
      entity_ids: linked,
    };
    if (events.has(id)) { warnings.push(`event ${id}: duplicate id in ${path.basename(f)} — later copy kept`); }
    events.set(id, ev);
  }
}

// ---- Reviewed overrides (accepted corrections, manual fixes) ----
const CALL_STATES = ['open', 'closed', 'forthcoming', 'rolling-or-unstated'];
const overrides = fs.existsSync(R('data/curated/overrides.json')) ? readJson(R('data/curated/overrides.json')) : {};
const applyPatch = (target, patch, label) => {
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith('_')) continue;
    if (k === 'call_state' && !CALL_STATES.includes(v)) { warnings.push(`override ${label}: bad call_state "${v}"`); continue; }
    target[k] = v;
  }
};
for (const [id, patch] of Object.entries(overrides.events || {})) {
  if (events.has(id)) applyPatch(events.get(id), patch, id); else warnings.push(`override for unknown event ${id}`);
}
for (const [id, patch] of Object.entries(overrides.entities || {})) {
  if (entities.has(id)) applyPatch(entities.get(id), patch, id); else warnings.push(`override for unknown entity ${id}`);
}

// Duplicate & conflict detection for grants: same funder + recipient + period.
const grantGroups = {};
for (const ev of events.values()) {
  if (ev.type !== 'grant_awarded' || !ev.funder_id || !ev.recipient_id) continue;
  const k = `${ev.funder_id}|${ev.recipient_id}|${(ev.event_date || '').slice(0, 7)}`;
  (grantGroups[k] ||= []).push(ev);
}
for (const group of Object.values(grantGroups)) {
  if (group.length < 2) continue;
  const amounts = uniq(group.map((g) => `${g.amount} ${g.currency}`));
  if (amounts.length === 1) {
    // same grant reported twice → keep the first, record the other source in notes
    const [keep, ...dupes] = group;
    for (const d of dupes) {
      keep.notes = [keep.notes, `Also reported at ${d.source_url}`].filter(Boolean).join(' | ');
      events.delete(d.id);
      merges.push(`event ${d.id} → ${keep.id}`);
    }
  } else {
    for (const g of group) {
      g.conflicts_with = group.filter((o) => o !== g).map((o) => o.id);
      g.status = 'disputed';
    }
    warnings.push(`Conflicting grant reports kept side by side: ${group.map((g) => g.id).join(', ')}`);
  }
}

// ---- Sources ----------------------------------------------------------------
const sources = [];
for (const e of entities.values()) {
  e.feeds.forEach((f, i) => sources.push({ id: `${e.id}-feed${i ? i + 1 : ''}`, entity_id: e.id, url: f.url, kind: 'feed', cadence: 'daily' }));
  if (e.website && e.kind !== 'banner') sources.push({ id: `${e.id}-home`, entity_id: e.id, url: e.website, kind: 'homepage', cadence: 'monthly' });
}
const seenUrls = new Set();
const dedupedSources = sources.filter((s) => (seenUrls.has(s.url) ? false : seenUrls.add(s.url)));

// Validate parent links
for (const e of entities.values()) {
  if (e.parent_id && !entities.has(e.parent_id)) {
    const r = resolve(e.parent_id);
    if (r) e.parent_id = r; else { warnings.push(`${e.id}: parent "${e.parent_id}" not found — cleared`); e.parent_id = null; }
  }
}

// ---- Write SQL --------------------------------------------------------------
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const sql = ['-- generated by scripts/build-seed.mjs — do not edit by hand', ''];
const profileOf = (e) => {
  const { id, name, kind, parent_id, section, status, last_checked, stub, _mergedIds, feeds, ...rest } = e;
  return { ...rest, merged_from: _mergedIds || [] };
};
for (const e of entities.values()) {
  sql.push(`INSERT INTO entities (id,name,kind,parent_id,primary_category,section,status,profile,stub,last_checked,updated_at) VALUES (${[
    e.id, e.name, e.kind, e.parent_id, e.categories[0], e.section, e.status, JSON.stringify(profileOf(e)), e.stub ? 1 : 0, e.last_checked, now,
  ].map(q).join(',')});`);
}
for (const [alias, id] of aliasIdx) sql.push(`INSERT OR IGNORE INTO aliases (alias_norm,alias,entity_id) VALUES (${q(alias)},${q(alias)},${q(id)});`);
for (const ev of events.values()) {
  sql.push(`INSERT INTO events (id,type,title,summary,event_date,source_published,last_checked,source_url,source_title,amount,currency,funder_id,recipient_id,deadline,call_state,status,conflicts_with,origin,notes,created_at) VALUES (${[
    ev.id, ev.type, ev.title, ev.summary, ev.event_date, ev.source_published, ev.last_checked, ev.source_url, ev.source_title, ev.amount,
    ev.currency, ev.funder_id, ev.recipient_id, ev.deadline, ev.call_state, ev.status, JSON.stringify(ev.conflicts_with), ev.origin, ev.notes, now,
  ].map(q).join(',')});`);
  for (const eid of ev.entity_ids) sql.push(`INSERT OR IGNORE INTO event_entities (event_id,entity_id) VALUES (${q(ev.id)},${q(eid)});`);
}
for (const s of dedupedSources) {
  sql.push(`INSERT INTO sources (id,entity_id,url,kind,cadence,visibility) VALUES (${[s.id, s.entity_id, s.url, s.kind, s.cadence, 'public'].map(q).join(',')});`);
}
fs.writeFileSync(R('db/seed.sql'), sql.join('\n') + '\n');

// ---- Static snapshot (same shape as /api/snapshot; used as offline fallback) ----
const DAY = 86400_000;
const snapshot = {
  generated_at: now,
  static: true,
  last_refresh: null,
  source_health: { total: dedupedSources.length, feeds: dedupedSources.filter((s) => s.kind === 'feed').length, checked: 0, failing: 0 },
  entities: [...entities.values()].map((e) => ({
    ...profileOf(e), id: e.id, name: e.name, kind: e.kind, parent_id: e.parent_id, primary_category: e.categories[0],
    section: e.section, status: e.status, stub: Boolean(e.stub), last_checked: e.last_checked,
    stale: !e.last_checked || Date.now() - Date.parse(e.last_checked) > 180 * DAY,
    monitoring: dedupedSources.filter((s) => s.entity_id === e.id).map((s) => ({ kind: s.kind, cadence: s.cadence, last_checked: null, healthy: true })),
  })),
  events: [...events.values()].map((ev) => ({
    ...ev,
    call_state: ev.type !== 'open_call' ? null : ev.call_state ? ev.call_state : !ev.deadline ? 'rolling-or-unstated' : Date.parse(ev.deadline) + DAY < Date.now() ? 'closed' : 'open',
  })),
  changes: [],
};
fs.writeFileSync(R('public/snapshot.json'), JSON.stringify(snapshot));

// ---- Report -----------------------------------------------------------------
const count = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
const ents = [...entities.values()];
const report = [
  `# Seed build report (${now})`, '',
  `- Entities: ${ents.length} (${ents.filter((e) => e.stub).length} stubs)`,
  `- Events: ${events.size}`,
  `- Sources: ${dedupedSources.length} (${dedupedSources.filter((s) => s.kind === 'feed').length} feeds)`, '',
  '## Entities by primary category', ...Object.entries(count(ents.map((e) => ({ c: e.categories[0] })), 'c')).map(([k, v]) => `- ${k}: ${v}`), '',
  '## Events by type', ...Object.entries(count([...events.values()], 'type')).map(([k, v]) => `- ${k}: ${v}`), '',
  '## Reconciled (merged) records', ...(merges.length ? merges.map((m) => `- ${m}`) : ['- none']), '',
  '## Stub entities created from references', ...(stubs.length ? stubs.map((m) => `- ${m}`) : ['- none']), '',
  '## Warnings', ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- none']), '',
].join('\n');
fs.mkdirSync(R('data/seed'), { recursive: true });
fs.writeFileSync(R('data/seed/build-report.md'), report);
console.log(report.split('\n## Reconciled')[0]);
console.log(`warnings: ${warnings.length}, merges: ${merges.length}, stubs: ${stubs.length}`);
