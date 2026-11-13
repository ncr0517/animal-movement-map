// Animal Movement Map — client. No framework; renders from a single snapshot.
// Data comes from /api/snapshot (live D1) and falls back to ./snapshot.json (static seed).

const CATEGORIES = [
  ['advocacy-campaigns', 'Advocacy & campaigns', 'Corporate, public and legislative campaigns for changes in how animals are treated.'],
  ['welfare-science', 'Welfare science', 'Research on sentience, welfare states, pain and how to measure them.'],
  ['welfare-technology', 'Welfare technology', 'Tools and methods that change conditions directly, such as stunning, monitoring or water quality.'],
  ['alt-protein', 'Alternative proteins', 'Plant-based, fermented and cultivated products that replace animal products.'],
  ['policy-law', 'Policy & law', 'Legislation, litigation, legal scholarship and engagement with regulators.'],
  ['funding', 'Funding', 'Grantmakers, funds and donor networks.'],
  ['incubation-careers', 'Incubation & careers', 'Charity incubators, fellowships, hiring and career support.'],
  ['movement-infrastructure', 'Movement infrastructure', 'Shared services, coalitions, data and coordination.'],
  ['community-media', 'Community & media', 'Journalism, podcasts, community spaces and public resources.'],
  ['sanctuary-rescue', 'Sanctuary & rescue', 'Sanctuaries and rescue networks that care for animals directly.'],
  ['direct-action', 'Direct action & abolitionist', 'Groups whose public stance is abolitionist, or which use protest, open rescue or other direct action.'],
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
const INTERVENTION = {
  'corporate-campaigns': 'Corporate campaigns', 'legislation-policy': 'Legislation & policy', litigation: 'Litigation', research: 'Research',
  'humane-slaughter': 'Stunning & slaughter', 'farm-practices': 'Farm practices', 'producer-engagement': 'Producer engagement',
  'certification-standards': 'Certification & standards', 'alt-proteins': 'Alternative proteins', 'public-awareness': 'Public awareness',
  'diet-change': 'Diet change', protest: 'Protest', 'open-rescue': 'Open rescue', 'direct-action': 'Direct action', investigations: 'Investigations',
  'capacity-building': 'Capacity building', grantmaking: 'Grantmaking', 'careers-talent': 'Careers & talent', 'data-tools': 'Data & tools',
  education: 'Education', sanctuary: 'Sanctuary',
};
const APPROACH = { 'welfare-reform': 'Welfare reform', abolitionist: 'Abolitionist', mixed: 'Mixed', research: 'Research', 'neutral-infrastructure': 'Movement infrastructure', unclear: 'Not stated' };
const EVENT_TYPE = {
  grant_awarded: 'Grant awarded', open_call: 'Open call', announcement: 'Announcement', plan_announced: 'Plan announced',
  project_active: 'Active project', report_published: 'Report', campaign_outcome: 'Campaign outcome', legal_development: 'Legal development',
};
const SIGNAL = { funding: 'Funding news', open_call: 'Possible open call', legal: 'Legal / policy', campaign_outcome: 'Campaign outcome', report: 'Report / research', launch: 'Launch / expansion', people: 'People & roles' };
const STATUS_HELP = {
  confirmed: 'Confirmed by the primary source', reported: 'Reported by a source; not independently confirmed',
  uncertain: 'Uncertain — needs checking', disputed: 'Sources disagree; all versions are shown', superseded: 'Superseded by a later record',
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

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

function glyph(e) {
  const cls = `glyph${isAquatic(e) ? ' aq' : ''}${e.stub ? ' stubg' : ''}`;
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

// ---------------------------------------------------------------------------
const state = {
  data: null, live: false, byId: {}, view: 'map', profile: null, changesMode: 'all',
  dirSort: ['name', 1],
  f: { q: '', species: new Set(), region: '', intervention: '', kind: '', aquatic: false, direct: true },
};

function isAquatic(e) { return e.section === 'aquatic' || (e.species || []).some((s) => AQUATIC.has(s)); }
function isDirect(e) { return (e.categories || []).includes('direct-action'); }

function textOf(e) {
  return [e.name, ...(e.aliases || []), e.summary, e.hq, ...(e.countries || [])].join(' ').toLowerCase();
}
function matches(e) {
  const f = state.f;
  if (!f.direct && isDirect(e)) return false;
  if (f.aquatic && !isAquatic(e)) return false;
  if (f.species.size && !(e.species || []).some((s) => f.species.has(s))) return false;
  if (f.region && !(e.regions || []).includes(f.region) && !(e.regions || []).includes('global')) return false;
  if (f.intervention && !(e.interventions || []).includes(f.intervention)) return false;
  if (f.kind && e.kind !== f.kind) return false;
  if (f.q) {
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const t = textOf(e);
    if (!terms.every((x) => t.includes(x))) return false;
  }
  return true;
}
function filtersActive() {
  const f = state.f;
  return Boolean(f.q || f.species.size || f.region || f.intervention || f.kind || f.aquatic || !f.direct);
}

function recentIds() {
  const cutoff = Date.now() - 45 * 86400000;
  const ids = new Set();
  for (const c of state.data.changes || []) if (c.meaningful && Date.parse(c.published || c.first_seen) > cutoff) { if (c.entity_id) ids.add(c.entity_id); }
  for (const ev of state.data.events) {
    const d = Date.parse(ev.source_published || ev.event_date || '');
    if (d > cutoff) ev.entity_ids.forEach((i) => ids.add(i));
  }
  return ids;
}

// ---- Views ----------------------------------------------------------------
function renderMap() {
  const recent = recentIds();
  const groups = Object.fromEntries(CATEGORIES.map(([id]) => [id, []]));
  for (const e of state.data.entities) (groups[e.primary_category] ||= []).push(e);
  const active = filtersActive();
  let shown = 0;
  const html = CATEGORIES.filter(([id]) => state.f.direct || id !== 'direct-action').map(([id, label, desc]) => {
    const list = (groups[id] || []).sort((a, b) => Number(a.stub) - Number(b.stub) || a.name.localeCompare(b.name));
    const n = list.filter(matches).length;
    shown += n;
    const review = id === 'direct-action';
    const markers = list.map((e) => {
      const m = matches(e);
      return `<li><button class="marker${isAquatic(e) ? ' aq' : ''}${m ? '' : ' dim'}${e.stub ? ' stub' : ''}${e.stale ? ' stale' : ''}" data-id="${esc(e.id)}"
        title="${esc(KIND[e.kind] || e.kind)}${e.stub ? ' · profile not yet researched' : ''}${e.stale ? ' · not checked in 6+ months' : ''}"
        ${m ? '' : 'tabindex="-1" aria-hidden="true"'}>${glyph(e)}<span class="name">${esc(e.name)}</span>${recent.has(e.id) ? '<span class="new" title="Change in the last 45 days"></span>' : ''}</button></li>`;
    }).join('');
    return `<section class="territory${list.length > 14 ? ' wide' : ''}${review ? ' review' : ''}" aria-labelledby="t-${id}">
      <header><h2 id="t-${id}">${esc(label)}</h2><span class="count">${active ? `${n}/` : ''}${list.length}</span></header>
      <p class="desc">${esc(desc)}</p>
      ${review ? '<p class="review-note">Included in v1 to test coverage. Listing is descriptive: it is not endorsement, and it does not imply association with any other group on the map.</p>' : ''}
      ${list.length ? `<ul class="markers">${markers}</ul>` : '<p class="empty-territory">No entries in this sample yet.</p>'}
    </section>`;
  }).join('');

  $('#view').innerHTML = `
    <div class="caveat"><svg viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span>Entries are grouped by their <strong>primary function</strong>. Sharing a territory does not mean organisations work together, and the map shows only a sample: a missing name is not evidence that nobody does that work. ${active ? `<strong>${shown}</strong> of ${state.data.entities.length} entries match your filters.` : ''}</span></div>
    <div class="chart">${html}</div>
    <div class="legend" aria-label="Legend">
      <span>${glyph({ kind: 'organisation' })} Organisation</span>
      <span>${glyph({ kind: 'programme' })} Programme</span>
      <span>${glyph({ kind: 'funder' })} Funder</span>
      <span>${glyph({ kind: 'resource' })} Resource</span>
      <span>${glyph({ kind: 'network' })} Network</span>
      <span>${glyph({ kind: 'banner' })} Leaderless banner</span>
      <span>${glyph({ kind: 'organisation', section: 'aquatic' })} Works on aquatic animals</span>
      <span><span class="new" style="width:6px;height:6px;border-radius:50%;background:var(--warn);display:inline-block"></span> Changed in last 45 days</span>
      <span><span style="text-decoration:underline dotted;text-underline-offset:3px">Name</span> Not checked in 6+ months</span>
      <span><em style="color:var(--ink-3)">Name</em> Not yet researched</span>
      <span><span class="sw hatch"></span> Inclusion under review</span>
    </div>`;
}

function tagList(arr, dict, aqSet) {
  return `<span class="tags">${(arr || []).map((t) => `<span class="tag${aqSet && aqSet.has(t) ? ' aq' : ''}">${esc(dict[t] || t)}</span>`).join('')}</span>`;
}

function renderDirectory() {
  const [key, dir] = state.dirSort;
  const rows = state.data.entities.filter(matches).sort((a, b) => {
    const va = key === 'category' ? CAT[a.primary_category]?.label : key === 'checked' ? a.last_checked || '' : key === 'kind' ? a.kind : a.name;
    const vb = key === 'category' ? CAT[b.primary_category]?.label : key === 'checked' ? b.last_checked || '' : key === 'kind' ? b.kind : b.name;
    return String(va || '').localeCompare(String(vb || '')) * dir;
  });
  const th = (k, label) => `<th scope="col" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${label}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  $('#view').innerHTML = `
    <div class="section-head" style="margin-top:16px"><h2>Directory</h2><span class="muted mono">${rows.length} entries</span></div>
    <div class="table-wrap"><table>
      <thead><tr>${th('name', 'Name')}${th('kind', 'Kind')}${th('category', 'Primary function')}<th scope="col">Species</th><th scope="col">Regions</th>${th('checked', 'Last checked')}</tr></thead>
      <tbody>${rows.map((e) => `<tr>
        <td><button class="rowlink" data-id="${esc(e.id)}">${esc(e.name)}</button>${e.aliases?.length ? `<div class="muted" style="font-size:var(--s-xs)">${esc(e.aliases.slice(0, 3).join(' · '))}</div>` : ''}</td>
        <td>${esc(KIND[e.kind] || e.kind)}${e.stub ? '<div class="muted" style="font-size:var(--s-xs)">not yet researched</div>' : ''}</td>
        <td>${esc(CAT[e.primary_category]?.label || e.primary_category)}</td>
        <td>${tagList(e.species, SPECIES, AQUATIC)}</td>
        <td>${tagList(e.regions, REGION)}</td>
        <td class="mono" style="white-space:nowrap">${fmtDate(e.last_checked)}${e.stale ? ' <span class="pill stale">stale</span>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No entries match these filters.</td></tr>'}</tbody>
    </table></div>`;
}

function entityLinks(ids) {
  return `<span class="entity-links">${(ids || []).map((id) => state.byId[id]).filter(Boolean)
    .map((e) => `<button class="elink" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('<span class="muted">·</span>')}</span>`;
}

function changeItems() {
  const active = filtersActive();
  const ok = (ids) => !active || ids.some((id) => state.byId[id] && matches(state.byId[id]));
  const today = new Date().toISOString().slice(0, 10);
  // Order by when the change became knowable: future-dated records (forthcoming calls, laws taking
  // effect later) sort by their publication or check date, not by the future date.
  const curated = state.data.events.filter((ev) => ok(ev.entity_ids)).map((ev) => ({
    kind: 'curated', date: ev.event_date && ev.event_date <= today ? ev.event_date : ev.source_published || ev.last_checked || ev.event_date, ev,
  }));
  const auto = (state.data.changes || []).filter((c) => c.meaningful && ok([c.entity_id, ...(c.mentions || [])].filter(Boolean))).map((c) => ({
    kind: 'auto', date: c.published || c.first_seen, c,
  }));
  const mode = state.changesMode;
  return [...(mode !== 'auto' ? curated : []), ...(mode !== 'curated' ? auto : [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function eventRow(ev, sortDate) {
  const amount = ev.amount != null ? ` · <span class="mono">${money(ev.amount, ev.currency)}</span>` : '';
  return `<li class="tl-item">
    <div class="tl-date">${fmtDate(sortDate || ev.event_date || ev.source_published)}</div>
    <div>
      <div class="meta" style="margin-bottom:3px"><span class="pill type">${esc(EVENT_TYPE[ev.type] || ev.type)}</span>
        <span class="pill ${esc(ev.status)}" title="${esc(STATUS_HELP[ev.status] || '')}">${esc(ev.status)}</span>
        ${ev.call_state ? `<span class="pill ${esc(ev.call_state)}">${ev.call_state === 'rolling-or-unstated' ? 'rolling / no deadline stated' : esc(ev.call_state)}</span>` : ''}</div>
      <h3>${safeUrl(ev.source_url) ? `<a href="${esc(ev.source_url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>` : esc(ev.title)}${amount}</h3>
      ${ev.summary ? `<p>${esc(ev.summary)}</p>` : ''}
      <div class="meta">${entityLinks(ev.entity_ids)}</div>
      <div class="meta" style="margin-top:4px">
        <span>Happened <span class="mono">${fmtDate(ev.event_date)}</span></span>
        <span>Source published <span class="mono">${fmtDate(ev.source_published)}</span></span>
        <span>Last checked <span class="mono">${fmtDate(ev.last_checked)}</span></span>
        ${ev.source_url ? `<span>via ${esc(host(ev.source_url))}</span>` : ''}
      </div>
      ${ev.conflicts_with?.length ? `<div class="note review" style="margin-top:6px">Another source reports this differently: ${ev.conflicts_with.map((id) => esc(state.data.events.find((x) => x.id === id)?.title || id)).join('; ')}</div>` : ''}
      ${ev.notes ? `<div class="meta" style="margin-top:4px">Note: ${esc(ev.notes)}</div>` : ''}
    </div></li>`;
}

function feedRow(c) {
  const e = state.byId[c.entity_id];
  return `<li class="tl-item">
    <div class="tl-date">${fmtDate(c.published || c.first_seen)}</div>
    <div>
      <div class="meta" style="margin-bottom:3px"><span class="pill auto" title="Classified by keyword rules; nobody has reviewed it yet">auto-detected · unreviewed</span>
        ${c.signal ? `<span class="pill type">${esc(SIGNAL[c.signal] || c.signal)}</span>` : ''}</div>
      <h3>${safeUrl(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}</h3>
      ${c.excerpt ? `<p>${esc(c.excerpt.slice(0, 240))}${c.excerpt.length > 240 ? '…' : ''}</p>` : ''}
      <div class="meta">${e ? `From ${entityLinks([e.id])}` : ''}${c.mentions?.length ? ` · mentions ${entityLinks(c.mentions)}` : ''}${c.species?.length ? ` · ${c.species.map((s) => esc(SPECIES[s] || s)).join(', ')}` : ''}</div>
      <div class="meta" style="margin-top:4px"><span>Feed date <span class="mono">${fmtDate(c.published)}</span></span><span>First seen <span class="mono">${fmtDate(c.first_seen)}</span></span></div>
    </div></li>`;
}

function renderChanges() {
  const items = changeItems().slice(0, 200);
  const nAuto = (state.data.changes || []).filter((c) => c.meaningful).length;
  const seg = (m, l) => `<button type="button" data-mode="${m}" aria-pressed="${state.changesMode === m}">${l}</button>`;
  const lr = state.data.last_refresh;
  $('#view').innerHTML = `<div class="layout-2" style="margin-top:16px">
    <div>
      <div class="section-head"><h2>Recent changes</h2><span class="muted mono">${items.length} shown</span></div>
      <div class="seg" role="group" aria-label="Which changes">${seg('all', 'All')}${seg('curated', 'Curated records')}${seg('auto', `Auto-detected (${nAuto})`)}</div>
      <ul class="timeline">${items.map((i) => (i.kind === 'curated' ? eventRow(i.ev, i.date) : feedRow(i.c))).join('') ||
        `<li class="muted" style="padding:16px 0">${state.live ? 'No changes match these filters.' : 'Auto-detected changes appear here once the refresher has run on the deployed site.'}</li>`}</ul>
    </div>
    <aside class="side">
      <h2>How changes are found</h2>
      <p><strong>Curated records</strong> are grants, calls, reports and legal developments checked against a source by a person.</p>
      <p><strong>Auto-detected</strong> items come from organisations' public RSS feeds. Keyword rules flag possible funding news, open calls, reports, campaign outcomes, legal news and launches. Other posts are stored but not shown here. Nobody has reviewed these flags yet.</p>
      <p>Every record keeps three dates apart: <em>when it happened</em>, <em>when the source published it</em> and <em>when we last checked</em>.</p>
      <h2 style="margin-top:20px">Refresh status</h2>
      <ul>
        <li>${state.data.source_health.feeds} public feeds checked daily; ${state.data.source_health.total - state.data.source_health.feeds} homepages checked monthly</li>
        <li>Last run: ${lr ? `${fmtDate(lr.finished_at, { precise: true })} UTC (${lr.sources_checked} sources, ${lr.new_items} new items)` : 'not run yet'}</li>
        ${refreshDelayed() ? `<li style="color:var(--bad)">Refresh delayed: ${esc(state.data.refresher.detail)}</li>` : ''}
        <li>${state.data.source_health.failing} sources currently failing</li>
      </ul>
    </aside></div>`;
}

function renderFunding() {
  const active = filtersActive();
  const ok = (ev) => !active || ev.entity_ids.some((id) => state.byId[id] && matches(state.byId[id]));
  const grants = state.data.events.filter((e) => e.type === 'grant_awarded' && ok(e)).sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
  const calls = state.data.events.filter((e) => e.type === 'open_call' && ok(e));
  // A grant record with no single recipient is a round total (all the grants of one round). Per-recipient
  // records from the same funder and announcement are part of it, so they are not added a second time.
  // Records whose sources disagree (disputed) are left out of the sums rather than counted twice.
  const counted = (g) => g.amount != null && g.status !== 'superseded' && g.status !== 'disputed';
  const rounds = grants.filter((g) => !g.recipient_id);
  const single = grants.filter((g) => g.recipient_id);
  const inRound = (g) => rounds.some((r) => counted(r) && r.funder_id === g.funder_id && r.source_url === g.source_url && (r.currency || '?') === (g.currency || '?'));
  const totals = {};
  const add = (g) => { totals[g.currency || '?'] = (totals[g.currency || '?'] || 0) + g.amount; };
  for (const g of single) if (counted(g) && !inRound(g)) add(g);
  for (const r of rounds) if (counted(r)) add(r);
  const nDisputed = grants.filter((g) => g.amount != null && g.status === 'disputed').length;
  const funders = new Set(grants.map((g) => g.funder_id).filter(Boolean));
  const recips = new Set(grants.map((g) => g.recipient_id).filter(Boolean));
  const order = { open: 0, 'rolling-or-unstated': 1, forthcoming: 2, closed: 3 };
  calls.sort((a, b) => (order[a.call_state] ?? 3) - (order[b.call_state] ?? 3) || String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
  const name = (id) => (state.byId[id] ? `<button class="elink" data-id="${esc(id)}">${esc(state.byId[id].name)}</button>` : '—');

  $('#view').innerHTML = `
    <section class="fund" style="margin-top:16px">
      <div class="section-head"><h2>Grants awarded</h2></div>
      <div class="stats">
        <div class="stat"><div class="v">${single.length}</div><div class="l">disclosed grants to named recipients</div></div>
        ${rounds.length ? `<div class="stat"><div class="v">${rounds.length}</div><div class="l">round totals (several grants each)</div></div>` : ''}
        <div class="stat"><div class="v">${funders.size}</div><div class="l">funders</div></div>
        <div class="stat"><div class="v">${recips.size}</div><div class="l">recipients</div></div>
        ${Object.entries(totals).map(([c, v]) => `<div class="stat"><div class="v">${money(v, c)}</div><div class="l">total disclosed in ${esc(c)}</div></div>`).join('')}
      </div>
      <p class="muted" style="font-size:var(--s-sm);max-width:90ch">These totals add up publicly disclosed awards in this sample only. They do not show an organisation's budget, or how much of the money is still unspent. A round total counts its whole round once; the round's individual grants listed below are not added again.${nDisputed ? ` ${nDisputed} record${nDisputed === 1 ? '' : 's'} whose sources disagree ${nDisputed === 1 ? 'is' : 'are'} left out of the totals.` : ''}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Awarded</th><th>Funder</th><th>Recipient</th><th>Purpose</th><th style="text-align:right">Amount</th><th>Status</th><th>Source</th></tr></thead>
        <tbody>${grants.map((g) => `<tr>
          <td class="mono" style="white-space:nowrap">${fmtDate(g.event_date)}</td><td>${name(g.funder_id)}</td><td>${g.recipient_id ? name(g.recipient_id) : '<span class="muted">several (round total)</span>'}</td>
          <td>${esc(g.title)}${g.conflicts_with?.length ? ' <span class="pill disputed">conflicting reports</span>' : ''}</td>
          <td class="amount">${money(g.amount, g.currency)}</td>
          <td><span class="pill ${esc(g.status)}" title="${esc(STATUS_HELP[g.status] || '')}">${esc(g.status)}</span></td>
          <td>${safeUrl(g.source_url) ? `<a href="${esc(g.source_url)}" target="_blank" rel="noopener">${esc(host(g.source_url))}</a>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No grant records match these filters.</td></tr>'}</tbody>
      </table></div>
    </section>
    <section class="fund">
      <div class="section-head"><h2>Funding opportunities</h2><span class="muted" style="font-size:var(--s-sm)">Check the funder's page before applying; deadlines change.</span></div>
      <ul class="calls">${calls.map((c) => `<li class="call">
        <div class="meta" style="margin-bottom:4px"><span class="pill ${esc(c.call_state)}">${c.call_state === 'rolling-or-unstated' ? 'rolling / no deadline stated' : esc(c.call_state)}</span>
          <span class="pill ${esc(c.status)}">${esc(c.status)}</span>${c.deadline ? `<span>Deadline <span class="mono">${fmtDate(c.deadline)}</span></span>` : ''}</div>
        <h3>${safeUrl(c.source_url) ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}</h3>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
        <div class="meta">${c.funder_id ? `Offered by ${name(c.funder_id)} · ` : ''}Last checked <span class="mono">${fmtDate(c.last_checked)}</span></div>
      </li>`).join('') || '<li class="muted">No funding opportunities match these filters.</li>'}</ul>
    </section>`;
}

function renderAbout() {
  const d = state.data;
  $('#view').innerHTML = `<div class="prose" style="margin-top:20px">
    <h2>What this is</h2>
    <p>A working prototype of a field map for the animal movement, modelled on the AISafety.com field map. It shows who works on which animals, where and how, and what has changed recently. Every profile and record links to its sources.</p>
    <h2>What's in v0.1</h2>
    <ul>
      <li><strong>The deep-dive:</strong> organisations, programmes, funders and resources working on farmed fish, wild-caught fish, shrimp and other crustaceans, and octopus and other cephalopods.</li>
      <li><strong>The wider movement:</strong> a lighter sample across every category, so the map shows the overall shape of the field.</li>
      <li><strong>Funding:</strong> disclosed grant records and open funding opportunities, kept separate.</li>
      <li><strong>Direct action and abolitionist groups</strong> are included in this version so we can see how including them works. Their profiles are encyclopedic only. Being listed is not endorsement and does not imply association with anyone else on the map. You can hide them with the filter.</li>
    </ul>
    <h2>How to read it</h2>
    <ul>
      <li>A missing organisation does not mean nobody does that work. This is a sample.</li>
      <li>How often an organisation posts says nothing about its activity or effectiveness.</li>
      <li>Every record keeps three dates apart: when something happened, when the source published it and when we last checked it.</li>
      <li>Grants awarded are kept separate from open calls, and announced plans separate from active projects. A funding total is not money still available.</li>
      <li>When sources disagree, both versions are kept and marked <span class="pill disputed">disputed</span>. Profiles not checked in six months are marked stale.</li>
    </ul>
    <h2>Sources and refresh</h2>
    <p>Public sources only: organisation websites and RSS feeds, published grant records and public announcements. ${d.source_health.feeds} feeds are checked daily and ${d.source_health.total - d.source_health.feeds} homepages monthly. Each check runs as a small batch every hour, and a failing source is retried less and less often. No Slack or other private community content is used.</p>
    <h3>People</h3>
    <p>v0.1 lists organisations, not individuals, and links only to organisations' own public contact pages.</p>
    <h2>Corrections</h2>
    <p>Open any profile and use “Suggest a correction”. Corrections, missing organisations and removal requests go to a review queue, and nothing changes until a maintainer accepts it.</p>
    <p class="muted mono" style="font-size:var(--s-xs)">Data: ${d.entities.length} entries · ${d.events.length} records · generated ${fmtDate(d.generated_at, { precise: true })} UTC${d.static ? ' · static snapshot' : ''}</p>
  </div>`;
}

// ---- Profile drawer ----------------------------------------------------------
function openProfile(id, push = true) {
  const e = state.byId[id];
  if (!e) return;
  state.profile = id;
  if (push && location.hash !== `#p-${id}`) history.pushState(null, '', `#p-${id}`);
  const events = state.data.events.filter((ev) => ev.entity_ids.includes(id))
    .sort((a, b) => String(b.event_date || b.source_published || '').localeCompare(String(a.event_date || a.source_published || '')));
  const feed = (state.data.changes || []).filter((c) => c.entity_id === id || (c.mentions || []).includes(id)).slice(0, 8);
  const programmes = state.data.entities.filter((x) => x.parent_id === id);
  const parent = e.parent_id && state.byId[e.parent_id];
  const others = (e.categories || []).slice(1).map((c) => CAT[c]?.label || c);
  const home = safeUrl(e.website);

  $('#drawer-root').innerHTML = `<div class="scrim" data-close></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="p-title" tabindex="-1">
    <button class="close" type="button" data-close aria-label="Close profile">×</button>
    <div class="eyebrow">${esc(KIND[e.kind] || e.kind)} · ${esc(CAT[e.primary_category]?.label || '')}</div>
    <h2 id="p-title">${esc(e.name)}</h2>
    ${e.aliases?.length ? `<p class="aka">Also known as ${esc(e.aliases.join(', '))}</p>` : ''}
    ${isDirect(e) ? '<div class="note review">Included in v1 to test coverage. This profile is encyclopedic: it is not endorsement and does not imply association with other groups on the map.</div>' : ''}
    ${e.stub ? '<div class="note">This entry exists because another record refers to it. Its profile has not been researched yet.</div>' : ''}
    ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
    <dl>
      ${home ? `<dt>Website</dt><dd><a href="${esc(home)}" target="_blank" rel="noopener">${esc(host(home))}</a></dd>` : ''}
      ${parent ? `<dt>Part of</dt><dd><button class="elink" data-id="${esc(parent.id)}">${esc(parent.name)}</button></dd>` : ''}
      ${programmes.length ? `<dt>Programmes</dt><dd>${entityLinks(programmes.map((p) => p.id))}</dd>` : ''}
      ${e.hq ? `<dt>Based in</dt><dd>${esc(e.hq)}</dd>` : ''}
      ${e.founded ? `<dt>Founded</dt><dd class="mono">${esc(e.founded)}</dd>` : ''}
      <dt>Status</dt><dd>${esc(e.status)}</dd>
      ${e.approach && e.approach !== 'unclear' ? `<dt>Approach</dt><dd>${esc(APPROACH[e.approach] || e.approach)}</dd>` : ''}
      ${others.length ? `<dt>Also works in</dt><dd>${esc(others.join(', '))}</dd>` : ''}
      ${e.species?.length ? `<dt>Animals</dt><dd>${tagList(e.species, SPECIES, AQUATIC)}</dd>` : ''}
      ${e.regions?.length ? `<dt>Regions</dt><dd>${tagList(e.regions, REGION)}${e.countries?.length ? ` <span class="muted mono" style="font-size:var(--s-xs)">${esc(e.countries.join(' '))}</span>` : ''}</dd>` : ''}
      ${e.interventions?.length ? `<dt>Approaches</dt><dd>${tagList(e.interventions, INTERVENTION)}</dd>` : ''}
      <dt>Last checked</dt><dd><span class="mono">${fmtDate(e.last_checked)}</span>${e.stale ? ' <span class="pill stale">stale</span>' : ''}</dd>
      ${e.monitoring?.length ? `<dt>Monitoring</dt><dd>${e.monitoring.map((m) => `<div><span class="dot ${m.healthy ? (m.last_checked ? 'ok' : '') : 'bad'}"></span>${m.kind === 'feed' ? 'RSS feed' : 'Homepage'}, ${esc(m.cadence)}${m.last_checked ? ` · checked ${ago(m.last_checked)}` : ' · not checked yet'}${m.error ? ` · <span style="color:var(--bad)">${esc(m.error)}</span>` : ''}</div>`).join('')}</dd>` : ''}
    </dl>
    ${e.notes ? `<h3>Open questions</h3><div class="note">${esc(e.notes)}</div>` : ''}
    ${events.length ? `<h3>Records (${events.length})</h3><ul class="list">${events.map((ev) => `<li>
      <div class="meta"><span class="pill type">${esc(EVENT_TYPE[ev.type])}</span><span class="pill ${esc(ev.status)}">${esc(ev.status)}</span><span class="mono">${fmtDate(ev.event_date)}</span></div>
      <div>${safeUrl(ev.source_url) ? `<a href="${esc(ev.source_url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>` : esc(ev.title)}${ev.amount != null ? ` · <span class="mono">${money(ev.amount, ev.currency)}</span>` : ''}</div>
    </li>`).join('')}</ul>` : ''}
    ${feed.length ? `<h3>Recent posts (auto-detected)</h3><ul class="list">${feed.map((c) => `<li>
      <div class="meta"><span class="mono">${fmtDate(c.published || c.first_seen)}</span>${c.signal ? `<span>${esc(SIGNAL[c.signal] || c.signal)}</span>` : ''}${c.entity_id !== id ? '<span>mentions this entry</span>' : ''}</div>
      <div>${safeUrl(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}</div></li>`).join('')}</ul>` : ''}
    ${e.sources?.length ? `<h3>Sources</h3><ul class="list">${e.sources.map((s) => `<li>${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || host(s.url))}</a>` : esc(s.title || s.url)}
      <div class="meta">${s.published ? `<span>Published <span class="mono">${fmtDate(s.published)}</span></span>` : ''}${s.accessed ? `<span>Accessed <span class="mono">${fmtDate(s.accessed)}</span></span>` : ''}</div></li>`).join('')}</ul>` : ''}
    <h3>Suggest a correction</h3>
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
  </aside>`;
  const drawer = $('.drawer');
  drawer.focus();
  $('#correct-form').addEventListener('submit', (ev) => submitCorrection(ev, id));
}

function closeProfile(push = true) {
  state.profile = null;
  $('#drawer-root').innerHTML = '';
  if (push && location.hash.startsWith('#p-')) history.pushState(null, '', `#${state.view}`);
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
const VIEWS = { map: renderMap, directory: renderDirectory, changes: renderChanges, funding: renderFunding, about: renderAbout };

function updateFilterCount() {
  const f = state.f;
  const n = (f.q ? 1 : 0) + f.species.size + (f.region ? 1 : 0) + (f.intervention ? 1 : 0) + (f.kind ? 1 : 0) + (f.aquatic ? 1 : 0) + (f.direct ? 0 : 1);
  $('#filter-count').textContent = n ? `(${n})` : '';
}

function render() {
  updateFilterCount();
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === state.view ? 'page' : 'false'));
  $('#filters').hidden = state.view === 'about';
  VIEWS[state.view]();
}

function route() {
  const h = location.hash.slice(1);
  if (h.startsWith('p-')) {
    if (!state.view) state.view = 'map';
    render();
    openProfile(h.slice(2), false);
    return;
  }
  state.view = VIEWS[h] ? h : 'map';
  closeProfile(false);
  render();
}

function setupFilters() {
  const ents = state.data.entities;
  const present = (key) => new Set(ents.flatMap((e) => e[key] || []));
  const sp = present('species');
  const order = Object.keys(SPECIES).filter((s) => sp.has(s));
  $('#species-chips').innerHTML = order.map((s) => `<button type="button" class="chip${AQUATIC.has(s) ? ' water' : ''}" data-species="${s}" aria-pressed="false">${esc(SPECIES[s])}</button>`).join('');
  const fill = (sel, dict, set) => { $(sel).insertAdjacentHTML('beforeend', Object.keys(dict).filter((k) => set.has(k)).map((k) => `<option value="${k}">${esc(dict[k])}</option>`).join('')); };
  fill('#f-region', REGION, present('regions'));
  fill('#f-intervention', INTERVENTION, present('interventions'));
  fill('#f-kind', KIND, new Set(ents.map((e) => e.kind)));

  const update = () => { try { localStorage.setItem('amm-direct', state.f.direct ? '1' : '0'); } catch {} render(); };
  $('#species-chips').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-species]'); if (!b) return;
    const s = b.dataset.species;
    state.f.species.has(s) ? state.f.species.delete(s) : state.f.species.add(s);
    b.setAttribute('aria-pressed', state.f.species.has(s));
    update();
  });
  let t;
  $('#q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.f.q = ev.target.value.trim(); update(); }, 120); });
  $('#f-region').addEventListener('change', (ev) => { state.f.region = ev.target.value; update(); });
  $('#f-intervention').addEventListener('change', (ev) => { state.f.intervention = ev.target.value; update(); });
  $('#f-kind').addEventListener('change', (ev) => { state.f.kind = ev.target.value; update(); });
  $('#f-aquatic').addEventListener('change', (ev) => { state.f.aquatic = ev.target.checked; update(); });
  $('#f-direct').addEventListener('change', (ev) => { state.f.direct = ev.target.checked; update(); });
  $('#reset').addEventListener('click', () => {
    Object.assign(state.f, { q: '', species: new Set(), region: '', intervention: '', kind: '', aquatic: false, direct: true });
    $('#q').value = ''; ['#f-region', '#f-intervention', '#f-kind'].forEach((s) => ($(s).value = ''));
    $('#f-aquatic').checked = false; $('#f-direct').checked = true;
    document.querySelectorAll('[data-species]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    update();
  });
  $('#filter-toggle').addEventListener('click', (ev) => {
    const collapsed = $('#filters').classList.toggle('collapsed');
    ev.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  });
  try { if (localStorage.getItem('amm-direct') === '0') { state.f.direct = false; $('#f-direct').checked = false; } } catch {}
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
  $('#freshness').innerHTML = `
    <div><span class="dot ${cls}"></span><b>${state.live ? (delayed ? 'Live data · refresh delayed' : 'Live data') : 'Static snapshot'}</b> · ${d.entities.length} entries · ${d.events.length} records</div>
    <div>${delayed ? `${esc(d.refresher.detail)} ` : ''}${lr ? `Last refresh ${ago(lr.finished_at)} · ${lr.sources_checked} sources checked` : state.live ? 'Waiting for the first scheduled refresh' : `Built ${fmtDate(d.generated_at)}`}</div>`;
  $('#footer-meta').textContent = `${health.total} public sources monitored · snapshot generated ${fmtDate(d.generated_at, { precise: true })} UTC`;
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

async function main() {
  try {
    state.data = await load();
  } catch (err) {
    $('#view').innerHTML = `<div class="banner">The map data didn't load (${esc(err.message)}). Reload the page; if that fails, the data service may be down.</div>`;
    $('#freshness').textContent = 'Data unavailable';
    return;
  }
  state.byId = Object.fromEntries(state.data.entities.map((e) => [e.id, e]));
  for (const ev of state.data.events) ev.call_state = currentCallState(ev);
  setupFilters();
  renderFreshness();

  document.addEventListener('click', (ev) => {
    const idEl = ev.target.closest('[data-id]');
    if (idEl) { ev.preventDefault(); openProfile(idEl.dataset.id); return; }
    if (ev.target.closest('[data-close]')) { closeProfile(); return; }
    const sort = ev.target.closest('[data-sort]');
    if (sort) { const k = sort.dataset.sort; state.dirSort = [k, state.dirSort[0] === k ? -state.dirSort[1] : 1]; renderDirectory(); return; }
    const mode = ev.target.closest('[data-mode]');
    if (mode) { state.changesMode = mode.dataset.mode; renderChanges(); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.profile) closeProfile(); });
  window.addEventListener('hashchange', route);
  route();
}

main();
