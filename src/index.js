import { runRefresh } from './refresh.js';

const STALE_DAYS = 180;
const DAY = 86400_000;

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

const parse = (s, fallback) => {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function isAdmin(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(env.ADMIN_TOKEN) && timingSafeEqual(token, env.ADMIN_TOKEN);
}

function callState(ev, now) {
  if (ev.type !== 'open_call') return null;
  if (ev.call_state) return ev.call_state;
  if (!ev.deadline) return 'rolling-or-unstated';
  return Date.parse(ev.deadline) + DAY < now ? 'closed' : 'open';
}

async function buildSnapshot(env) {
  const db = env.DB;
  const now = Date.now();
  const [ents, evs, links, srcs, run, items] = await db.batch([
    db.prepare('SELECT * FROM entities'),
    db.prepare('SELECT * FROM events'),
    db.prepare('SELECT * FROM event_entities'),
    db.prepare("SELECT id, entity_id, url, kind, cadence, last_checked, last_success, last_status, error, consecutive_failures FROM sources WHERE visibility='public'"),
    db.prepare('SELECT * FROM refresh_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'),
    db.prepare(`SELECT f.id, f.entity_id, f.title, f.link, f.published, f.first_seen, f.excerpt, f.signal, f.species, f.mentions, f.meaningful
                FROM feed_items f JOIN sources s ON s.id=f.source_id
                WHERE s.visibility='public' AND COALESCE(f.published, f.first_seen) >= ? ORDER BY COALESCE(f.published, f.first_seen) DESC LIMIT 400`)
      .bind(new Date(now - 120 * DAY).toISOString()),
  ]);

  const byEvent = {};
  for (const l of links.results) (byEvent[l.event_id] ||= []).push(l.entity_id);

  const feedsByEntity = {};
  for (const s of srcs.results) (feedsByEntity[s.entity_id] ||= []).push(s);

  const entities = ents.results.map((e) => {
    const p = parse(e.profile, {});
    const checked = e.last_checked ? Date.parse(e.last_checked) : null;
    return {
      ...p,
      id: e.id,
      name: e.name,
      kind: e.kind,
      parent_id: e.parent_id,
      primary_category: e.primary_category,
      section: e.section,
      status: e.status,
      stub: Boolean(e.stub),
      last_checked: e.last_checked,
      stale: !checked || now - checked > STALE_DAYS * DAY,
      monitoring: (feedsByEntity[e.id] || []).map((s) => ({
        kind: s.kind, cadence: s.cadence, last_checked: s.last_checked, last_success: s.last_success,
        healthy: !s.error, error: s.error,
      })),
    };
  });

  const events = evs.results.map((ev) => ({
    ...ev,
    conflicts_with: parse(ev.conflicts_with, []),
    entity_ids: byEvent[ev.id] || [],
    call_state: callState(ev, now),
  }));

  const changes = items.results.map((i) => ({
    ...i,
    species: parse(i.species, []),
    mentions: parse(i.mentions, []),
    meaningful: Boolean(i.meaningful),
  }));

  const s = srcs.results;
  return {
    generated_at: new Date(now).toISOString(),
    last_refresh: run.results[0] || null,
    source_health: {
      total: s.length,
      feeds: s.filter((x) => x.kind === 'feed').length,
      checked: s.filter((x) => x.last_checked).length,
      failing: s.filter((x) => x.error).length,
    },
    entities,
    events,
    changes,
  };
}

async function cached(request, ctx, ttl, producer) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = json(await producer(), { headers: { 'cache-control': `public, max-age=${ttl}` } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const CORRECTION_KINDS = new Set(['correction', 'missing-entity', 'removal-request', 'access-concern']);
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : null) || null;

async function submitCorrection(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send the correction as JSON.' }, { status: 400 }); }
  if (body.website) return json({ ok: true }); // honeypot field filled → silently drop
  const kind = CORRECTION_KINDS.has(body.kind) ? body.kind : 'correction';
  const note = clip(body.note, 4000);
  if (!note || note.length < 10) return json({ error: 'Describe the correction in at least 10 characters.' }, { status: 400 });
  const evidence = clip(body.evidence_url, 1000);
  if (evidence && !/^https?:\/\//i.test(evidence)) return json({ error: 'Evidence must be a web link starting with http(s)://.' }, { status: 400 });
  const r = await env.DB.prepare(`INSERT INTO corrections (entity_id, event_id, kind, field, proposed_value, evidence_url, note, contact, created_at)
      VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`)
    .bind(clip(body.entity_id, 120), clip(body.event_id, 120), kind, clip(body.field, 80), clip(body.proposed_value, 2000),
      evidence, note, clip(body.contact, 200), new Date().toISOString())
    .first();
  return json({ ok: true, id: r.id }, { status: 201 });
}

async function adminRoutes(request, env, url) {
  if (!isAdmin(request, env)) return json({ error: 'Admin token required.' }, { status: 401 });
  const db = env.DB;
  if (url.pathname === '/api/admin/corrections' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    const { results } = await db.prepare('SELECT * FROM corrections WHERE status=? ORDER BY id DESC LIMIT 200').bind(status).all();
    return json(results);
  }
  const m = url.pathname.match(/^\/api\/admin\/corrections\/(\d+)$/);
  if (m && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!['accepted', 'rejected', 'needs-info', 'pending'].includes(b.status)) return json({ error: 'status must be accepted, rejected, needs-info or pending' }, { status: 400 });
    await db.prepare('UPDATE corrections SET status=?, reviewer_note=?, reviewed_at=? WHERE id=?')
      .bind(b.status, clip(b.reviewer_note, 2000), new Date().toISOString(), Number(m[1])).run();
    return json({ ok: true });
  }
  if (url.pathname === '/api/admin/refresh' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const out = await runRefresh(env, { trigger: 'manual', batch: Math.min(Number(b.batch) || 10, 40), sourceId: b.source_id || null });
    return json(out);
  }
  if (url.pathname === '/api/admin/sources' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM sources ORDER BY consecutive_failures DESC, last_checked ASC').all();
    return json(results);
  }
  if (url.pathname === '/api/admin/items' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM feed_items WHERE reviewed=0 ORDER BY first_seen DESC LIMIT 200').all();
    return json(results);
  }
  return json({ error: 'Not found' }, { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, time: new Date().toISOString() });
      if (url.pathname === '/api/snapshot' && request.method === 'GET') return cached(request, ctx, 300, () => buildSnapshot(env));
      if (url.pathname === '/api/corrections' && request.method === 'POST') return submitCorrection(request, env);
      if (url.pathname.startsWith('/api/admin/')) return adminRoutes(request, env, url);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 });
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error', detail: String(err?.message || err) }, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env, { trigger: `cron ${event.cron}` }));
  },
};
