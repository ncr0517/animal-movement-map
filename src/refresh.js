import { parseFeed, analyseItem } from './lib/feeds.js';

const HOUR = 3600_000;
const CADENCE_MS = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR, monthly: 30 * 24 * HOUR };
// Small batches keep each cron invocation inside free-tier CPU and subrequest limits.
const DEFAULT_BATCH = 6;
const FETCH_TIMEOUT_MS = 12_000;

async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function isDue(src, now) {
  if (!src.last_checked) return true;
  const base = CADENCE_MS[src.cadence] ?? CADENCE_MS.daily;
  const backoff = 2 ** Math.min(src.consecutive_failures || 0, 4);
  return now - Date.parse(src.last_checked) >= base * backoff - 5 * 60_000;
}

async function loadAliasIndex(db) {
  const { results } = await db.prepare('SELECT alias_norm, entity_id FROM aliases').all();
  return results.map((r) => [r.alias_norm, r.entity_id]);
}

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

export async function runRefresh(env, { trigger = 'cron', batch = DEFAULT_BATCH, sourceId = null } = {}) {
  const db = env.DB;
  const startedAt = new Date().toISOString();
  const run = await db
    .prepare('INSERT INTO refresh_runs (started_at, trigger) VALUES (?, ?) RETURNING id')
    .bind(startedAt, trigger)
    .first();

  const now = Date.now();
  const { results: all } = sourceId
    ? await db.prepare("SELECT * FROM sources WHERE id = ? AND visibility = 'public'").bind(sourceId).all()
    : await db.prepare("SELECT * FROM sources WHERE visibility = 'public' ORDER BY last_checked IS NOT NULL, last_checked ASC").all();
  const due = all.filter((s) => sourceId || isDue(s, now)).slice(0, batch);

  const aliasIndex = due.some((s) => s.kind === 'feed') ? await loadAliasIndex(db) : [];
  const ua = `AnimalMovementMap/0.1 (+${env.PUBLIC_URL || 'https://animal-movement-map.workers.dev'}/#about)`;

  let newItems = 0, meaningful = 0, errors = 0;

  for (const src of due) {
    const checkedAt = new Date().toISOString();
    try {
      const headers = { 'user-agent': ua, accept: src.kind === 'feed' ? 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' : 'text/html,*/*' };
      if (src.etag) headers['if-none-match'] = src.etag;
      if (src.last_modified) headers['if-modified-since'] = src.last_modified;
      const res = await fetchWithTimeout(src.url, { method: 'GET', headers });

      if (res.status === 304) {
        await db.prepare('UPDATE sources SET last_checked=?, last_success=?, last_status=304, error=NULL, consecutive_failures=0 WHERE id=?')
          .bind(checkedAt, checkedAt, src.id).run();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (src.kind === 'feed') {
        const xml = await res.text();
        const feed = parseFeed(xml);
        if (!feed.valid) throw new Error('Response was not a valid RSS/Atom feed');
        const stmts = [];
        for (const item of feed.items) {
          const id = await sha1(`${src.id}|${item.guid}`);
          const a = analyseItem(item, aliasIndex, src.entity_id);
          stmts.push(
            db.prepare(`INSERT OR IGNORE INTO feed_items
              (id, source_id, entity_id, title, link, published, first_seen, excerpt, signal, species, mentions, meaningful)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
              .bind(id, src.id, src.entity_id, item.title, item.link, item.published, checkedAt, item.excerpt,
                a.signal, JSON.stringify(a.species), JSON.stringify(a.mentions), a.meaningful)
          );
        }
        if (stmts.length) {
          const results = await db.batch(stmts);
          for (const r of results) if (r.meta?.changes) newItems++;
          // count meaningful items first seen in this run
          const m = await db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE source_id=? AND first_seen=? AND meaningful=1')
            .bind(src.id, checkedAt).first();
          meaningful += m?.n || 0;
        }
      } else {
        // homepage liveness check: we only record that the site responded
        await res.body?.cancel();
      }

      await db.prepare(`UPDATE sources SET last_checked=?, last_success=?, last_status=?, etag=?, last_modified=?,
          error=NULL, consecutive_failures=0 WHERE id=?`)
        .bind(checkedAt, checkedAt, res.status, res.headers.get('etag'), res.headers.get('last-modified'), src.id).run();
      if (src.kind === 'homepage' && src.entity_id) {
        await db.prepare('UPDATE entities SET last_checked=? WHERE id=?').bind(checkedAt, src.entity_id).run();
      }
    } catch (err) {
      errors++;
      await db.prepare(`UPDATE sources SET last_checked=?, last_status=?, error=?, consecutive_failures=consecutive_failures+1 WHERE id=?`)
        .bind(checkedAt, /HTTP (\d+)/.exec(String(err))?.[1] || null, String(err?.message || err).slice(0, 300), src.id).run();
    }
  }

  await db.prepare('UPDATE refresh_runs SET finished_at=?, sources_checked=?, new_items=?, meaningful_items=?, errors=? WHERE id=?')
    .bind(new Date().toISOString(), due.length, newItems, meaningful, errors, run.id).run();

  return { run_id: run.id, sources_checked: due.length, new_items: newItems, meaningful_items: meaningful, errors };
}
