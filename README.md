# Animal Movement Map

A navigable, source-linked field map of the animal movement: who is working on which animals, where, how, with what
funding, and what has changed recently. Modelled on [AISafety.com's field map](https://aisafety.com/map), with one
addition: the map keeps itself fresh from public sources.

**Start here:** [`docs/handoff.md`](docs/handoff.md) explains what this is, how to run, test and deploy it, what
the last audit changed, and the owner's open questions.

**v0.1 scope:** an in-depth look at **fish and other aquatic animals**, plus a lighter frame across the whole movement,
including direct-action and abolitionist groups so we can see how including them works (see `docs/scope-v1.md`).

## Views

- **Map**: entries grouped into functional "territories". Marker shape shows the kind of entry (organisation,
  programme, funder, resource, network, leaderless banner). Blue markers work on aquatic animals.
- **Directory**: a sortable table of the same data.
- **Changes**: curated records (grants, calls, reports, legal developments) plus items auto-detected from public RSS feeds.
- **Funding**: grants awarded and open calls, kept separate.
- **Profiles**: aliases, tags, sources with dates, records, recent posts, monitoring health, and a corrections form.

Filters: species, region, intervention, kind, aquatic-only, and show/hide direct-action groups. Search covers names,
aliases and summaries.

## Architecture

```
Cloudflare Worker (src/index.js)
 ├─ static pages: public/ (index.html, app.js, styles.css, snapshot.json fallback),
 │   bundled into src/generated/static.js at build time and served by the Worker
 ├─ GET  /api/snapshot           entities + events + recent feed items + refresher status (cached 5 min)
 │                               (Movement Match reads this hourly: keep its entity fields compatible)
 ├─ GET  /api/health             liveness + refresher status (cached 1 min)
 ├─ POST /api/corrections        public corrections queue (JSON, ≤16 KB, capped per hour and per day)
 ├─ /api/admin/*                 review corrections (paged, bulk), inspect sources/items, mark items reviewed,
 │                               run refresh (Bearer ADMIN_TOKEN)
 └─ cron "23 * * * *"            src/refresh.js: checks ≤6 due sources per run (daily feeds, monthly homepages)
D1 database (db/schema.sql)
 entities · aliases · events · event_entities · sources · feed_items · corrections · refresh_runs
```

Data pipeline:

```
data/research/*.json  ──┐
data/curated/*.json   ──┴─ scripts/build-seed.mjs (logic in scripts/lib/seed.mjs) ─→ db/seed.sql + public/snapshot.json + data/seed/build-report.md
```

The build step validates tags against the taxonomy, reconciles alternate names into one entity, creates stub entities
for funders or recipients that are referenced but not yet researched, merges records marked `same_as` (or identical),
warns about records that only look alike, and keeps conflicting reports side by side marked as `disputed`. It stops
if an input file is invalid or if far fewer records would be published than before.

## Develop

```bash
npm ci
npm test           # node --test: feeds, build, refresher, Worker routes, Movement Match contract
npm run build      # db/seed.sql, public/snapshot.json, data/seed/build-report.md, src/generated/static.js
npm run dev        # builds seed, loads local D1, runs wrangler dev
```

The tests run the real Worker and refresher against an in-memory SQLite stand-in for D1 (`test/helpers/d1.js`), so
they need Node 22.5 or later and no Cloudflare account.

## Deploy (Cloudflare)

Live at **https://animal-movement-map.ncr0517.workers.dev** (D1 database `animal-movement-map` is already created and
its id is in `wrangler.jsonc`).

```bash
npm run build                                   # seed SQL + snapshot + bundled static pages
npm run db:remote                               # reload entities/events/sources (corrections are kept)
npx wrangler deploy
```

First-time setup on a new account: `npx wrangler d1 create animal-movement-map`, put the id in `wrangler.jsonc`, and
`npx wrangler secret put ADMIN_TOKEN` with a long random string.

Static pages are embedded in the Worker instead of using Workers Static Assets, so a deploy is a single API
call authenticated with the account API token. This works from environments that inject the token at a proxy.

Wrangler needs `CLOUDFLARE_API_TOKEN` with Workers Scripts: Edit, D1: Edit and Account Settings: Read.

After a reseed, run a first refresh pass instead of waiting for the hourly batches:

```bash
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"batch":10}' https://animal-movement-map.ncr0517.workers.dev/api/admin/refresh
```

## Docs

- `docs/handoff.md`: start here (running, deploying, audit status, owner questions)
- `docs/scope-v1.md`: the proposed bounded sample section, success measures, open questions
- `docs/source-inventory.md`: candidate sources, machine-readable access, reuse terms
- `docs/hive-access.md`: separate investigation of permissioned Hive Slack access (nothing connected)
- `docs/update-workflow.md`: refresh cadence, change detection, maintainer loop, reconciliation rules

## Principles

Absence from the map is not evidence that no work exists. Posting volume is not organisational activity or
effectiveness. Where an entry sits on the map shows its primary function only, and never collaboration or influence. Public sources only;
no individual profiles in v0.1.
