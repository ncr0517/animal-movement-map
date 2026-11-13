import { runRefresh } from './refresh.js';
import { readCapped } from './lib/body.js';
import { callState } from './lib/calls.js';
import { clientPrefix } from './lib/client.js';
import { cleanLink, detectMentions } from './lib/feeds.js';
import { refresherHealth } from './lib/health.js';
import STATIC from './generated/static.js';

// Only the default export lives here: the runtime reads other exports of the entry module as entrypoints.
const STALE_DAYS = 180;
const CHANGES_MAX_BYTES = 1_500_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

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

async function buildSnapshot(env) {
  const db = env.DB;
  const now = Date.now();
  // Feed items are read through an index on COALESCE(published, first_seen), bounded on both sides: a feed
  // date more than a day ahead is not trusted (src/lib/feeds.js drops those when it parses a feed).
  const [ents, evs, links, srcs, run, attempt, finished, aliases, items] = await db.batch([
    db.prepare('SELECT * FROM entities'),
    db.prepare('SELECT * FROM events'),
    db.prepare('SELECT * FROM event_entities'),
    db.prepare("SELECT * FROM sources WHERE visibility='public'"),
    db.prepare('SELECT * FROM refresh_runs WHERE finished_at IS NOT NULL AND sources_checked > 0 ORDER BY id DESC LIMIT 1'),
    db.prepare('SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1'),
    db.prepare('SELECT finished_at FROM refresh_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'),
    db.prepare('SELECT alias_norm, entity_id, alias FROM aliases'),
    db.prepare(`SELECT f.id, f.source_id, f.entity_id, f.title, f.link, f.published, f.first_seen, f.excerpt, f.signal, f.species, f.mentions, f.meaningful
                FROM feed_items f JOIN sources s ON s.id=f.source_id
                WHERE s.visibility='public' AND COALESCE(f.published, f.first_seen) >= ? AND COALESCE(f.published, f.first_seen) <= ?
                ORDER BY COALESCE(f.published, f.first_seen) DESC LIMIT 400`)
      .bind(new Date(now - 120 * DAY).toISOString(), new Date(now + DAY).toISOString()),
  ]);

  const byEvent = {};
  for (const l of links.results) (byEvent[l.event_id] ||= []).push(l.entity_id);

  const feedsByEntity = {};
  for (const s of srcs.results) (feedsByEntity[s.entity_id] ||= []).push(s);
  // Publishers whose terms allow only the headline and link to be reused (set per feed in the research data).
  const headlineOnly = new Set(srcs.results.filter((s) => s.reuse === 'headline').map((s) => s.id));

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

  // Feed items are kept across reseeds, so some were matched under older, looser mention rules (which tied
  // "The Animal Law Podcast" to The Animal Law Foundation). Each stored mention is checked again against the
  // item's own text and today's names. Items stored without an excerpt (headline-only feeds) were matched on
  // text that was never kept, under the current rules, so their mentions stand.
  const aliasRows = aliases.results.map((r) => [r.alias_norm, r.entity_id, r.alias]);
  const recheck = (i, ids) => (!ids.length || i.excerpt == null ? ids
    : detectMentions(`${i.title}. ${i.excerpt}`, aliasRows.filter((r) => ids.includes(r[1])), i.entity_id));

  // Newest first, until CHANGES_MAX_BYTES of JSON: whatever the feeds hold, the snapshot stays well under the
  // 4 MB Movement Match accepts.
  const changes = [];
  let changeBytes = 0;
  const utf8 = new TextEncoder();
  for (const { source_id, ...i } of items.results) {
    const change = {
      ...i,
      link: cleanLink(i.link),
      excerpt: headlineOnly.has(source_id) ? null : i.excerpt,
      species: parse(i.species, []),
      mentions: recheck(i, parse(i.mentions, [])),
      meaningful: Boolean(i.meaningful),
    };
    changeBytes += utf8.encode(JSON.stringify(change)).length + 1;
    if (changeBytes > CHANGES_MAX_BYTES) break;
    changes.push(change);
  }

  const s = srcs.results;
  const lastSourceCheck = s.reduce((m, x) => (x.last_checked && x.last_checked > m ? x.last_checked : m), '') || null;
  return {
    generated_at: new Date(now).toISOString(),
    last_refresh: run.results[0] || null,
    refresher: refresherHealth({ lastAttempt: attempt.results[0], lastFinishedAt: finished.results[0]?.finished_at, lastSourceCheck }, now),
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

async function snapshotResponse(env) {
  const snap = await buildSnapshot(env);
  // An empty directory means the database is being reseeded (or the seed failed). Say so, and don't let the
  // edge cache it: browsers then fall back to the static snapshot.json, and Movement Match keeps its copy.
  if (!snap.entities.length) {
    return json({ error: 'The directory is being reloaded. Try again in a minute.' },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  }
  return json(snap);
}

async function healthResponse(env) {
  const db = env.DB;
  const [attempt, finished, checked] = await db.batch([
    db.prepare('SELECT started_at, finished_at FROM refresh_runs ORDER BY id DESC LIMIT 1'),
    db.prepare('SELECT finished_at FROM refresh_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'),
    db.prepare("SELECT MAX(last_checked) AS t FROM sources WHERE visibility='public'"),
  ]);
  return json({
    ok: true,
    time: new Date().toISOString(),
    refresher: refresherHealth({ lastAttempt: attempt.results[0], lastFinishedAt: finished.results[0]?.finished_at, lastSourceCheck: checked.results[0]?.t }),
  });
}

// Edge cache keyed on the path alone: a query string must not be a way to skip the cache and make every
// request rebuild the snapshot from D1. Only 200 responses are cached.
async function cached(request, ctx, ttl, producer) {
  const cache = caches.default;
  const url = new URL(request.url);
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await producer();
  if (res.status === 200) {
    res.headers.set('cache-control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

// ---- Public corrections queue ------------------------------------------------------------------------
// The form is the only public write. Its limits: JSON only (a cross-site form or text/plain POST is
// refused, and a cross-site fetch with a JSON content type needs a CORS preflight, which this Worker never
// grants), a 16 KB body, an optional per-IP rate limiter (the CORRECTIONS_LIMITER binding, when the owner
// adds it), at most CORRECTIONS_PER_CLIENT_DAY a day from one address, and an overall cap per hour and per
// day. The caps are checked in the same statement that stores the correction, so parallel requests cannot
// get past them. They count the corrections of the last hour and day that are still in the queue and not
// rejected, so deleting or rejecting spam reopens the form. One address alone cannot reach the overall caps;
// many addresses together still can (docs/handoff.md).
const CORRECTION_KINDS = new Set(['correction', 'missing-entity', 'removal-request', 'access-concern']);
const CORRECTION_STATUSES = ['accepted', 'rejected', 'needs-info', 'pending'];
const CORRECTION_MAX_BYTES = 16 * 1024;
const CORRECTIONS_PER_HOUR = 30;
const CORRECTIONS_PER_DAY = 200;
const CORRECTIONS_PER_CLIENT_DAY = 5;
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : null) || null;

// Who sent a correction, for the per-address cap: the address (an IPv6 address cut to its /64) as an HMAC keyed
// with the admin token, so the stored value cannot be turned back into an address without it. Rows older than
// two days are deleted.
async function clientKey(request, env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_TOKEN || 'animal-movement-map'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(clientPrefix(request.headers.get('cf-connecting-ip'))));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Created by db/schema.sql; created here too, so corrections keep working on a database that has not been
// reseeded since this table was added.
const CORRECTION_CLIENTS_DDL = [
  `CREATE TABLE IF NOT EXISTS correction_clients (correction_id INTEGER PRIMARY KEY, client TEXT NOT NULL, created_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_correction_clients ON correction_clients(client, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_corrections_recent ON corrections(created_at, status)',
];

// Stores the correction if every cap allows it, and returns its id (null when a cap is reached). One batch,
// which D1 runs as a single transaction: the first statement checks the caps and inserts in one step; the
// second records the sender against the row the first one inserted (when it inserted nothing, the newest row
// belongs to an earlier batch that already recorded its sender, and OR IGNORE leaves that alone).
async function storeCorrection(db, values, client, now) {
  const at = new Date(now).toISOString();
  const since = (ms) => new Date(now - ms).toISOString();
  // How many rows matching `where` exist, reading at most `cap` of them.
  const count = (from, where) => `(SELECT COUNT(*) FROM (SELECT 1 FROM ${from} WHERE ${where} LIMIT ?))`;
  const [inserted] = await db.batch([
    db.prepare(`INSERT INTO corrections (entity_id, event_id, kind, field, proposed_value, evidence_url, note, contact, created_at)
        SELECT ?,?,?,?,?,?,?,?,?
        WHERE ${count('correction_clients', 'client = ? AND created_at > ?')} < ?
          AND ${count('corrections', "created_at > ? AND status <> 'rejected'")} < ?
          AND ${count('corrections', "created_at > ? AND status <> 'rejected'")} < ?
        RETURNING id`)
      .bind(...values, at,
        client, since(DAY), CORRECTIONS_PER_CLIENT_DAY, CORRECTIONS_PER_CLIENT_DAY,
        since(HOUR), CORRECTIONS_PER_HOUR, CORRECTIONS_PER_HOUR,
        since(DAY), CORRECTIONS_PER_DAY, CORRECTIONS_PER_DAY),
    db.prepare(`INSERT OR IGNORE INTO correction_clients (correction_id, client, created_at)
        SELECT id, ?, created_at FROM corrections WHERE id = (SELECT MAX(id) FROM corrections) AND created_at = ?`)
      .bind(client, at),
  ]);
  return inserted.results[0]?.id ?? null;
}

async function submitCorrection(request, env) {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') || '')) {
    return json({ error: 'Send the correction as JSON (content-type: application/json).' }, { status: 415 });
  }
  const tooLarge = () => json({ error: `A correction can be at most ${CORRECTION_MAX_BYTES / 1024} KB.` }, { status: 413 });
  if (Number(request.headers.get('content-length')) > CORRECTION_MAX_BYTES) return tooLarge();
  const { text, truncated } = await readCapped(request.body, { maxBytes: CORRECTION_MAX_BYTES });
  if (truncated) return tooLarge();
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Send the correction as JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Send the correction as a JSON object.' }, { status: 400 });
  if (body.website) return json({ ok: true }); // honeypot field filled → silently drop
  const kind = CORRECTION_KINDS.has(body.kind) ? body.kind : 'correction';
  const note = clip(body.note, 4000);
  if (!note || note.length < 10) return json({ error: 'Describe the correction in at least 10 characters.' }, { status: 400 });
  const evidence = clip(body.evidence_url, 1000);
  if (evidence && !/^https?:\/\//i.test(evidence)) return json({ error: 'Evidence must be a web link starting with http(s)://.' }, { status: 400 });

  const busy = () => json({ error: 'The review queue is not taking more corrections right now. Try again later.' },
    { status: 429, headers: { 'retry-after': '3600' } });
  if (env.CORRECTIONS_LIMITER) {
    const { success } = await env.CORRECTIONS_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (!success) return busy();
  }
  const values = [clip(body.entity_id, 120), clip(body.event_id, 120), kind, clip(body.field, 80), clip(body.proposed_value, 2000),
    evidence, note, clip(body.contact, 200)];
  const client = await clientKey(request, env);
  const now = Date.now();
  let id;
  try {
    id = await storeCorrection(env.DB, values, client, now);
  } catch (err) {
    if (!/no such table: correction_clients/i.test(String(err?.message || err))) throw err;
    await env.DB.batch(CORRECTION_CLIENTS_DDL.map((sql) => env.DB.prepare(sql)));
    id = await storeCorrection(env.DB, values, client, now);
  }
  if (id == null) return busy();
  // Senders are kept only as long as the per-address cap needs them.
  await env.DB.prepare('DELETE FROM correction_clients WHERE created_at < ?').bind(new Date(now - 2 * DAY).toISOString()).run()
    .catch((err) => console.error('pruning correction_clients failed', err));
  return json({ ok: true, id }, { status: 201 });
}

// ids (an array of integers) → a single bound JSON parameter, read with json_each: D1 allows at most 100
// bound parameters per query, and a bulk action may name more rows than that.
const idList = (ids) => JSON.stringify((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 5000));

async function adminRoutes(request, env, url) {
  if (!isAdmin(request, env)) return json({ error: 'Admin token required.' }, { status: 401 });
  const db = env.DB;
  if (url.pathname === '/api/admin/corrections' && request.method === 'GET') {
    // Newest first, 200 at a time; pass the smallest id you have seen as before_id to get the next page.
    const status = url.searchParams.get('status') || 'pending';
    const beforeId = Number(url.searchParams.get('before_id')) || Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 500);
    const { results } = await db.prepare('SELECT * FROM corrections WHERE status=? AND id < ? ORDER BY id DESC LIMIT ?')
      .bind(status, beforeId, limit).all();
    return json(results);
  }
  if (url.pathname === '/api/admin/corrections/bulk' && request.method === 'POST') {
    // { "action": "reject" | "delete", "ids": [..] } or { "action": ..., "from_id": n, "to_id": m },
    // limited to rows whose status is "status" (default "pending"; "any" for all).
    const b = await request.json().catch(() => ({}));
    if (!['reject', 'delete'].includes(b.action)) return json({ error: 'action must be reject or delete' }, { status: 400 });
    const where = [];
    const binds = [];
    if (Array.isArray(b.ids) && b.ids.length) {
      where.push('id IN (SELECT value FROM json_each(?))');
      binds.push(idList(b.ids));
    } else if (Number.isInteger(b.from_id) && Number.isInteger(b.to_id)) {
      where.push('id BETWEEN ? AND ?');
      binds.push(b.from_id, b.to_id);
    } else {
      return json({ error: 'Give ids (an array) or from_id and to_id.' }, { status: 400 });
    }
    const status = b.status ?? 'pending';
    if (status !== 'any') {
      if (!CORRECTION_STATUSES.includes(status)) return json({ error: 'status must be pending, accepted, rejected, needs-info or any' }, { status: 400 });
      where.push('status = ?');
      binds.push(status);
    }
    const r = b.action === 'delete'
      ? await db.prepare(`DELETE FROM corrections WHERE ${where.join(' AND ')}`).bind(...binds).run()
      : await db.prepare(`UPDATE corrections SET status='rejected', reviewer_note=?, reviewed_at=? WHERE ${where.join(' AND ')}`)
        .bind(clip(b.reviewer_note, 2000), new Date().toISOString(), ...binds).run();
    return json({ ok: true, changed: r.meta?.changes ?? 0 });
  }
  const m = url.pathname.match(/^\/api\/admin\/corrections\/(\d+)$/);
  if (m && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!CORRECTION_STATUSES.includes(b.status)) return json({ error: 'status must be accepted, rejected, needs-info or pending' }, { status: 400 });
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
  if (url.pathname === '/api/admin/items/reviewed' && request.method === 'POST') {
    // Take items out of the review queue: { "ids": [..] }, or { "seen_before": ISO time } for everything
    // first seen at or before that time.
    const b = await request.json().catch(() => ({}));
    let r;
    if (Array.isArray(b.ids) && b.ids.length) {
      const ids = JSON.stringify(b.ids.filter((x) => typeof x === 'string').slice(0, 5000));
      r = await db.prepare('UPDATE feed_items SET reviewed=1 WHERE reviewed=0 AND id IN (SELECT value FROM json_each(?))').bind(ids).run();
    } else if (typeof b.seen_before === 'string' && !Number.isNaN(Date.parse(b.seen_before))) {
      r = await db.prepare('UPDATE feed_items SET reviewed=1 WHERE reviewed=0 AND first_seen <= ?').bind(new Date(b.seen_before).toISOString()).run();
    } else {
      return json({ error: 'Give ids (an array of item ids) or seen_before (an ISO date).' }, { status: 400 });
    }
    return json({ ok: true, changed: r.meta?.changes ?? 0 });
  }
  return json({ error: 'Not found' }, { status: 404 });
}

// The page runs only its own script (public/app.js); a value that slips past escaping cannot run inline code.
const CSP = "script-src 'self'; object-src 'none'; base-uri 'self'";

function serveStatic(request, url) {
  const key = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = STATIC[key];
  if (!f || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (request.headers.get('if-none-match') === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
  const cache = key === '/index.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=300';
  return new Response(request.method === 'HEAD' ? null : f.body, {
    headers: {
      'content-type': f.type, etag: f.etag, 'cache-control': cache, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': CSP,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      // `return await`, so a rejected promise lands in the catch below and answers JSON, not a bare 500.
      if (url.pathname === '/api/health') return await cached(request, ctx, 60, () => healthResponse(env));
      if (url.pathname === '/api/snapshot' && request.method === 'GET') return await cached(request, ctx, 300, () => snapshotResponse(env));
      if (url.pathname === '/api/corrections' && request.method === 'POST') return await submitCorrection(request, env);
      if (url.pathname.startsWith('/api/admin/')) return await adminRoutes(request, env, url);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 });
      return serveStatic(request, url);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error', detail: String(err?.message || err) }, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env, { trigger: `cron ${event.cron}` }).catch((err) => console.error('refresh run failed', err)));
  },
};
