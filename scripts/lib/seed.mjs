// Seed build logic, importable so it can be tested (scripts/build-seed.mjs does the file writing).
//   data/research/*-entities.json  → entities, aliases, sources
//   data/research/*-events.json    → events, event_entities
//   data/curated/*-entities.json, *-events.json → hand-maintained records (same schemas)
//   data/curated/overrides.json    → reviewed field-level patches (accepted corrections, manual fixes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName, mentionForm } from '../../src/lib/feeds.js';
import { callState, isIsoDate, DAY } from '../../src/lib/calls.js';

// The repository root of a module two levels down (scripts/lib/x.mjs). fileURLToPath, not URL.pathname:
// on Windows a pathname is "/C:/..." (which path.resolve turns into C:\C:\...), and anywhere a space in
// the checkout path stays "%20".
export const rootOf = (moduleUrl) => fileURLToPath(new URL('../..', moduleUrl));
export const ROOT = rootOf(import.meta.url);

export const ENUMS = {
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
  section: ['aquatic', 'movement', 'funding'],
  eventType: ['grant_awarded', 'open_call', 'announcement', 'plan_announced', 'project_active', 'report_published',
    'campaign_outcome', 'legal_development'],
  eventStatus: ['confirmed', 'reported', 'uncertain', 'disputed', 'superseded'],
  callState: ['open', 'closed', 'forthcoming', 'rolling-or-unstated'],
  feedReuse: ['full', 'headline'],
};
const SPECIES_ALIASES = { fish: 'farmed-fish', shrimp: 'crustaceans', octopus: 'cephalopods', 'broiler-chickens': 'chickens', 'laying-hens': 'chickens' };
const CATEGORY_ALIASES = { 'alt-proteins': 'alt-protein', 'advocacy': 'advocacy-campaigns', 'abolitionist': 'direct-action', 'sanctuary': 'sanctuary-rescue' };

export const slug = (s) => normalizeName(s).replace(/\s+/g, '-');
const uniq = (a) => [...new Set((a || []).filter(Boolean))];
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);

// ---- Reading inputs ------------------------------------------------------------------------------------
// Any input that cannot be read or parsed stops the build. (It used to become a warning and an empty list,
// which wrote a smaller but complete-looking directory.)
export function readInputs(root = ROOT) {
  const rel = (f) => path.relative(root, f);
  const readJson = (f) => {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { throw new Error(`Could not read ${rel(f)}: ${e.message}`); }
    try { return JSON.parse(text); } catch (e) { throw new Error(`${rel(f)} is not valid JSON: ${e.message}`); }
  };
  const listFiles = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : []);
  const load = (re) => [...listFiles(path.join(root, 'data/research'), re), ...listFiles(path.join(root, 'data/curated'), re)].map((f) => {
    const records = readJson(f);
    if (!Array.isArray(records)) throw new Error(`${rel(f)} must be a JSON array`);
    return { name: path.basename(f), dir: path.basename(path.dirname(f)), records };
  });
  const entityFiles = load(/-entities\.json$/);
  const eventFiles = load(/-events\.json$/);
  if (!entityFiles.length) throw new Error('No *-entities.json files found under data/research or data/curated');
  if (!eventFiles.length) throw new Error('No *-events.json files found under data/research or data/curated');
  const overridesPath = path.join(root, 'data/curated/overrides.json');
  const overrides = fs.existsSync(overridesPath) ? readJson(overridesPath) : {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('data/curated/overrides.json must be a JSON object');
  return { entityFiles, eventFiles, overrides };
}

// ---- Building ----------------------------------------------------------------------------------------
export function buildSeed({ entityFiles, eventFiles, overrides = {} }) {
  const warnings = [];
  const merges = [];
  const stubs = [];
  const warn = (w) => warnings.push(w);

  function cleanEnum(list, allowed, aliases, label, id) {
    const out = [];
    for (let v of list || []) {
      v = String(v).toLowerCase().trim();
      v = aliases?.[v] || v;
      if (allowed.includes(v)) out.push(v);
      else warn(`${id}: dropped unknown ${label} "${v}"`);
    }
    return uniq(out);
  }

  function cleanFeeds(list, id) {
    return (list || []).filter((f) => f && f.url && f.verified).map((f) => {
      if (f.reuse !== undefined && !ENUMS.feedReuse.includes(f.reuse)) warn(`${id}: feed ${f.url} has unknown reuse "${f.reuse}" (full or headline) — treated as full`);
      return { ...f, reuse: f.reuse === 'headline' ? 'headline' : 'full' };
    });
  }

  function cleanEntity(raw, section) {
    const id = raw.id ? slug(raw.id) : slug(raw.name);
    const e = {
      id,
      name: String(raw.name || id).trim(),
      aliases: uniq((raw.aliases || []).map((a) => String(a).trim())),
      kind: ENUMS.kind.includes(raw.kind) ? raw.kind : (warn(`${id}: unknown kind "${raw.kind}" → organisation`), 'organisation'),
      parent_id: raw.parent_id ? slug(raw.parent_id) : null,
      categories: cleanEnum(raw.categories, ENUMS.categories, CATEGORY_ALIASES, 'category', id),
      species: cleanEnum(raw.species, ENUMS.species, SPECIES_ALIASES, 'species', id),
      regions: cleanEnum(raw.regions, ENUMS.regions, null, 'region', id),
      countries: uniq((raw.countries || []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))),
      interventions: cleanEnum(raw.interventions, ENUMS.interventions, null, 'intervention', id),
      approach: ENUMS.approach.includes(raw.approach) ? raw.approach : 'unclear',
      summary: raw.summary ? String(raw.summary).trim() : null,
      website: isUrl(raw.website) ? raw.website : null,
      hq: raw.hq || null,
      founded: raw.founded ? String(raw.founded).slice(0, 4) : null,
      status: ENUMS.status.includes(raw.status) ? raw.status : 'unclear',
      feeds: cleanFeeds(raw.feeds, id),
      sources: (raw.sources || []).filter((s) => s && s.url),
      notes: raw.notes || null,
      section,
      last_checked: raw.last_checked || (raw.sources || []).map((s) => s.accessed).filter(Boolean).sort().pop() || null,
    };
    if (!e.categories.length) {
      e.categories = ['movement-infrastructure'];
      warn(`${id}: no valid category, defaulted to movement-infrastructure`);
    }
    if (!e.sources.length && !raw._stub) warn(`${id}: has no sources`);
    return e;
  }

  function mergeEntity(a, b) {
    merges.push(`${b.id} (${b.section}) → ${a.id} (${a.section})`);
    for (const k of ['aliases', 'categories', 'species', 'regions', 'countries', 'interventions']) a[k] = uniq([...a[k], ...b[k]]);
    if (b.name !== a.name) a.aliases = uniq([...a.aliases, b.name]);
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

  // ---- Entities -------------------------------------------------------------------------------------
  const entities = new Map(); // id → entity
  const aliasIdx = new Map(); // normalized alias → id (for resolving references and merging profiles)
  const ambiguous = new Set(); // aliases claimed by more than one entity (e.g. "AAA")
  const hostIdx = new Map(); // website host → id
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

  function indexAliases(e) {
    for (const a of [e.id.replace(/-/g, ' '), e.name, ...e.aliases, ...(e._mergedIds || []).map((x) => x.replace(/-/g, ' '))]) {
      const n = normalizeName(a);
      if (!n) continue;
      const prev = aliasIdx.get(n);
      if (prev && prev !== e.id) {
        if (!ambiguous.has(n)) warn(`alias "${a}" is used by both ${prev} and ${e.id} — not used for matching`);
        ambiguous.add(n);
      } else if (!prev) aliasIdx.set(n, e.id);
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

  for (const f of entityFiles) {
    const section = f.dir === 'curated' ? 'movement' : f.name.split('-')[0];
    for (const raw of f.records) addEntity(cleanEntity(raw, section));
  }

  // ---- Entity overrides --------------------------------------------------------------------------------
  // Each patched field is cleaned exactly as a research record would be (a typo in kind or a category is
  // dropped with a warning, not published), and the entity's names are indexed again so aliases added by
  // an override are used for matching. Overrides for entities that exist now are applied before events are
  // read; overrides for stubs, which events create, are applied after.
  const entityOverrides = overrides.entities || {};
  const ENTITY_FIELDS = {
    name: (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
    aliases: (v) => (Array.isArray(v) ? uniq(v.map((a) => String(a).trim())) : undefined),
    kind: (v) => (ENUMS.kind.includes(v) ? v : undefined),
    parent_id: (v) => (v === null ? null : typeof v === 'string' && v ? slug(v) : undefined),
    categories: (v, id) => { const c = Array.isArray(v) ? cleanEnum(v, ENUMS.categories, CATEGORY_ALIASES, 'category', id) : []; return c.length ? c : undefined; },
    species: (v, id) => (Array.isArray(v) ? cleanEnum(v, ENUMS.species, SPECIES_ALIASES, 'species', id) : undefined),
    regions: (v, id) => (Array.isArray(v) ? cleanEnum(v, ENUMS.regions, null, 'region', id) : undefined),
    interventions: (v, id) => (Array.isArray(v) ? cleanEnum(v, ENUMS.interventions, null, 'intervention', id) : undefined),
    countries: (v) => (Array.isArray(v) ? uniq(v.map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))) : undefined),
    approach: (v) => (ENUMS.approach.includes(v) ? v : undefined),
    status: (v) => (ENUMS.status.includes(v) ? v : undefined),
    section: (v) => (ENUMS.section.includes(v) ? v : undefined),
    summary: (v) => (v === null ? null : typeof v === 'string' ? v.trim() : undefined),
    website: (v) => (v === null ? null : isUrl(v) ? v : undefined),
    hq: (v) => (v === null || typeof v === 'string' ? v : undefined),
    founded: (v) => (v === null ? null : /^\d{4}/.test(String(v)) ? String(v).slice(0, 4) : undefined),
    notes: (v) => (v === null || typeof v === 'string' ? v : undefined),
    sources: (v) => (Array.isArray(v) ? v.filter((s) => s && s.url) : undefined),
    feeds: (v, id) => (Array.isArray(v) ? cleanFeeds(v, id) : undefined),
    last_checked: (v) => (v === null || isIsoDate(v) ? v : undefined),
    stub: (v) => (typeof v === 'boolean' ? v : undefined),
  };
  const appliedEntityOverrides = new Set();
  function applyEntityOverrides() {
    for (const [id, patch] of Object.entries(entityOverrides)) {
      if (appliedEntityOverrides.has(id) || !entities.has(id)) continue;
      appliedEntityOverrides.add(id);
      const e = entities.get(id);
      for (const [k, v] of Object.entries(patch || {})) {
        if (k.startsWith('_')) continue;
        const clean = ENTITY_FIELDS[k];
        if (!clean) { warn(`override ${id}: unknown entity field "${k}" — ignored`); continue; }
        const out = clean(v, id);
        if (out === undefined) { warn(`override ${id}: bad ${k} ${JSON.stringify(v)} — ignored`); continue; }
        e[k] = out;
      }
      indexAliases(e);
    }
  }
  applyEntityOverrides();

  // ---- Events -------------------------------------------------------------------------------------------
  function ensureEntity(ref, kind, contextId) {
    if (!ref) return null;
    const hit = resolve(ref);
    if (hit) return hit;
    const id = slug(ref);
    const name = id.split('-').map((w) => (w.length <= 3 && w !== 'the' ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
    const e = cleanEntity({
      id, name, kind, categories: [kind === 'funder' ? 'funding' : 'advocacy-campaigns'], status: 'unclear', _stub: true,
      summary: null, sources: [], notes: `Stub: referenced by record ${contextId}; profile not yet researched.`,
    }, 'funding');
    e.stub = true;
    stubs.push(`${id} (from ${contextId})`);
    addEntity(e);
    return id;
  }

  const cleanCurrency = (v, id) => {
    if (v === null || v === undefined || v === '') return null;
    const c = String(v).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(c)) return c;
    warn(`event ${id}: currency ${JSON.stringify(v)} is not a 3-letter code — cleared`);
    return null;
  };
  const cleanDeadline = (v, id) => {
    if (v === null || v === undefined || v === '') return null;
    if (isIsoDate(v)) return v;
    warn(`event ${id}: deadline ${JSON.stringify(v)} is not a YYYY-MM-DD date — cleared (put the wording in notes)`);
    return null;
  };
  // The funder's own record id, when the research notes give one (EA Funds: "record id rec…").
  const recordIdOf = (raw) => raw.source_record_id || /\brecord id ([A-Za-z0-9_-]{6,})/i.exec(raw.notes || '')?.[1] || null;

  const events = new Map();
  for (const f of eventFiles) {
    for (const raw of f.records) {
      const id = slug(raw.id || `${raw.title}-${raw.event_date || ''}`);
      if (!ENUMS.eventType.includes(raw.type)) { warn(`event ${id}: unknown type "${raw.type}" — skipped`); continue; }
      if (!raw.source_url) { warn(`event ${id}: no source_url — skipped`); continue; }
      const funder = ensureEntity(raw.funder_id, 'funder', id);
      const recipient = ensureEntity(raw.recipient_id, 'organisation', id);
      const linked = uniq([...(raw.entity_ids || []).map((r) => ensureEntity(r, 'organisation', id)), funder, recipient]);
      // When the source was last confirmed to say this: the record's own date, never the build date.
      const lastChecked = raw.last_checked || raw.accessed || null;
      if (!lastChecked) warn(`event ${id}: no accessed date — "last checked" will show as unknown`);
      const ev = {
        id,
        type: raw.type,
        title: String(raw.title || '').trim(),
        summary: raw.summary || null,
        event_date: raw.event_date || null,
        source_published: raw.source_published || null,
        last_checked: lastChecked,
        source_url: raw.source_url,
        source_title: raw.source_title || null,
        amount: typeof raw.amount === 'number' ? raw.amount : null,
        currency: cleanCurrency(raw.currency, id),
        funder_id: funder,
        recipient_id: recipient,
        deadline: cleanDeadline(raw.deadline, id),
        call_state: null,
        status: ENUMS.eventStatus.includes(raw.status) ? raw.status : 'reported',
        conflicts_with: [],
        origin: 'curated',
        notes: raw.notes || null,
        entity_ids: linked,
        _sameAs: raw.same_as ? slug(raw.same_as) : null,
        _recordId: recordIdOf(raw),
      };
      if (events.has(id)) warn(`event ${id}: duplicate id in ${f.name} — later copy kept`);
      events.set(id, ev);
    }
  }

  applyEntityOverrides(); // stubs created by events
  for (const id of Object.keys(entityOverrides)) if (!appliedEntityOverrides.has(id)) warn(`override for unknown entity ${id}`);

  // ---- Reconciliation ---------------------------------------------------------------------------------
  // Records are merged only on strong identity: an explicit same_as, or two records identical in every field
  // that identifies them. Anything weaker (same funder, recipient, month and amount; same call page and
  // date) is a warning for a person to settle with same_as, because two real grants can look alike: EA
  // Funds gave Shrimp Welfare Project two separate $72,000 grants in its 2026 Q1 round.
  const eventOverrides = overrides.events || {};
  const mergedInto = new Map(); // merged-away id → kept id
  function mergeEvent(keep, dupe, why) {
    keep.entity_ids = uniq([...keep.entity_ids, ...dupe.entity_ids]);
    // Facts missing from the kept record are taken from the other; fields that describe the kept record's own
    // source page (its title, publication date and when it was checked) are not.
    for (const k of ['summary', 'event_date', 'amount', 'currency', 'funder_id', 'recipient_id', 'deadline']) {
      if (keep[k] === null && dupe[k] !== null) keep[k] = dupe[k];
    }
    if (dupe.source_url !== keep.source_url) keep.notes = [keep.notes, `Also reported at ${dupe.source_url}`].filter(Boolean).join(' | ');
    events.delete(dupe.id);
    mergedInto.set(dupe.id, keep.id);
    merges.push(`event ${dupe.id} → ${keep.id} (${why})`);
  }

  for (const ev of [...events.values()]) {
    const target = eventOverrides[ev.id]?.same_as ? slug(eventOverrides[ev.id].same_as) : ev._sameAs;
    if (!target || target === ev.id || !events.has(ev.id)) continue;
    const keep = events.get(mergedInto.get(target) || target);
    if (!keep) { warn(`event ${ev.id}: same_as "${target}" is not a known event — kept separate`); continue; }
    mergeEvent(keep, ev, 'same_as');
  }

  const identity = (ev) => JSON.stringify([ev.type, ev.source_url, ev.funder_id, ev.recipient_id, ev.event_date, ev.deadline, ev.amount,
    ev.currency, normalizeName(ev.title), normalizeName(ev.summary || ''), ev._recordId]);
  const firstOfIdentity = new Map();
  for (const ev of [...events.values()]) {
    const k = identity(ev);
    if (firstOfIdentity.has(k)) mergeEvent(firstOfIdentity.get(k), ev, 'identical record');
    else firstOfIdentity.set(k, ev);
  }

  const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));
  const groupBy = (list, keyOf) => {
    const g = new Map();
    for (const x of list) { const k = keyOf(x); if (k) (g.get(k) || g.set(k, []).get(k)).push(x); }
    return [...g.values()].filter((v) => v.length > 1);
  };
  const distinctRecords = (a, b) => a._recordId && b._recordId && a._recordId !== b._recordId;

  // Grants: same funder, recipient and month. Dates without a month (just a year) or with no date are never
  // compared: a year is not precise enough to say two grants are one.
  const month = (d) => (typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
  const grants = [...events.values()].filter((ev) => ev.type === 'grant_awarded' && ev.funder_id && ev.recipient_id);
  for (const group of groupBy(grants, (ev) => month(ev.event_date) && `${ev.funder_id}|${ev.recipient_id}|${month(ev.event_date)}`)) {
    const disputed = new Set();
    for (const [a, b] of pairs(group)) {
      if (distinctRecords(a, b)) continue; // separate rows in the funder's own database
      if (a.amount === null || b.amount === null) continue; // an unknown amount is not a disagreement
      if (a.amount === b.amount && a.currency === b.currency) {
        warn(`Possible duplicate grants kept separate: ${a.id}, ${b.id} (same funder, recipient, month and amount). If they are one grant, add "same_as" to one of them.`);
        continue;
      }
      a.conflicts_with = uniq([...a.conflicts_with, b.id]);
      b.conflicts_with = uniq([...b.conflicts_with, a.id]);
      disputed.add(a).add(b);
    }
    for (const g of disputed) g.status = 'disputed';
    if (disputed.size) warn(`Conflicting grant reports kept side by side: ${[...disputed].map((g) => g.id).join(', ')}`);
  }

  // Other records: the same funder's record of the same type on the same page and date, or the same funder's
  // call with the same deadline, is very likely one record entered twice. (A page and date alone are not
  // enough: one newsletter issue lists many different calls.)
  const others = [...events.values()].filter((ev) => ev.type !== 'grant_awarded');
  const warned = new Set();
  for (const keyOf of [
    (ev) => ev.funder_id && ev.event_date && `${ev.type}|${ev.funder_id}|${ev.source_url}|${ev.event_date}`,
    (ev) => ev.funder_id && ev.deadline && `${ev.type}|${ev.funder_id}|${ev.deadline}`,
  ]) {
    for (const group of groupBy(others, keyOf)) {
      for (const [a, b] of pairs(group)) {
        const k = `${a.id}|${b.id}`;
        if (warned.has(k) || distinctRecords(a, b)) continue;
        warned.add(k);
        warn(`Possible duplicate records kept separate: ${a.id}, ${b.id}. If they are one record, add "same_as" to one of them.`);
      }
    }
  }

  // ---- Event overrides ----------------------------------------------------------------------------------
  // Applied after reconciliation, so a reviewed value (a status set back to confirmed, say) is final.
  const EVENT_FIELDS = {
    type: (v) => (ENUMS.eventType.includes(v) ? v : undefined),
    status: (v) => (ENUMS.eventStatus.includes(v) ? v : undefined),
    call_state: (v) => (v === null || ENUMS.callState.includes(v) ? v : undefined),
    title: (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
    summary: (v) => (v === null || typeof v === 'string' ? v : undefined),
    notes: (v) => (v === null || typeof v === 'string' ? v : undefined),
    source_title: (v) => (v === null || typeof v === 'string' ? v : undefined),
    source_url: (v) => (isUrl(v) ? v : undefined),
    event_date: (v) => (v === null || (typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)) ? v : undefined),
    source_published: (v) => (v === null || isIsoDate(v) ? v : undefined),
    last_checked: (v) => (v === null || isIsoDate(v) ? v : undefined),
    accessed: (v) => (isIsoDate(v) ? v : undefined),
    deadline: (v) => (v === null || isIsoDate(v) ? v : undefined),
    amount: (v) => (v === null || (typeof v === 'number' && Number.isFinite(v)) ? v : undefined),
    currency: (v) => (v === null ? null : typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined),
    conflicts_with: (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined),
  };
  for (const [id, patch] of Object.entries(eventOverrides)) {
    const ev = events.get(id);
    if (!ev) {
      warn(mergedInto.has(id) ? `override for event ${id}, which was merged into ${mergedInto.get(id)} — move the override there` : `override for unknown event ${id}`);
      continue;
    }
    for (const [k, v] of Object.entries(patch || {})) {
      if (k.startsWith('_') || k === 'same_as') continue;
      const clean = EVENT_FIELDS[k];
      if (!clean) { warn(`override ${id}: unknown or unsupported event field "${k}" — ignored`); continue; }
      const out = clean(v);
      if (out === undefined) { warn(`override ${id}: bad ${k} ${JSON.stringify(v)} — ignored`); continue; }
      if (k === 'accessed') ev.last_checked = out; else ev[k] = out;
    }
  }

  // Grant records with no single recipient are round totals (all grants of a round). The Funding view
  // counts them separately, so the round's own per-recipient records are not added twice.
  const roundTotals = [...events.values()].filter((ev) => ev.type === 'grant_awarded' && !ev.recipient_id).map((ev) => ev.id);

  // ---- Sources ----------------------------------------------------------------------------------------
  const sources = [];
  for (const e of entities.values()) {
    e.feeds.forEach((f, i) => sources.push({ id: `${e.id}-feed${i ? i + 1 : ''}`, entity_id: e.id, url: f.url, kind: 'feed', cadence: 'daily', reuse: f.reuse }));
    if (e.website && e.kind !== 'banner') sources.push({ id: `${e.id}-home`, entity_id: e.id, url: e.website, kind: 'homepage', cadence: 'monthly', reuse: 'full' });
  }
  const seenUrls = new Set();
  const dedupedSources = sources.filter((s) => (seenUrls.has(s.url) ? false : seenUrls.add(s.url)));

  // Validate parent links
  for (const e of entities.values()) {
    if (e.parent_id && !entities.has(e.parent_id)) {
      const r = resolve(e.parent_id);
      if (r) e.parent_id = r; else { warn(`${e.id}: parent "${e.parent_id}" not found — cleared`); e.parent_id = null; }
    }
  }

  // ---- Names for mention detection -----------------------------------------------------------------------
  // Built from names and aliases as written (not ids, and without dropping words like "foundation"), so
  // "The Animal Law Foundation" is matched as "animal law foundation", never as the phrase "animal law".
  // A name two entities share is left out. Names under 4 characters are never used, so they are not stored.
  const mentionIdx = new Map(); // form → { id, alias }
  const mentionAmbiguous = new Map(); // form → Set of ids
  for (const e of entities.values()) {
    for (const alias of [e.name, ...e.aliases]) {
      const form = mentionForm(alias);
      if (form.length < 4) continue;
      const prev = mentionIdx.get(form);
      if (prev && prev.id !== e.id) (mentionAmbiguous.get(form) || mentionAmbiguous.set(form, new Set([prev.id])).get(form)).add(e.id);
      else if (!prev) mentionIdx.set(form, { id: e.id, alias });
    }
  }
  for (const [form, ids] of mentionAmbiguous) warn(`name "${form}" is used by ${[...ids].join(' and ')} — not used to detect mentions`);
  const mentionAliases = [...mentionIdx].filter(([form]) => !mentionAmbiguous.has(form)).map(([form, { id, alias }]) => ({ form, alias, entity_id: id }));

  return { entities, events, sources: dedupedSources, mentionAliases, roundTotals, warnings, merges, stubs };
}

// ---- Outputs ------------------------------------------------------------------------------------------
const profileOf = (e) => {
  const { id, name, kind, parent_id, section, status, last_checked, stub, _mergedIds, feeds, ...rest } = e;
  return { ...rest, merged_from: _mergedIds || [] };
};
const publicEvent = (ev) => {
  const { _sameAs, _recordId, ...rest } = ev;
  return rest;
};

export function seedSql(result, now) {
  const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const sql = ['-- generated by scripts/build-seed.mjs — do not edit by hand', ''];
  for (const e of result.entities.values()) {
    sql.push(`INSERT INTO entities (id,name,kind,parent_id,primary_category,section,status,profile,stub,last_checked,updated_at) VALUES (${[
      e.id, e.name, e.kind, e.parent_id, e.categories[0], e.section, e.status, JSON.stringify(profileOf(e)), e.stub ? 1 : 0, e.last_checked, now,
    ].map(q).join(',')});`);
  }
  for (const a of result.mentionAliases) sql.push(`INSERT OR IGNORE INTO aliases (alias_norm,alias,entity_id) VALUES (${q(a.form)},${q(a.alias)},${q(a.entity_id)});`);
  for (const ev of result.events.values()) {
    sql.push(`INSERT INTO events (id,type,title,summary,event_date,source_published,last_checked,source_url,source_title,amount,currency,funder_id,recipient_id,deadline,call_state,status,conflicts_with,origin,notes,created_at) VALUES (${[
      ev.id, ev.type, ev.title, ev.summary, ev.event_date, ev.source_published, ev.last_checked, ev.source_url, ev.source_title, ev.amount,
      ev.currency, ev.funder_id, ev.recipient_id, ev.deadline, ev.call_state, ev.status, JSON.stringify(ev.conflicts_with), ev.origin, ev.notes, now,
    ].map(q).join(',')});`);
    for (const eid of ev.entity_ids) sql.push(`INSERT OR IGNORE INTO event_entities (event_id,entity_id) VALUES (${q(ev.id)},${q(eid)});`);
  }
  for (const s of result.sources) {
    sql.push(`INSERT INTO sources (id,entity_id,url,kind,cadence,visibility,reuse) VALUES (${[s.id, s.entity_id, s.url, s.kind, s.cadence, 'public', s.reuse].map(q).join(',')});`);
  }
  return sql.join('\n') + '\n';
}

// Same shape as /api/snapshot; the page falls back to it when the API is unavailable.
export function staticSnapshot(result, now, nowMs = Date.parse(now)) {
  const sources = result.sources;
  return {
    generated_at: now,
    static: true,
    last_refresh: null,
    refresher: null,
    source_health: { total: sources.length, feeds: sources.filter((s) => s.kind === 'feed').length, checked: 0, failing: 0 },
    entities: [...result.entities.values()].map((e) => ({
      ...profileOf(e), id: e.id, name: e.name, kind: e.kind, parent_id: e.parent_id, primary_category: e.categories[0],
      section: e.section, status: e.status, stub: Boolean(e.stub), last_checked: e.last_checked,
      stale: !e.last_checked || nowMs - Date.parse(e.last_checked) > 180 * DAY,
      monitoring: sources.filter((s) => s.entity_id === e.id).map((s) => ({ kind: s.kind, cadence: s.cadence, last_checked: null, healthy: true })),
    })),
    events: [...result.events.values()].map((ev) => ({ ...publicEvent(ev), call_state: callState(ev, nowMs) })),
    changes: [],
  };
}

export function buildReport(result, now) {
  const count = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
  const ents = [...result.entities.values()];
  const { warnings, merges, stubs, sources, events, roundTotals } = result;
  return [
    `# Seed build report (${now})`, '',
    `- Entities: ${ents.length} (${ents.filter((e) => e.stub).length} stubs)`,
    `- Events: ${events.size}`,
    `- Sources: ${sources.length} (${sources.filter((s) => s.kind === 'feed').length} feeds, ${sources.filter((s) => s.reuse === 'headline').length} headline-only)`, '',
    '## Entities by primary category', ...Object.entries(count(ents.map((e) => ({ c: e.categories[0] })), 'c')).map(([k, v]) => `- ${k}: ${v}`), '',
    '## Events by type', ...Object.entries(count([...events.values()], 'type')).map(([k, v]) => `- ${k}: ${v}`), '',
    '## Reconciled (merged) records', ...(merges.length ? merges.map((m) => `- ${m}`) : ['- none']), '',
    '## Round totals (grant records with no single recipient; the Funding view counts them separately)',
    ...(roundTotals.length ? roundTotals.map((id) => `- ${id}`) : ['- none']), '',
    '## Stub entities created from references', ...(stubs.length ? stubs.map((m) => `- ${m}`) : ['- none']), '',
    '## Warnings', ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- none']), '',
  ].join('\n');
}

// ---- Guard against a build that silently loses records -------------------------------------------------
export function seedCounts(sql) {
  return {
    entities: (sql.match(/^INSERT INTO entities /gm) || []).length,
    events: (sql.match(/^INSERT INTO events /gm) || []).length,
  };
}

// Problems when the new build has more than maxDrop fewer entities or events than the committed seed.
export function shrinkProblems(prev, next, maxDrop = 0.1) {
  if (!prev) return [];
  return ['entities', 'events']
    .filter((k) => prev[k] > 0 && next[k] < prev[k] * (1 - maxDrop))
    .map((k) => `${k}: ${prev[k]} in the committed db/seed.sql, ${next[k]} now`);
}
