# Update workflow and refresh policy

## Two kinds of data

| | Curated records | Auto-detected items |
|---|---|---|
| What | Entity profiles; grants, open calls, reports, legal developments | Posts from public RSS/Atom feeds |
| Where | `data/research/*.json`, `data/curated/*.json` → `db/seed.sql` | `feed_items` table, filled by the hourly Worker cron |
| Checked by | A person (or research agent) against a fetched source | Keyword rules; shown as "auto-detected · unreviewed" |
| Dates kept | event date · source published · last checked | feed publish date · first seen |

## Refresh cadence (proposed, needs feasibility testing)

- **Daily:** organisations' RSS feeds (fast-changing, cheap, explicitly published for syndication).
- **Monthly:** homepage liveness checks for every entity. A failure flags the profile, and repeated failures suggest
  the organisation may be inactive. A person confirms before anything is changed.
- **Monthly (manual / scripted):** grant databases (Coefficient Giving, EA Animal Welfare Fund, ACE, GrantNav). Most have
  no stable API, so a maintainer reruns the research step and reviews the diff in `data/seed/build-report.md`.
- **On demand:** open calls before their deadlines; closed calls are marked closed automatically from `deadline`.

The cron runs **hourly** and checks at most 6 due sources per run. That keeps every invocation inside Cloudflare's
free-tier CPU and subrequest limits. A source that fails is retried with exponential backoff (×2 per failure, capped
at ×16). Conditional requests (`ETag` / `If-Modified-Since`) avoid re-downloading unchanged feeds.

This is not real-time completeness. A feed only shows what an organisation chooses to post.

## What counts as a "meaningful change"

Feed items are classified by keyword rules in `src/lib/feeds.js`:
`open_call`, `funding`, `legal`, `campaign_outcome`, `report`, `launch` → surfaced on the Changes view.
`people` (hiring, appointments) and unclassified posts → stored, not surfaced.
Items also get species tags and mentions of other mapped entities (via the alias table).

## Maintainer loop

1. **Weekly:** review `GET /api/admin/items` (unreviewed auto-detected items). Promote important ones to curated
   records in `data/curated/*-events.json` with proper dates and status.
2. **Weekly:** review `GET /api/admin/corrections`, then set each to accepted / rejected / needs-info via
   `POST /api/admin/corrections/:id`. Apply accepted corrections to the curated JSON and redeploy the seed.
3. **Monthly:** check `GET /api/admin/sources` for failing feeds; spot-check 20 random claims.
4. **Rebuild:** `npm run build` regenerates `db/seed.sql` and the report (merges, stubs, conflicts, warnings).
   `npm run db:remote` reloads entities, events and sources. **Corrections are never dropped by a reseed**, and feed items are
   rebuilt by the next cron runs.

All admin endpoints need `Authorization: Bearer $ADMIN_TOKEN` (set with `wrangler secret put ADMIN_TOKEN`).

## Reconciliation rules

- Names are normalised (case, accents, punctuation, "the", "inc", "foundation", "e.V.") into an alias table.
- Records from different research files that resolve to the same alias are merged. Arrays are unioned, sources
  combined, and the merge is logged in the build report.
- Grant records with the same funder, recipient and month: identical amounts → treated as one grant reported twice;
  different amounts → **both kept**, marked `disputed`, and cross-linked.
- References to unknown funders or recipients create **stub** entities. They are shown in italics as "not yet researched" and
  are listed in the build report for follow-up.
