// Animal Movement Map — client. No framework; renders from a single snapshot.
// Data comes from /api/snapshot (live D1) and falls back to ./snapshot.json (static seed).

const CATEGORIES = [
  ['advocacy-campaigns', 'Advocacy & campaigns', 'Campaigns to change how companies, governments and the public treat animals.'],
  ['welfare-science', 'Welfare science', 'Research on sentience, pain and how to measure welfare.'],
  ['welfare-technology', 'Welfare technology', 'Tools that change conditions directly: stunning, monitoring, water quality.'],
  ['alt-protein', 'Alternative proteins', 'Plant-based, fermented and cultivated replacements for animal products.'],
  ['policy-law', 'Policy & law', 'Legislation, litigation and legal scholarship.'],
  ['funding', 'Funding', 'Grantmakers, funds and donor networks.'],
  ['incubation-careers', 'Incubation & careers', 'Charity incubators, fellowships and career support.'],
  ['movement-infrastructure', 'Movement infrastructure', 'Coalitions, shared services, data and coordination.'],
  ['community-media', 'Community & media', 'Journalism, podcasts, events and community spaces.'],
  ['sanctuary-rescue', 'Sanctuary & rescue', 'Sanctuaries and rescue networks caring for animals directly.'],
  ['direct-action', 'Direct action & abolitionist', 'Abolitionist groups, and groups using protest, open rescue or other direct action.'],
];
const CAT = Object.fromEntries(CATEGORIES.map(([id, label, desc]) => [id, { label, desc }]));

const KIND = { organisation: 'Organisation', programme: 'Programme', funder: 'Funder', resource: 'Resource', network: 'Network / coalition', banner: 'Banner (leaderless name)' };
const SPECIES = {
  'farmed-fish': 'Farmed fish', 'wild-fish': 'Wild-caught fish', crustaceans: 'Shrimp & crustaceans', cephalopods: 'Octopus & cephalopods',
  chickens: 'Chickens', pigs: 'Pigs', cows: 'Cows', 'farmed-animals': 'Farmed animals (general)', 'wild-animals': 'Wild animals',
  insects: 'Insects', 'companion-animals': 'Companion animals', 'animals-in-research': 'Animals in research', 'fur-animals': 'Animals farmed for fur', 'all-animals': 'All animals',
};
const AQUATIC = new Set(['farmed-fish', 'wild-fish', 'crustaceans', 'cephalopods']);
const REGION = {
  global: 'Global', europe: 'Europe', uk: 'UK', 'north-america': 'North America', 'latin-america': 'Latin America', asia: 'Asia',
  'south-asia': 'South Asia', 'southeast-asia': 'Southeast Asia', 'east-asia': 'East Asia', africa: 'Africa', 'middle-east': 'Middle East', oceania: 'Oceania',
};
// A group tagged with the wider region works across it, so it is relevant to its parts but is not specific to them.
const REGION_PARENT = { 'south-asia': 'asia', 'southeast-asia': 'asia', 'east-asia': 'asia', uk: 'europe' };
const INTERVENTION = {
  'corporate-campaigns': 'Corporate campaigns', 'legislation-policy': 'Legislation & policy', litigation: 'Litigation', research: 'Research',
  'humane-slaughter': 'Stunning & slaughter', 'farm-practices': 'Farm practices', 'producer-engagement': 'Producer engagement',
  'certification-standards': 'Certification & standards', 'alt-proteins': 'Alternative proteins', 'public-awareness': 'Public awareness',
  'diet-change': 'Diet change', protest: 'Protest', 'open-rescue': 'Open rescue', 'direct-action': 'Direct action', investigations: 'Investigations',
  'capacity-building': 'Capacity building', grantmaking: 'Grantmaking', 'careers-talent': 'Careers & talent', 'data-tools': 'Data & tools',
  education: 'Education', sanctuary: 'Sanctuary',
};
const APPROACH = { 'welfare-reform': 'Welfare reform', abolitionist: 'Abolitionist', mixed: 'Mixed', research: 'Research', 'neutral-infrastructure': 'Movement infrastructure', unclear: 'Not stated' };
const STATUS = { active: 'Active', inactive: 'Inactive', unclear: 'Not confirmed' };
const EVENT_TYPE = {
  grant_awarded: 'Grant awarded', open_call: 'Funding call', announcement: 'Announcement', plan_announced: 'Plan announced',
  project_active: 'Active project', report_published: 'Report', campaign_outcome: 'Campaign outcome', legal_development: 'Legal development',
};
const SIGNAL = { funding: 'Funding news', open_call: 'Funding call', legal: 'Legal / policy', campaign_outcome: 'Campaign outcome', report: 'Report / research', launch: 'Launch / expansion', people: 'People & roles' };
const STATUS_HELP = {
  confirmed: 'Confirmed by the primary source', reported: 'Reported by a source; not independently confirmed',
  uncertain: 'Uncertain: needs checking', disputed: 'Sources disagree; all versions are shown', superseded: 'Superseded by a later record',
};

// Extra words people search with. They widen search only; they are never shown.
const SPECIES_WORDS = {
  'farmed-fish': 'fish fishes aquaculture salmon trout tilapia carp aquatic', 'wild-fish': 'fish fishes fishing fisheries bycatch aquatic',
  crustaceans: 'shrimp shrimps prawn prawns crab crabs lobster lobsters crustacean decapod decapods aquatic',
  cephalopods: 'octopus octopuses squid cuttlefish cephalopod aquatic', chickens: 'chicken hen hens broiler broilers poultry egg eggs',
  pigs: 'pig sow sows pork', cows: 'cow cattle dairy beef calves', 'farmed-animals': 'farm farmed livestock', 'wild-animals': 'wildlife',
  insects: 'insect', 'companion-animals': 'dog dogs cat cats pet pets', 'animals-in-research': 'laboratory lab testing experiments', 'fur-animals': 'fur mink',
};
const REGION_WORDS = { uk: 'united kingdom britain british', europe: 'european eu', 'north-america': 'america american', global: 'worldwide international' };
const KIND_WORDS = { funder: 'funders grantmaker foundation fund', resource: 'report database dataset standard', network: 'coalition alliance', programme: 'program project' };
const STOP = new Set(['in', 'the', 'of', 'and', 'for', 'on', 'who', 'works', 'work', 'working', 'with', 'to', 'a', 'an', 'is', 'are', 'which', 'what', 'that', 'do', 'does', 'doing', 'org', 'orgs', 'organisation', 'organisations', 'organization', 'organizations', 'group', 'groups']);

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const byName = (a, b) => a.name.localeCompare(b.name);
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

let countryNames = null;
try { countryNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
function countryName(code) {
  try { return countryNames?.of(code) || code; } catch { return code; }
}

function fmtDate(d, { precise = false } = {}) {
  if (!d) return '—';
  if (/^\d{4}$/.test(d)) return d;
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(d + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const t = Date.parse(d);
  if (Number.isNaN(t)) return esc(d);
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(precise ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'UTC' });
}
function ago(d) {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - Date.parse(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}
// Returns HTML-safe text: callers put it straight into innerHTML.
function money(n, cur) {
  if (n == null) return '—';
  try { return esc(new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n)); }
  catch { return esc(`${Number(n).toLocaleString('en-GB')} ${cur || ''}`.trim()); }
}

// Mirrors src/lib/calls.js: a deadline more than a day past closes a call, whatever the data says. The
// static snapshot and the edge-cached API response were computed earlier than now.
function currentCallState(ev, now = Date.now()) {
  if (ev.type !== 'open_call') return ev.call_state ?? null;
  const ok = typeof ev.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.deadline);
  const t = ok ? Date.parse(`${ev.deadline}T00:00:00Z`) : NaN;
  return !Number.isNaN(t) && t + 86400000 < now ? 'closed' : ev.call_state;
}

// Marker shape = kind of entry. Colour repeats the wave mark (works on aquatic animals); it is never the only cue.
function glyph(e) {
  const cls = `glyph${isAquatic(e) ? ' aq' : ''}`;
  const s = (inner) => `<svg class="${cls}" viewBox="0 0 12 12" aria-hidden="true">${inner}</svg>`;
  switch (e.kind) {
    case 'programme': return s('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>');
    case 'funder': return s('<path d="M6 .8 11.2 6 6 11.2.8 6Z" fill="currentColor"/>');
    case 'resource': return s('<rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="currentColor"/>');
    case 'network': return s('<path d="M6 1 11 10.5H1Z" fill="currentColor"/>');
    case 'banner': return s('<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.6"/>');
    default: return s('<circle cx="6" cy="6" r="5" fill="currentColor"/>');
  }
}
const WAVE_ICON = '<svg class="wave" viewBox="0 0 14 8" aria-hidden="true"><path d="M1 5c1.4-3 2.8-3 4.2 0s2.8 3 4.2 0 2.4-2.6 3.6-1.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const WAVE = `${WAVE_ICON}<span class="vh">, works on aquatic animals</span>`;

// ---------------------------------------------------------------------------
const state = {
  data: null, live: false, byId: {}, view: null, profile: null, opener: null,
  changesMode: 'checked', changesLimit: 30, dirSort: ['name', 1], dirLimit: 60,
  gridCols: 'regions', cell: null, sectionOpen: {},
  f: { q: '', species: new Set(), region: '', incGlobal: true, intervention: '', kind: '', aquatic: false, direct: true },
};

function isAquatic(e) { return e.section === 'aquatic' || (e.species || []).some((s) => AQUATIC.has(s)); }
function isDirect(e) { return (e.categories || []).includes('direct-action'); }

// ---- Search -----------------------------------------------------------------
// Search reads names and summaries and also every tag (animals, regions, countries, methods, focus, type).
function indexEntity(e) {
  const parts = [
    e.name, ...(e.aliases || []), e.summary, e.hq, ...(e.countries || []).map(countryName),
    ...(e.species || []).flatMap((s) => [SPECIES[s], SPECIES_WORDS[s]]),
    ...(e.regions || []).flatMap((r) => [REGION[r], REGION_WORDS[r]]),
    ...(e.interventions || []).map((i) => INTERVENTION[i]),
    ...(e.categories || []).map((c) => CAT[c]?.label),
    KIND[e.kind], KIND_WORDS[e.kind], e.approach && e.approach !== 'unclear' ? APPROACH[e.approach] : '',
  ];
  e._text = fold(parts.filter(Boolean).join(' '));
  e._words = [...new Set(e._text.split(/[^a-z0-9]+/).filter((w) => w.length >= 4))];
}

// Edit distance, stopping early once it passes `max`.
function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

let plan = { q: null, tokens: [], fuzzy: [] };
function queryPlan() {
  const q = state.f.q;
  if (plan.q === q) return plan;
  let toks = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  const kept = toks.filter((t) => !STOP.has(t));
  if (kept.length) toks = kept;
  const ents = state.data.entities;
  // A word nothing contains is probably misspelt: fall back to close spellings for that word only.
  const tokens = toks.map((t) => ({ t, fuzzy: t.length >= 4 && !ents.some((e) => e._text.includes(t)) }));
  plan = { q, tokens, fuzzy: tokens.filter((x) => x.fuzzy).map((x) => x.t) };
  return plan;
}
function matchesQuery(e) {
  return queryPlan().tokens.every(({ t, fuzzy }) => (fuzzy ? e._words.some((w) => near(w, t, t.length >= 8 ? 2 : 1)) : e._text.includes(t)));
}

// ---- Filters ----------------------------------------------------------------
// 'specific' = tagged with the region (or a part of it); 'wider' = tagged with the region it belongs to;
// 'global' = worldwide remit. The last two are relevant, but they are labelled so they can't pass as local.
function regionFit(e, r) {
  const rs = e.regions || [];
  if (rs.includes(r)) return 'specific';
  if (Object.entries(REGION_PARENT).some(([child, parent]) => parent === r && rs.includes(child))) return 'specific';
  if (REGION_PARENT[r] && rs.includes(REGION_PARENT[r])) return 'wider';
  if (rs.includes('global')) return 'global';
  return null;
}
function fitTag(e, r) {
  const fit = r ? regionFit(e, r) : null;
  return fit === 'global' ? 'global' : fit === 'wider' ? `${REGION[REGION_PARENT[r]]}-wide` : '';
}

function matches(e, { skipTags = false, forceGlobal = false } = {}) {
  const f = state.f;
  if (!f.direct && isDirect(e)) return false;
  if (f.aquatic && !isAquatic(e)) return false;
  if (!skipTags) {
    if (f.species.size && !(e.species || []).some((s) => f.species.has(s))) return false;
    if (f.region) {
      const fit = regionFit(e, f.region);
      if (!fit || (fit !== 'specific' && !f.incGlobal && !forceGlobal)) return false;
    }
  }
  if (f.intervention && !(e.interventions || []).includes(f.intervention)) return false;
  if (f.kind && e.kind !== f.kind) return false;
  if (f.q && !matchesQuery(e)) return false;
  return true;
}
function filtersActive() {
  const f = state.f;
  return Boolean(f.q || f.species.size || f.region || f.intervention || f.kind || f.aquatic || !f.direct);
}
function resetFilters() {
  Object.assign(state.f, { q: '', species: new Set(), region: '', incGlobal: true, intervention: '', kind: '', aquatic: false, direct: true });
  state.cell = null;
}

// Filters live in the link, so a filtered view can be shared and survives a reload.
function syncUrl() {
  const f = state.f;
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.species.size) p.set('animals', [...f.species].join(','));
  if (f.region) p.set('region', f.region);
  if (f.region && !f.incGlobal) p.set('global', '0');
  if (f.intervention) p.set('method', f.intervention);
  if (f.kind) p.set('type', f.kind);
  if (f.aquatic) p.set('scope', 'aquatic');
  if (!f.direct) p.set('direct', '0');
  if (state.gridCols === 'methods') p.set('cols', 'methods');
  if (state.cell) p.set('cell', state.cell.replace('|', '.'));
  const qs = p.toString();
  try { history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash); } catch {}
}
function readUrl() {
  const p = new URLSearchParams(location.search);
  const f = state.f;
  f.q = (p.get('q') || '').slice(0, 120);
  f.species = new Set((p.get('animals') || '').split(',').filter((s) => SPECIES[s]));
  f.region = REGION[p.get('region')] ? p.get('region') : '';
  f.incGlobal = p.get('global') !== '0';
  f.intervention = INTERVENTION[p.get('method')] ? p.get('method') : '';
  f.kind = KIND[p.get('type')] ? p.get('type') : '';
  f.aquatic = p.get('scope') === 'aquatic';
  if (p.has('direct')) f.direct = p.get('direct') !== '0';
  else { try { if (localStorage.getItem('amm-direct') === '0') f.direct = false; } catch {} }
  state.gridCols = p.get('cols') === 'methods' ? 'methods' : 'regions';
  const cell = (p.get('cell') || '').split('.');
  state.cell = cell.length === 2 && SPECIES[cell[0]] && (REGION[cell[1]] || INTERVENTION[cell[1]]) ? cell.join('|') : null;
}

// ---- Shared pieces ------------------------------------------------------------
function marker(e, tag = fitTag(e, state.f.region)) {
  return `<li><button class="marker${e.stub ? ' stub' : ''}" data-id="${esc(e.id)}" title="${esc(KIND[e.kind] || e.kind)}${e.stub ? ' · not yet researched' : ''}">${glyph(e)}<span class="name">${esc(e.name)}${isAquatic(e) ? WAVE : ''}</span>${tag ? `<span class="fit">${esc(tag)}</span>` : ''}</button></li>`;
}

function viewbar(note) {
  const aq = state.f.aquatic;
  return `<div class="viewbar">
    <div class="scope" role="group" aria-label="Scope">
      <button type="button" data-scope="all" aria-pressed="${!aq}">Whole movement</button>
      <button type="button" data-scope="aquatic" aria-pressed="${aq}">Fish &amp; aquatic</button>
    </div>
    <p class="vnote" role="status">${note}</p>
  </div>`;
}

// Says what the list is, and never lets a global group pass as a local one.
function resultNote(list, what = 'entries') {
  const f = state.f;
  const total = state.data.entities.length;
  const bits = [];
  if (f.q && queryPlan().fuzzy.length) bits.push(`No exact match for “${esc(queryPlan().fuzzy.join(' '))}”, so close spellings are shown.`);
  if (f.region) {
    const all = state.data.entities.filter((e) => matches(e, { forceGlobal: true }));
    const specific = all.filter((e) => regionFit(e, f.region) === 'specific').length;
    const wider = all.length - specific;
    bits.push(`<strong>${specific}</strong> work in ${esc(REGION[f.region])} specifically.`);
    if (wider) {
      bits.push(f.incGlobal
        ? `${wider} more work globally or region-wide. <button class="reset" type="button" data-global="0">Hide those</button>`
        : `<button class="reset" type="button" data-global="1">Show ${wider} that work globally or region-wide</button>`);
    }
  } else if (filtersActive()) {
    bits.push(`<strong>${list.length}</strong> of ${total} ${what} match.`);
  } else {
    bits.push(`${total} ${what}. A missing name doesn't mean nobody does that work.`);
  }
  return bits.join(' ');
}

const KEY_ORDER = ['organisation', 'programme', 'network', 'funder', 'resource', 'banner'];
const KEY_LABEL = { organisation: 'Organisation', programme: 'Programme of another organisation', network: 'Network or coalition', funder: 'Funder', resource: 'Resource (report, database, standard)', banner: 'Leaderless banner (not an organisation)' };
function keyHtml(list) {
  const kinds = new Set(list.map((e) => e.kind));
  const items = [
    list.some(isAquatic) && !list.every(isAquatic) ? `<span>${WAVE_ICON} Works on aquatic animals</span>` : '',
    ...KEY_ORDER.filter((k) => kinds.has(k)).map((k) => `<span>${glyph({ kind: k })} ${esc(KEY_LABEL[k])}</span>`),
    list.some((e) => e.stub) ? '<span><span class="stubname">Grey name</span> Named in a grant record; not yet researched</span>' : '',
  ].join('');
  return `<details class="key"${isPhone() ? '' : ' open'}><summary>Key</summary><div class="legend">${items}</div></details>`;
}

const emptyHtml = () => '<p class="muted empty">Nothing matches. <button class="reset" type="button" data-clear>Clear search and filters</button></p>';

// ---- Map ----------------------------------------------------------------------
function renderMap() {
  const f = state.f;
  const ents = state.data.entities.filter((e) => matches(e));
  const rank = (e) => (f.region ? { specific: 0, wider: 1, global: 2 }[regionFit(e, f.region)] ?? 3 : 0);
  const order = (a, b) => rank(a) - rank(b) || Number(a.stub) - Number(b.stub) || byName(a, b);
  // On a phone the full map is several screens of names, so sections start closed and show the overview first.
  const autoOpen = !isPhone() || filtersActive() || ents.length <= 40;
  const blocks = CATEGORIES.map(([id, label, desc]) => {
    const primary = ents.filter((e) => e.primary_category === id).sort(order);
    // An entry sits under its main focus and is repeated under every other area it works in.
    const also = ents.filter((e) => e.primary_category !== id && (e.categories || []).includes(id)).sort(order);
    if (!primary.length && !also.length) return null;
    const open = state.sectionOpen[id] ?? autoOpen;
    const wide = primary.length + also.length > 24;
    return { wide, html: `<details class="territory${wide ? ' wide' : ''}" data-cat="${id}"${open ? ' open' : ''}>
      <summary><h2>${esc(label)}</h2><span class="count">${primary.length || ''}</span></summary>
      <p class="desc">${esc(desc)}</p>
      ${id === 'direct-action' ? '<p class="desc review">Included to test coverage. Listing is not endorsement and implies no link to other groups here.</p>' : ''}
      ${primary.length ? `<ul class="markers">${primary.map((e) => marker(e)).join('')}</ul>` : ''}
      ${also.length ? `<h3 class="also">Also work in this area (${also.length})</h3><ul class="markers">${also.map((e) => marker(e)).join('')}</ul>` : ''}
    </details>` };
  }).filter(Boolean);
  // Long sections span the page with their own columns; short ones pack into columns below them.
  const html = [...blocks.filter((b) => b.wide), ...blocks.filter((b) => !b.wide)].map((b) => b.html).join('');

  $('#view').innerHTML = `${viewbar(resultNote(ents))}
    ${ents.length ? `${keyHtml(ents)}<div class="chart${ents.every(isAquatic) ? ' all-aq' : ''}">${html}</div>` : emptyHtml()}`;
}

// ---- Coverage grid ----------------------------------------------------------------
// Animals down the side, regions (or methods) across the top, a count in every cell. Shade = one hue,
// light to dark; the number is always printed, so shade is never the only way to read a cell.
function renderCoverage() {
  const f = state.f;
  const byMethod = state.gridCols === 'methods';
  const colKey = byMethod ? 'interventions' : 'regions';
  const colDict = byMethod ? INTERVENTION : REGION;
  const colLabel = (c) => (byMethod ? INTERVENTION[c] : c === 'asia' ? 'Asia-wide' : REGION[c]);
  const has = (e, key, v) => (e[key] || []).includes(v);
  const base = state.data.entities.filter((e) => matches(e, { skipTags: true }));
  const rows = Object.keys(SPECIES).filter((s) => (!f.species.size || f.species.has(s)) && base.some((e) => has(e, 'species', s)));
  let cols = Object.keys(colDict).filter((c) => base.some((e) => has(e, colKey, c)));
  if (!byMethod) {
    const hasGlobal = cols.includes('global');
    cols = cols.filter((c) => c !== 'global' && (!f.region || c === f.region));
    if (hasGlobal) cols.push('global');
  }
  const cellList = (s, c) => base.filter((e) => has(e, 'species', s) && has(e, colKey, c));
  const counts = {};
  let max = 0;
  for (const s of rows) for (const c of cols) { const n = cellList(s, c).length; counts[`${s}|${c}`] = n; if (n > max) max = n; }
  const bin = (n) => (n ? Math.max(1, Math.ceil(5 * Math.sqrt(n / max))) : 0);
  if (state.cell && !(state.cell in counts)) state.cell = null;

  const table = `<div class="grid-wrap"><table class="grid${byMethod ? ' methods' : ''}">
    <caption class="vh">Number of entries by animal and ${byMethod ? 'method' : 'region'}</caption>
    <thead><tr><td></td>${cols.map((c) => `<th scope="col"><span>${esc(colLabel(c))}</span></th>`).join('')}</tr></thead>
    <tbody>${rows.map((s) => `<tr><th scope="row">${esc(SPECIES[s])}</th>${cols.map((c) => {
      const n = counts[`${s}|${c}`];
      const names = n ? cellList(s, c).slice(0, 6).map((e) => e.name).join(', ') + (n > 6 ? `, and ${n - 6} more` : '') : 'None in this sample';
      return `<td><button type="button" class="cell h${bin(n)}" data-cell="${s}|${c}" aria-pressed="${state.cell === `${s}|${c}`}"
        aria-label="${esc(SPECIES[s])}, ${esc(colLabel(c))}: ${n} ${n === 1 ? 'entry' : 'entries'}" title="${esc(names)}">${n || '·'}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <div class="heat-legend" aria-hidden="true"><span>Fewer</span><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i><i class="h5"></i><span>More</span><span class="sep">Empty cell: none in this sample, which is not proof that nobody does that work.</span></div>`;

  let panel = '<p class="muted cellhint">Select a cell to see who is in it.</p>';
  if (state.cell) {
    const [s, c] = state.cell.split('|');
    const list = cellList(s, c).sort(byName);
    const extra = !byMethod && c !== 'global' ? base.filter((e) => has(e, 'species', s) && !has(e, 'regions', c) && has(e, 'regions', 'global')).sort(byName) : [];
    panel = `<section class="cellpanel" aria-live="polite">
      <h2>${esc(SPECIES[s])} · ${esc(colLabel(c))}</h2>
      ${list.length
        ? `<p class="vnote">${list.length} ${list.length === 1 ? 'entry is' : 'entries are'} tagged with both.</p><ul class="markers cols">${list.map((e) => marker(e, '')).join('')}</ul>`
        : '<p class="vnote">Nothing in this sample is tagged with both. That can be a real gap or a gap in the map.</p>'}
      ${extra.length ? `<h3 class="also">${extra.length} more work on ${esc(SPECIES[s].toLowerCase())} globally</h3><ul class="markers cols">${extra.map((e) => marker(e, 'global')).join('')}</ul>` : ''}
    </section>`;
  }

  const seg = (m, l) => `<button type="button" data-cols="${m}" aria-pressed="${state.gridCols === m}">${l}</button>`;
  $('#view').innerHTML = `${viewbar(`${base.length} entries counted under every animal and ${byMethod ? 'method' : 'region'} they are tagged with.`)}
    <div class="seg" role="group" aria-label="Columns">${seg('regions', 'By region')}${seg('methods', 'By method')}</div>
    ${rows.length && cols.length ? table + panel : emptyHtml()}`;
}

// ---- Directory ------------------------------------------------------------------
function tagList(arr, dict, aqSet) {
  return `<span class="tags">${(arr || []).map((t) => `<span class="tag${aqSet && aqSet.has(t) ? ' aq' : ''}">${esc(dict[t] || t)}</span>`).join('')}</span>`;
}

function renderDirectory() {
  const f = state.f;
  const [key, dir] = state.dirSort;
  const val = (e) => (key === 'category' ? CAT[e.primary_category]?.label : key === 'checked' ? e.last_checked || '' : e.name);
  const all = state.data.entities.filter((e) => matches(e)).sort((a, b) => String(val(a) || '').localeCompare(String(val(b) || '')) * dir || byName(a, b));
  const rows = all.slice(0, state.dirLimit);
  const th = (k, label) => `<th scope="col" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${label}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  const opt = (k, d, label) => `<option value="${k}:${d}"${key === k && dir === d ? ' selected' : ''}>${label}</option>`;
  $('#view').innerHTML = `${viewbar(resultNote(all))}
    <label class="sortsel">Sort by <select id="dir-sort">${opt('name', 1, 'Name')}${opt('category', 1, 'Main focus')}${opt('checked', -1, 'Most recently checked')}</select></label>
    ${all.length ? `<div class="table-wrap"><table class="dir">
      <thead><tr>${th('name', 'Name')}${th('category', 'Main focus')}<th scope="col">Animals</th><th scope="col">Regions</th>${th('checked', 'Last checked')}</tr></thead>
      <tbody>${rows.map((e) => `<tr>
        <td><button class="rowlink" data-id="${esc(e.id)}">${esc(e.name)}</button>${isAquatic(e) ? ` ${WAVE}` : ''}<div class="sub">${esc(KIND[e.kind] || e.kind)}${e.stub ? ' · not yet researched' : ''}${e.aliases?.length ? ` · ${esc(e.aliases.slice(0, 2).join(', '))}` : ''}</div></td>
        <td>${esc(CAT[e.primary_category]?.label || e.primary_category)}</td>
        <td>${tagList(e.species, SPECIES, AQUATIC)}</td>
        <td>${tagList(e.regions, REGION)}${fitTag(e, f.region) ? ` <span class="fit">${esc(fitTag(e, f.region))}</span>` : ''}</td>
        <td class="mono checked">${fmtDate(e.last_checked)}${e.stale ? ' <span class="pill stale">stale</span>' : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${all.length > rows.length ? `<p class="more-row"><button class="btn secondary" type="button" data-more="dir">Show ${Math.min(60, all.length - rows.length)} more</button> <span class="muted">${rows.length} of ${all.length} shown</span></p>` : ''}` : emptyHtml()}`;
}

// ---- Changes -----------------------------------------------------------------------
function entityLinks(ids) {
  return `<span class="entity-links">${(ids || []).map((id) => state.byId[id]).filter(Boolean)
    .map((e) => `<button class="elink" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('<span class="muted">·</span>')}</span>`;
}

function changeItems(mode) {
  const active = filtersActive();
  const ok = (ids) => !active || ids.some((id) => state.byId[id] && matches(state.byId[id]));
  const today = new Date().toISOString().slice(0, 10);
  // Order by when the change became knowable: future-dated records (forthcoming calls, laws taking
  // effect later) sort by their publication or check date, not by the future date.
  const items = mode === 'auto'
    ? (state.data.changes || []).filter((c) => c.meaningful && ok([c.entity_id, ...(c.mentions || [])].filter(Boolean))).map((c) => ({ kind: 'auto', date: c.published || c.first_seen, c }))
    : state.data.events.filter((ev) => ok(ev.entity_ids)).map((ev) => ({ kind: 'checked', date: ev.event_date && ev.event_date <= today ? ev.event_date : ev.source_published || ev.last_checked || ev.event_date, ev }));
  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function monthGroup(d) {
  if (!d) return 'Date not stated';
  if (d.length < 7) return `${d.slice(0, 4)}, month not stated`;
  return new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function weekGroup(d) {
  const t = Date.parse(d);
  if (Number.isNaN(t)) return 'Date not stated';
  const monday = (ms) => { const x = new Date(ms); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime(); };
  const weeks = Math.round((monday(Date.now()) - monday(t)) / (7 * 86400000));
  if (weeks <= 0) return 'This week';
  if (weeks === 1) return 'Last week';
  return `Week of ${new Date(monday(t)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
}

// The three dates every record keeps apart. A date the source doesn't state is left out, not shown as a dash.
function datesLine(ev) {
  const today = new Date().toISOString().slice(0, 10);
  const verb = ev.type === 'open_call' ? (ev.event_date > today ? 'Opens' : 'Listed') : ev.event_date > today ? 'Due' : 'Happened';
  return [
    ev.event_date ? `${verb} <span class="mono">${fmtDate(ev.event_date)}</span>` : '',
    ev.deadline ? `deadline <span class="mono">${fmtDate(ev.deadline)}</span>` : '',
    ev.source_published ? `source published <span class="mono">${fmtDate(ev.source_published)}</span>` : '',
    ev.last_checked ? `last checked <span class="mono">${fmtDate(ev.last_checked)}</span>` : '',
  ].filter(Boolean).join(' · ');
}

function eventRow(ev, sortDate) {
  const amount = ev.amount != null ? ` · <span class="mono">${money(ev.amount, ev.currency)}</span>` : '';
  const state_ = ev.call_state ? `<span class="pill ${esc(ev.call_state)}">${ev.call_state === 'rolling-or-unstated' ? 'rolling / no deadline stated' : esc(ev.call_state)}</span>` : '';
  return `<li class="tl-item">
    <div class="tl-date">${fmtDate(sortDate || ev.event_date || ev.source_published)}</div>
    <div>
      <div class="meta kind"><span class="pill type">${esc(EVENT_TYPE[ev.type] || ev.type)}</span>${ev.status !== 'confirmed' ? `<span class="pill ${esc(ev.status)}" title="${esc(STATUS_HELP[ev.status] || '')}">${esc(ev.status)}</span>` : ''}${state_}</div>
      <h3>${safeUrl(ev.source_url) ? `<a href="${esc(ev.source_url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>` : esc(ev.title)}${amount}</h3>
      ${ev.summary ? `<p>${esc(ev.summary)}</p>` : ''}
      <div class="meta">${entityLinks(ev.entity_ids)}</div>
      <div class="meta dates">${datesLine(ev)}</div>
      ${ev.conflicts_with?.length ? `<div class="note review">Another source reports this differently: ${ev.conflicts_with.map((id) => esc(state.data.events.find((x) => x.id === id)?.title || id)).join('; ')}</div>` : ''}
      ${ev.notes ? `<details class="rnote"><summary>Research note</summary><p>${esc(ev.notes)}</p></details>` : ''}
    </div></li>`;
}

function feedRow(c) {
  const e = state.byId[c.entity_id];
  return `<li class="tl-item">
    <div class="tl-date">${fmtDate(c.published || c.first_seen)}</div>
    <div>
      ${c.signal ? `<div class="meta kind"><span class="pill auto" title="Picked by keyword rules; nobody has checked it">Possibly: ${esc((SIGNAL[c.signal] || c.signal).toLowerCase())}</span></div>` : ''}
      <h3>${safeUrl(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}</h3>
      ${c.excerpt ? `<p>${esc(c.excerpt.slice(0, 180))}${c.excerpt.length > 180 ? '…' : ''}</p>` : ''}
      <div class="meta">${e ? `From ${entityLinks([e.id])}` : ''}${c.mentions?.length ? ` · mentions ${entityLinks(c.mentions)}` : ''}${c.species?.length ? ` · ${c.species.map((s) => esc(SPECIES[s] || s)).join(', ')}` : ''}</div>
    </div></li>`;
}

function renderChanges() {
  const mode = state.changesMode;
  const nChecked = changeItems('checked').length;
  const nAuto = changeItems('auto').length;
  const all = changeItems(mode);
  const items = all.slice(0, state.changesLimit);
  let last = null;
  const rows = items.map((i) => {
    const g = mode === 'auto' ? weekGroup(i.date) : monthGroup(i.date);
    const head = g !== last ? `<li class="tl-group"><h2>${esc(g)}</h2></li>` : '';
    last = g;
    return head + (i.kind === 'checked' ? eventRow(i.ev, i.date) : feedRow(i.c));
  }).join('');
  const seg = (m, l) => `<button type="button" data-mode="${m}" aria-pressed="${mode === m}">${l}</button>`;
  const intro = mode === 'auto'
    ? 'Posts from organisations’ own feeds, picked out by keyword rules. Nobody has checked them, and some labels will be wrong.'
    : 'Grants, funding calls, reports and legal developments, each checked against its source.';
  $('#view').innerHTML = `${viewbar(esc(intro))}
    <div class="seg" role="group" aria-label="Which changes">${seg('checked', `Checked records (${nChecked})`)}${seg('auto', `Unchecked feed posts (${nAuto})`)}</div>
    <ul class="timeline">${rows || `<li class="muted empty">${mode === 'auto' && !state.live ? 'Feed posts appear here on the live site.' : 'Nothing matches these filters.'}</li>`}</ul>
    ${all.length > items.length ? `<p class="more-row"><button class="btn secondary" type="button" data-more="changes">Show ${Math.min(30, all.length - items.length)} more</button> <span class="muted">${items.length} of ${all.length} shown</span></p>` : ''}`;
}

// ---- About -------------------------------------------------------------------------
function renderAbout() {
  const d = state.data;
  const lr = d.last_refresh;
  const feeds = d.source_health.feeds;
  const pages = d.source_health.total - feeds;
  $('#view').innerHTML = `<div class="prose">
    <h2>What this is</h2>
    <p>A working prototype of a field map for the animal movement, modelled on the AISafety.com field map. It shows who works on which animals, where and how, and what has changed recently. Every profile and record links to its sources.</p>
    <h2>What's in it</h2>
    <ul>
      <li><strong>In depth:</strong> organisations, programmes, funders and resources working on farmed fish, wild-caught fish, shrimp and other crustaceans, and octopus and other cephalopods.</li>
      <li><strong>The wider movement:</strong> a lighter sample across every area, so the map shows the overall shape of the field.</li>
      <li><strong>Funding:</strong> disclosed grants and open funding calls, shown in each profile and on the Changes page.</li>
      <li><strong>Direct action and abolitionist groups</strong> are included for now so we can see how including them works. Their profiles are encyclopedic only. Being listed is not endorsement and implies no link to anyone else on the map. The filter hides them.</li>
    </ul>
    <h2>The four views</h2>
    <ul>
      <li><strong>Map:</strong> everyone grouped by main focus. An entry is repeated under every other area it works in.</li>
      <li><strong>Coverage:</strong> a grid of animals against regions or methods, to see where work overlaps and where the sample is thin.</li>
      <li><strong>Directory:</strong> one sortable list.</li>
      <li><strong>Changes:</strong> checked records, and separately the unchecked posts from organisations' feeds.</li>
    </ul>
    <h2>How to read it</h2>
    <ul>
      <li>A missing organisation does not mean nobody does that work. This is a sample.</li>
      <li>How often an organisation posts says nothing about its activity or effectiveness.</li>
      <li>A group tagged “global” appears in every region filter, marked <span class="fit">global</span>, so it can't pass as a local group.</li>
      <li>Every record keeps three dates apart: when something happened, when the source published it and when we last checked it.</li>
      <li>Grants awarded are kept separate from funding calls, and announced plans separate from active projects. A funding total is not money still available.</li>
      <li>When sources disagree, both versions are kept and marked <span class="pill disputed">disputed</span>. Profiles not checked in six months are marked stale.</li>
    </ul>
    <h2>The areas</h2>
    <ul>${CATEGORIES.map(([, label, desc]) => `<li><strong>${esc(label)}:</strong> ${esc(desc)}</li>`).join('')}</ul>
    <h2>Where the information comes from</h2>
    <p>Public sources only: organisation websites and RSS feeds, published grant records and public announcements. No Slack or other private community content is used.</p>
    <p><strong>Checked records</strong> are grants, calls, reports and legal developments checked against a source by a person or a research pass. <strong>Unchecked feed posts</strong> come from organisations' public feeds; keyword rules pick out likely funding news, calls, reports, campaign outcomes, legal news and launches, and nobody has reviewed those picks.</p>
    <p>${feeds} feeds are checked daily and ${pages} homepages monthly, a few every hour. A source that fails is retried less and less often. ${lr ? `The last check ran ${esc(ago(lr.finished_at))}.` : ''} ${d.source_health.failing} sources are failing at the moment.${refreshDelayed() ? ` <strong>Checks are delayed:</strong> ${esc(d.refresher.detail)}` : ''}</p>
    <h3>People</h3>
    <p>The map lists organisations, not individuals, and links only to organisations' own public pages.</p>
    <h2>Corrections</h2>
    <p>Open any profile and use “Suggest a correction”. Corrections, missing organisations and removal requests go to a review queue, and nothing changes until a maintainer accepts it.</p>
    <p class="muted mono small">Data: ${d.entities.length} entries · ${d.events.length} records · generated ${fmtDate(d.generated_at, { precise: true })} UTC${d.static ? ' · static snapshot' : ''}</p>
  </div>`;
}

// ---- Profile drawer ----------------------------------------------------------
function openProfile(id, push = true) {
  const e = state.byId[id];
  if (!e) return;
  if (!state.profile) state.opener = id;
  state.profile = id;
  if (push && location.hash !== `#p-${id}`) history.pushState(null, '', `#p-${id}`);
  const events = state.data.events.filter((ev) => ev.entity_ids.includes(id))
    .sort((a, b) => String(b.event_date || b.source_published || '').localeCompare(String(a.event_date || a.source_published || '')));
  const titleCount = {};
  for (const ev of events) titleCount[ev.title] = (titleCount[ev.title] || 0) + 1;
  const feed = (state.data.changes || []).filter((c) => c.entity_id === id || (c.mentions || []).includes(id)).slice(0, 6);
  const programmes = state.data.entities.filter((x) => x.parent_id === id);
  const parent = e.parent_id && state.byId[e.parent_id];
  const others = (e.categories || []).slice(1).map((c) => CAT[c]?.label || c);
  const home = safeUrl(e.website);
  // Stub notes are build bookkeeping ("referenced by record …"), not something a reader needs.
  const notes = e.notes && !/^stub:/i.test(e.notes) ? e.notes : '';
  const countries = (e.countries || []).map(countryName);
  const checks = (e.monitoring || []).map((m) => `<li><span class="dot ${m.healthy ? (m.last_checked ? 'ok' : '') : 'bad'}"></span>${m.kind === 'feed' ? 'Its news feed' : 'Its homepage'}, checked ${esc(m.cadence)}${m.last_checked ? ` (last ${esc(ago(m.last_checked))})` : ' (not yet)'}${m.error ? `: <span class="err">${esc(m.error)}</span>` : ''}</li>`).join('');

  $('#drawer-root').innerHTML = `<div class="scrim" data-close></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="p-title" tabindex="-1">
    <button class="xbtn close" type="button" data-close aria-label="Close profile">×</button>
    <div class="eyebrow">${esc(KIND[e.kind] || e.kind)} · ${esc(CAT[e.primary_category]?.label || '')}</div>
    <h2 id="p-title">${esc(e.name)}</h2>
    ${e.aliases?.length ? `<p class="aka">Also known as ${esc(e.aliases.join(', '))}</p>` : ''}
    ${isDirect(e) ? '<div class="note review">Included to test coverage. This profile is encyclopedic: it is not endorsement and implies no link to other groups on the map.</div>' : ''}
    ${e.stub ? '<div class="note">Listed because a grant or funding record names it. Nobody has researched its profile yet.</div>' : ''}
    ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
    <dl>
      ${home ? `<dt>Website</dt><dd><a href="${esc(home)}" target="_blank" rel="noopener">${esc(host(home))}</a></dd>` : ''}
      ${parent ? `<dt>Part of</dt><dd><button class="elink" data-id="${esc(parent.id)}">${esc(parent.name)}</button></dd>` : ''}
      ${programmes.length ? `<dt>Programmes</dt><dd>${entityLinks(programmes.map((p) => p.id))}</dd>` : ''}
      ${e.species?.length ? `<dt>Animals</dt><dd>${tagList(e.species, SPECIES, AQUATIC)}</dd>` : ''}
      ${e.regions?.length ? `<dt>Works in</dt><dd>${tagList(e.regions, REGION)}${countries.length ? `<div class="sub">${esc(countries.join(', '))}</div>` : ''}</dd>` : ''}
      ${e.interventions?.length ? `<dt>Methods</dt><dd>${tagList(e.interventions, INTERVENTION)}</dd>` : ''}
      ${others.length ? `<dt>Also works in</dt><dd>${esc(others.join(', '))}</dd>` : ''}
      ${e.approach && e.approach !== 'unclear' ? `<dt>Stance</dt><dd>${esc(APPROACH[e.approach] || e.approach)}</dd>` : ''}
      ${e.hq ? `<dt>Based in</dt><dd>${esc(e.hq)}</dd>` : ''}
      ${e.founded ? `<dt>Founded</dt><dd class="mono">${esc(e.founded)}</dd>` : ''}
      ${e.status && e.status !== 'active' ? `<dt>Status</dt><dd>${esc(STATUS[e.status] || e.status)}</dd>` : ''}
    </dl>
    ${events.length ? `<h3>Grants and other records (${events.length})</h3><ul class="list">${events.map((ev) => `<li>
      <div class="meta"><span class="pill type">${esc(EVENT_TYPE[ev.type])}</span>${ev.status !== 'confirmed' ? `<span class="pill ${esc(ev.status)}">${esc(ev.status)}</span>` : ''}<span class="mono">${fmtDate(ev.event_date)}</span></div>
      <div>${safeUrl(ev.source_url) ? `<a href="${esc(ev.source_url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>` : esc(ev.title)}${ev.amount != null ? ` · <span class="mono">${money(ev.amount, ev.currency)}</span>` : ''}</div>
      ${titleCount[ev.title] > 1 && ev.summary ? `<div class="sub">${esc(ev.summary)}</div>` : ''}
    </li>`).join('')}</ul>` : ''}
    ${feed.length ? `<h3>Recent posts from its feed</h3><ul class="list">${feed.map((c) => `<li>
      <div class="meta"><span class="mono">${fmtDate(c.published || c.first_seen)}</span>${c.entity_id !== id ? '<span>mentions this entry</span>' : ''}</div>
      <div>${safeUrl(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}</div></li>`).join('')}</ul>` : ''}
    <details class="more">
      <summary>Sources and checks</summary>
      ${e.sources?.length ? `<ul class="list">${e.sources.map((s) => `<li>${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || host(s.url))}</a>` : esc(s.title || s.url)}
        <div class="meta">${s.published ? `<span>Published <span class="mono">${fmtDate(s.published)}</span></span>` : ''}${s.accessed ? `<span>Read <span class="mono">${fmtDate(s.accessed)}</span></span>` : ''}</div></li>`).join('')}</ul>` : '<p class="sub">No sources recorded yet.</p>'}
      <p class="sub">Profile last checked <span class="mono">${fmtDate(e.last_checked)}</span>${e.stale ? ' <span class="pill stale">stale</span>' : ''}</p>
      ${checks ? `<p class="sub">Kept current by checking:</p><ul class="checks">${checks}</ul>` : ''}
      ${notes ? `<p class="sub"><strong>Research notes.</strong> ${esc(notes)}</p>` : ''}
    </details>
    <details class="more">
      <summary>Suggest a correction</summary>
      <form class="correct" id="correct-form" novalidate>
        <label for="c-kind">What kind of change?
          <select id="c-kind" name="kind">
            <option value="correction">Something here is wrong or out of date</option>
            <option value="missing-entity">A related organisation or programme is missing</option>
            <option value="removal-request">I represent this organisation and request removal or limits</option>
            <option value="access-concern">This shares information that shouldn't be public</option>
          </select></label>
        <label for="c-field">Which part? <input id="c-field" name="field" placeholder="e.g. summary, region, a grant amount" maxlength="80"></label>
        <label for="c-note">What should change, and why? <textarea id="c-note" name="note" required minlength="10" maxlength="4000"></textarea></label>
        <label for="c-evidence">Link to evidence <input id="c-evidence" name="evidence_url" type="url" placeholder="https://"></label>
        <label for="c-contact">Your email (optional; only maintainers see it) <input id="c-contact" name="contact" maxlength="200" autocomplete="email"></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="btn" type="submit">Send for review</button>
        <div class="form-msg" id="c-msg" role="status"></div>
      </form>
    </details>
  </aside>`;
  lockScroll();
  $('.drawer').focus();
  $('#correct-form').addEventListener('submit', (ev) => submitCorrection(ev, id));
}

function closeProfile(push = true, restoreFocus = true) {
  const wasOpen = Boolean(state.profile);
  state.profile = null;
  $('#drawer-root').innerHTML = '';
  lockScroll();
  if (push && location.hash.startsWith('#p-')) history.pushState(null, '', `#${state.view}`);
  // Put keyboard focus back on the name that opened the profile, not at the top of the page.
  if (wasOpen && restoreFocus) {
    const back = state.opener && $('#view').querySelector(`[data-id="${CSS.escape(state.opener)}"]`);
    (back || $('#view')).focus({ preventScroll: true });
  }
  state.opener = null;
}

// Tab stays inside the open profile.
function trapTab(ev) {
  const d = $('.drawer');
  if (!d) return;
  // Controls inside a collapsed section still have layout boxes, so test for the closed <details> itself.
  const collapsed = (el) => { const det = el.closest('details:not([open])'); return Boolean(det) && !(el.tagName === 'SUMMARY' && el.parentElement === det); };
  const items = [...d.querySelectorAll('a[href], button:not([disabled]), input:not([tabindex="-1"]), select, textarea, summary')].filter((el) => !collapsed(el));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (ev.shiftKey && (at === first || at === d)) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && (at === last || !d.contains(at))) { ev.preventDefault(); first.focus(); }
}

async function submitCorrection(ev, entityId) {
  ev.preventDefault();
  const form = ev.target;
  const msg = $('#c-msg');
  const body = Object.fromEntries(new FormData(form).entries());
  body.entity_id = entityId;
  if ((body.note || '').trim().length < 10) { msg.className = 'form-msg err'; msg.textContent = 'Describe the change in at least 10 characters.'; return; }
  if (!state.live) { msg.className = 'form-msg err'; msg.textContent = 'This copy of the map is read-only. Corrections can be sent from the deployed site.'; return; }
  msg.className = 'form-msg'; msg.textContent = 'Sending…';
  try {
    const r = await fetch('/api/corrections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || `The server answered ${r.status}.`);
    form.reset();
    msg.className = 'form-msg ok';
    msg.textContent = `Sent for review (reference #${out.id}). Nothing on the map changes until a maintainer accepts it.`;
  } catch (err) {
    msg.className = 'form-msg err';
    msg.textContent = `Not sent: ${err.message} Try again in a minute.`;
  }
}

// ---- Shell ---------------------------------------------------------------
const VIEWS = { map: renderMap, coverage: renderCoverage, directory: renderDirectory, changes: renderChanges, about: renderAbout };

function filtersOpen() { return !$('#filters').classList.contains('collapsed'); }
// The page behind a profile, or behind the filter sheet on a phone, must not scroll.
function lockScroll() {
  document.documentElement.classList.toggle('locked', Boolean(state.profile) || (filtersOpen() && isPhone()));
}
function setFiltersOpen(open) {
  $('#filters').classList.toggle('collapsed', !open);
  $('#filter-toggle').setAttribute('aria-expanded', String(open));
  $('#filter-scrim').hidden = !(open && isPhone());
  lockScroll();
  if (open && isPhone()) $('#filters').focus({ preventScroll: true });
}

// Everything on the toolbar that mirrors the filter state: the count, the removable chips, the controls.
function updateFilterUi() {
  const f = state.f;
  const chips = [];
  for (const s of f.species) chips.push([`species:${s}`, SPECIES[s]]);
  if (f.region) chips.push(['region', `Region: ${REGION[f.region]}`]);
  if (f.intervention) chips.push(['intervention', `Method: ${INTERVENTION[f.intervention]}`]);
  if (f.kind) chips.push(['kind', `Type: ${KIND[f.kind]}`]);
  if (!f.direct) chips.push(['direct', 'Without direct-action groups']);
  $('#filter-count').textContent = chips.length ? `(${chips.length})` : '';
  const box = $('#active-filters');
  box.hidden = !chips.length || state.view === 'about';
  box.innerHTML = chips.map(([k, l]) => `<button type="button" class="achip" data-rm="${esc(k)}" aria-label="Remove filter: ${esc(l)}">${esc(l)}<span aria-hidden="true">×</span></button>`).join('')
    + '<button class="reset" type="button" data-clear>Clear all</button>';
  document.querySelectorAll('[data-species]').forEach((b) => b.setAttribute('aria-pressed', String(f.species.has(b.dataset.species))));
  $('#f-region').value = f.region; $('#f-intervention').value = f.intervention; $('#f-kind').value = f.kind;
  $('#f-direct').checked = f.direct;
  if ($('#q').value.trim() !== f.q) $('#q').value = f.q;
  const n = state.data.entities.filter((e) => matches(e)).length;
  $('#filters-done').textContent = `Show ${n} ${n === 1 ? 'entry' : 'entries'}`;
}

function render() {
  updateFilterUi();
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === state.view ? 'page' : 'false'));
  $('#filter-toggle').hidden = state.view === 'about';
  if (state.view === 'about' && filtersOpen()) setFiltersOpen(false);
  VIEWS[state.view]();
}

// A filter changed: remember it in the link, then redraw.
function update() {
  try { localStorage.setItem('amm-direct', state.f.direct ? '1' : '0'); } catch {}
  state.dirLimit = 60; state.changesLimit = 30;
  syncUrl();
  render();
}

function route() {
  const h = location.hash.slice(1);
  if (h.startsWith('p-')) {
    if (!state.view) state.view = 'map';
    render();
    openProfile(h.slice(2), false);
    return;
  }
  const next = VIEWS[h] ? h : 'map';
  const changed = next !== state.view;
  if (changed && filtersOpen() && isPhone()) setFiltersOpen(false);
  state.view = next;
  closeProfile(false, !changed);
  render();
  // A new view starts at its top, not wherever the last one was scrolled to.
  if (changed) window.scrollTo(0, 0);
}

function setupFilters() {
  const ents = state.data.entities;
  const present = (key) => new Set(ents.flatMap((e) => e[key] || []));
  const sp = present('species');
  $('#species-chips').innerHTML = Object.keys(SPECIES).filter((s) => sp.has(s))
    .map((s) => `<button type="button" class="chip${AQUATIC.has(s) ? ' water' : ''}" data-species="${s}" aria-pressed="false">${esc(SPECIES[s])}</button>`).join('');
  const fill = (sel, dict, set) => { $(sel).insertAdjacentHTML('beforeend', Object.keys(dict).filter((k) => set.has(k)).map((k) => `<option value="${k}">${esc(dict[k])}</option>`).join('')); };
  fill('#f-region', REGION, present('regions'));
  fill('#f-intervention', INTERVENTION, present('interventions'));
  fill('#f-kind', KIND, new Set(ents.map((e) => e.kind)));

  $('#species-chips').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-species]'); if (!b) return;
    const s = b.dataset.species;
    state.f.species.has(s) ? state.f.species.delete(s) : state.f.species.add(s);
    update();
  });
  let t;
  $('#q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.f.q = ev.target.value.trim(); update(); }, 150); });
  $('#f-region').addEventListener('change', (ev) => { state.f.region = ev.target.value; state.f.incGlobal = true; update(); });
  $('#f-intervention').addEventListener('change', (ev) => { state.f.intervention = ev.target.value; update(); });
  $('#f-kind').addEventListener('change', (ev) => { state.f.kind = ev.target.value; update(); });
  $('#f-direct').addEventListener('change', (ev) => { state.f.direct = ev.target.checked; update(); });
  $('#reset').addEventListener('click', () => { resetFilters(); update(); });
  $('#filter-toggle').addEventListener('click', () => setFiltersOpen(!filtersOpen()));
  $('#filters-done').addEventListener('click', () => setFiltersOpen(false));
  $('#filters-close').addEventListener('click', () => setFiltersOpen(false));
  $('#filter-scrim').addEventListener('click', () => setFiltersOpen(false));
}

// The Worker reports whether the hourly refresher is keeping up (src/index.js refresherHealth).
function refreshDelayed() {
  return state.live && state.data.refresher?.status === 'degraded';
}

function renderFreshness() {
  const d = state.data;
  const lr = d.last_refresh;
  const health = d.source_health;
  const delayed = refreshDelayed();
  const cls = !state.live ? '' : delayed || health.failing > health.total * 0.25 ? 'warn' : 'ok';
  const when = lr ? `updated ${ago(lr.finished_at)}` : state.live ? 'waiting for the first refresh' : `snapshot from ${fmtDate(d.generated_at)}`;
  $('#freshness').innerHTML = `<span class="dot ${cls}"></span>${d.entities.length} entries · ${d.events.length} records · ${health.total} public sources monitored · ${esc(when)}${delayed ? ` · <b class="delayed">refresh delayed</b>${d.refresher?.detail ? `: ${esc(d.refresher.detail)}` : ''}` : ''}`;
}

async function load() {
  try {
    const r = await fetch('/api/snapshot', { headers: { accept: 'application/json' } });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) { state.live = true; return await r.json(); }
  } catch {}
  const r = await fetch('snapshot.json');
  if (!r.ok) throw new Error(`snapshot.json returned ${r.status}`);
  return r.json();
}

function removeFilter(key) {
  const f = state.f;
  if (key.startsWith('species:')) f.species.delete(key.slice(8));
  else if (key === 'region') { f.region = ''; f.incGlobal = true; }
  else if (key === 'intervention') f.intervention = '';
  else if (key === 'kind') f.kind = '';
  else if (key === 'direct') f.direct = true;
}

async function main() {
  try {
    state.data = await load();
  } catch (err) {
    $('#view').innerHTML = `<div class="banner">The map data didn't load (${esc(err.message)}). Reload the page; if that fails, the data service may be down.</div>`;
    $('#freshness').textContent = 'Data unavailable';
    return;
  }
  state.byId = Object.fromEntries(state.data.entities.map((e) => [e.id, e]));
  for (const e of state.data.entities) indexEntity(e);
  for (const ev of state.data.events) ev.call_state = currentCallState(ev);
  readUrl();
  setupFilters();
  renderFreshness();

  document.addEventListener('click', (ev) => {
    const el = (sel) => ev.target.closest(sel);
    if (el('#skip')) { ev.preventDefault(); $('#view').focus(); return; }
    // Remember which map sections the reader opened or closed, so a redraw keeps them.
    const sum = el('.territory > summary');
    if (sum) { state.sectionOpen[sum.parentElement.dataset.cat] = !sum.parentElement.open; return; }
    const idEl = el('[data-id]');
    if (idEl) { ev.preventDefault(); openProfile(idEl.dataset.id); return; }
    if (el('[data-close]')) { closeProfile(); return; }
    const sort = el('[data-sort]');
    if (sort) { const k = sort.dataset.sort; state.dirSort = [k, state.dirSort[0] === k ? -state.dirSort[1] : 1]; renderDirectory(); return; }
    const scope = el('[data-scope]');
    if (scope) { state.f.aquatic = scope.dataset.scope === 'aquatic'; update(); return; }
    if (el('[data-clear]')) { resetFilters(); update(); return; }
    const rm = el('[data-rm]');
    if (rm) { removeFilter(rm.dataset.rm); update(); return; }
    const glob = el('[data-global]');
    if (glob) { state.f.incGlobal = glob.dataset.global === '1'; update(); return; }
    const cell = el('[data-cell]');
    if (cell) {
      state.cell = state.cell === cell.dataset.cell ? null : cell.dataset.cell;
      syncUrl(); renderCoverage();
      const again = state.cell && $(`[data-cell="${CSS.escape(state.cell)}"]`);
      if (again) again.focus({ preventScroll: true });
      if (state.cell) $('.cellpanel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const cols = el('[data-cols]');
    if (cols) { state.gridCols = cols.dataset.cols; state.cell = null; syncUrl(); renderCoverage(); return; }
    const more = el('[data-more]');
    if (more) {
      if (more.dataset.more === 'dir') { state.dirLimit += 60; renderDirectory(); } else { state.changesLimit += 30; renderChanges(); }
      return;
    }
    const mode = el('[data-mode]');
    if (mode) { state.changesMode = mode.dataset.mode; state.changesLimit = 30; renderChanges(); }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'dir-sort') return;
    const [k, d] = ev.target.value.split(':');
    state.dirSort = [k, Number(d)];
    renderDirectory();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state.profile) closeProfile();
      else if (filtersOpen() && isPhone()) setFiltersOpen(false);
    } else if (ev.key === 'Tab' && state.profile) trapTab(ev);
  });
  window.addEventListener('hashchange', route);
  // Crossing the phone breakpoint changes the layout (accordion, filter sheet), so redraw.
  window.matchMedia('(max-width: 640px)').addEventListener('change', () => { setFiltersOpen(false); render(); });
  route();
}

main();
