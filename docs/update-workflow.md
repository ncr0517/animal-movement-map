# Update workflow and refresh policy

## Two kinds of data

| | Curated records | Auto-detected items |
|---|---|---|
| What | Entity profiles; grants, open calls, reports, legal developments | Posts from public RSS/Atom feeds |
| Where | `data/research/*.json`, `data/curated/*.json` → `db/seed.sql` | `feed_items` table, filled by the hourly Worker cron |
| Checked by | A person (or research agent) against a fetched source | Keyword rules; shown as "auto-detected · unreviewed" |
| Dates kept | event date · source published · last checked (the record's `accessed` date) | feed publish date · first seen |

## Refresh cadence (proposed, needs feasibility testing)

- **Daily:** organisations' RSS feeds (fast-changing, cheap, explicitly published for syndication).
- **Monthly:** homepage liveness checks for every entity. A failure flags the profile, and repeated failures suggest
  the organisation may be inactive. A person confirms before anything is changed. A homepage that answers
  "not modified" (304) counts as a successful check.
- **Monthly (manual / scripted):** grant databases (Coefficient Giving, EA Animal Welfare Fund, ACE, GrantNav). Most have
  no stable API, so a maintainer reruns the research step and reviews the diff in `data/seed/build-report.md`.
- **On demand:** open calls before their deadlines. A call whose deadline is more than a day past is shown as closed,
  even if an override says otherwise.

The cron runs **hourly** and checks at most 6 due sources per run. That keeps every invocation inside Cloudflare's
free-tier CPU and subrequest limits. A source that fails is retried with exponential backoff (×2 per failure, capped
at ×16). Conditional requests (`ETag` / `If-Modified-Since`) avoid re-downloading unchanged feeds.

Each check has one 12-second deadline covering the request and the body, and reads at most 400 KB of a feed. A source
is marked as being checked (and counted as a failure until it succeeds) before it is fetched, so a check that never
finishes cannot hold the front of the queue, and a manual refresh that overlaps the cron does not check a source twice.
Until its check ends, a source's error reads "Check did not finish", so a check that was killed shows as failing, not
healthy. A manual refresh of one source (`{"source_id": "..."}`) leaves alone a source checked in the last 42 seconds
and reports it under `skipped`.

Feed parsing takes time in proportion to the feed's size, whatever the feed contains. Control characters are dropped
from feed text, links must be printable web addresses, and `/api/snapshot` carries at most 1.5 MB of feed posts.

If the refresher stops (no run finished in 3 hours, the latest run never finished, or no source checked in 26 hours),
`/api/snapshot` and `/api/health` report `refresher.status: "degraded"` and the page's status dot turns amber.

This is not real-time completeness. A feed only shows what an organisation chooses to post.

## What counts as a "meaningful change"

Feed items are classified by keyword rules in `src/lib/feeds.js`:
`open_call`, `funding`, `legal`, `campaign_outcome`, `report`, `launch` → surfaced on the Changes view.
`people` (hiring, appointments) and unclassified posts → stored, not surfaced.
Items also get species tags and mentions of other mapped entities (via the alias table: names as written, matched
whole; a one-word name such as "Hive" only counts when written with its capital).

Feeds marked `"reuse": "headline"` in the research data (ACE, Sentient Media, Faunalytics, whose terms allow headline +
link only) are classified from their text, but the text is never stored or shown.

## Maintainer loop

1. **Weekly:** review `GET /api/admin/items` (unreviewed auto-detected items). Promote important ones to curated
   records in `data/curated/*-events.json` with proper dates and status. Then take them off the list with
   `POST /api/admin/items/reviewed` and `{"ids": [...]}`, or `{"seen_before": "<ISO time>"}` for everything up to then.
2. **Weekly:** review `GET /api/admin/corrections` (newest 200; add `?before_id=<smallest id you saw>` for the next
   page, `?status=` for other statuses), then set each to accepted / rejected / needs-info via
   `POST /api/admin/corrections/:id`. Clear spam in bulk with `POST /api/admin/corrections/bulk` and
   `{"action": "reject" | "delete", "ids": [...]}` or `{"action": ..., "from_id": n, "to_id": m}` (pending rows only,
   unless you add `"status": "any"`). Rejected and deleted corrections no longer count toward the form's caps, so
   clearing spam reopens the form. Apply accepted corrections to the curated JSON and redeploy the seed.
3. **Monthly:** check `GET /api/admin/sources` for failing feeds; spot-check 20 random claims.
4. **Rebuild:** `npm run build` regenerates `db/seed.sql` and the report (merges, stubs, conflicts, warnings). It stops
   without writing anything if an input file is invalid, or if it would publish far fewer researched entries (stubs
   are not counted) or records than before.
   `npm run db:remote` reloads entities, events, aliases and sources. **Corrections, feed items and the refresh-run log
   are never dropped by a reseed.** Deploy the Worker first: while the reseed runs, it answers 503 on `/api/snapshot`
   (not cached) and the page uses its built-in copy.

All admin endpoints need `Authorization: Bearer $ADMIN_TOKEN` (set with `wrangler secret put ADMIN_TOKEN`).

The public corrections form accepts JSON only, at most 16 KB, at most 5 corrections a day from one address (an IPv6
/64 counts as one; only an HMAC of it is stored, for two days), and at most 30 an hour and 200 a day across everyone
(`src/index.js`). Rejected and deleted corrections do not count. The caps are checked in the statement that stores the
correction, so parallel requests cannot get past them.

One address cannot close the form, but enough addresses together can: 6 fill the hourly cap and 40 the daily one, and
then everyone gets 429 until the window passes. Nothing alerts the maintainer. Clearing the spam reopens the form;
Turnstile would stop it happening. If a `CORRECTIONS_LIMITER` rate-limit binding is added in `wrangler.jsonc`, it is
also applied per IP address. Its period can only be 10 or 60 seconds, so even its strictest setting (1 a minute)
allows more than the 5 a day above: it only takes load off the database when one address floods the form.

## Reconciliation rules

- Names are normalised (case, accents, punctuation, "the", "inc", "foundation", "e.V.") into an alias table used to
  resolve references and merge profiles.
- Records from different research files that resolve to the same alias are merged. Arrays are unioned, sources
  combined, and the merge is logged in the build report.
- Event records are merged only when one names the other in `same_as`, or when they are identical. Records that only
  look alike are kept apart and listed as warnings, for a person to settle (see `data/research/SCHEMA.md`).
- Grant records with the same funder, recipient and month and different known amounts → **both kept as they are** and
  listed as warnings: one funder can make two real grants to one recipient in a month. If they are two reports of one
  grant that disagree, a person marks both `"status": "disputed"` with `conflicts_with` in overrides.json. Year-only
  dates are never compared, an unknown amount is not a disagreement, and grants with different funder record ids are
  separate grants.
- A grant record with no recipient is a round total. The Funding view counts it once and does not add that round's
  per-recipient grants (same funder and announcement) again. Disputed amounts are left out of the totals.
- References to unknown funders or recipients create **stub** entities. They are shown in italics as "not yet researched" and
  are listed in the build report for follow-up.
- `data/curated/overrides.json` is applied after reconciliation, and every overridden field is validated.
