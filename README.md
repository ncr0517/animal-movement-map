# Animal Movement Map

A navigable, source-linked field map of the animal movement: who is working on which animals, where, how, with what
funding, and what has changed recently. Modelled on [AISafety.com's field map](https://aisafety.com/map), with one
addition: the map keeps itself fresh from public sources.

**Start here:** [`docs/handoff.md`](docs/handoff.md) explains what this is, how to run, test and deploy it, what
the last audit changed, and the owner's open questions.

**v0.1 scope:** an in-depth look at **fish and other aquatic animals**, plus a lighter frame across the whole movement,
including direct-action and abolitionist groups so we can see how including them works (see `docs/scope-v1.md`).

## Views

- **Map**: entries grouped by main focus, each appearing once (its profile lists other areas). Marker shape shows
  the kind of entry (organisation, programme, funder, resource, network, leaderless banner). On a phone the sections
  start collapsed, as an overview.
- **Coverage**: a grid of animals against regions (or methods) with a count in every cell. Select a cell to see who is
  in it, and who else works on that animal globally. Empty cells show where the sample is thin.
- **Directory**: one sortable list (cards on a phone).
- **Changes**: checked records (grants, calls, reports, legal developments) grouped by month, and on a separate tab the
  unchecked posts picked from public RSS feeds, grouped by week.
- **Profiles**: what the entry does, where and how; its grants and other records; recent posts. Sources, checks and
  the corrections form sit in collapsed sections.

Search reads names, aliases and summaries, and also every tag: animals, regions, countries, methods, focus and type
("shrimp southeast asia", "funder india"). A word nothing contains falls back to close spellings. Filters: animals,
region, method, type, a whole-movement / fish-and-aquatic switch, and show/hide direct-action groups.

A region filter never passes a global group off as a local one: entries tagged with the region come first, and the
ones that match only because they work globally or region-wide are labelled and can be hidden.

Filters, search, the selected grid cell and the open view are kept in the link, so any view can be shared:
`/?animals=crustaceans&region=southeast-asia#map`, `/?cell=crustaceans.southeast-asia#coverage`.

## Architecture

```
Cloudflare Worker (src/index.js)
 ├─ static pages: public/ (index.html, app.js, styles.css, snapshot.json fallback),
 │   bundled into src/generated/static.js at build time and served by the Worker
 ├─ GET  /api/snapshot           entities + events + recent feed items + refresher status (cached 5 min)
 │                               (Movement Match reads this hourly: keep its entity fields compatible)
 ├─ GET  /api/health             liveness + refresher status (cached 1 min)
 ├─ POST /api/corrections        public corrections queue (JSON, ≤16 KB, capped per address, per hour and per day)
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
and warns about records that only look alike (including grants that may be conflicting reports) for a person to settle.
It stops if an input file is invalid or if far fewer researched entries or records would be published than before.

## Develop

```bash
npm ci
npm test           # node --test: feeds, build, refresher, Worker routes, Movement Match contract,
                   # and the corrections form's database reads on workerd's local D1 (no account needed)
npm run build      # db/seed.sql, public/snapshot.json, data/seed/build-report.md, src/generated/static.js
npm run dev        # builds seed, loads local D1, runs wrangler dev
```

The tests run the real Worker and refresher against an in-memory SQLite stand-in for D1 (`test/helpers/d1.js`), so
they need Node 22.16 or later and no Cloudflare account.

## Deploy (Cloudflare)

Live at **https://animal-movement-map.ncr0517.workers.dev** (D1 database `animal-movement-map` is already created and
its id is in `wrangler.jsonc`).

```bash
npm run build                                   # seed SQL + snapshot + bundled static pages
npm run deploy                                  # builds again and uploads the Worker
npm run db:remote                               # reload entities/events/sources (corrections are kept)
```

Deploy before reloading the database. While the reload has emptied the tables, the current Worker answers 503 and
nothing is cached, so visitors see the built-in copy. The 6 November Worker cached the empty directory for
5 minutes instead.

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
