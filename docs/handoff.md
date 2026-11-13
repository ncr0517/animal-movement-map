# Handoff: Animal Movement Map

Start here. Written for the owner and the next agent. Last updated 13 November 2026, after the audit fixes and their review.

## What it is

A public directory of animal-advocacy organisations, programmes and funders, with their grants, open calls and
recent news. Every entry links to its sources. v0.1 was built on 5-6 November 2026. It looks in depth at fish and
other aquatic animals, and more lightly at the rest of the movement.

- Live site: https://animal-movement-map.ncr0517.workers.dev
- Code: https://github.com/ncr0517/animal-movement-map (public)
- Runs as one Cloudflare Worker (plain JavaScript) with a D1 database.
- An hourly cron (`23 * * * *`) checks up to 6 feeds or homepages per run.

## Who depends on it

Movement Match (a separate project) downloads `/api/snapshot` every hour. It keeps each entity's id, name, kind,
status, section, approach, interventions, species, categories and website.

So:

- Don't rename or remove those fields, or change their values' vocabulary, without changing Movement Match too.
- Keep the response under 4 MB. The live response was about 500 KB on 11 November. The snapshot carries at most
  1.5 MB of feed posts (newest first), so feeds alone cannot push it over.
- `test/contract.test.js` checks all of this. If it fails, stop and check Movement Match before changing the test.

Adding new top-level fields is fine (this audit added `refresher`).

## Run, test, build

Needs Node 22.16 or later (the test helper uses `node:sqlite` and its `StatementSync.columns()`, added in 22.16).
On Windows, use Git Bash.

```bash
npm ci
npm test         # 64 tests, about 6 seconds
npm run build    # writes db/seed.sql, public/snapshot.json, data/seed/build-report.md
npm run dev      # local site with a local database
```

If you run `wrangler dev` yourself, use `--port 8797` (another project uses 8787), and stop it by its process id
when you're done.

The build stops without writing anything when a data file is broken, or when it would publish more than 10% fewer
researched entries (stubs are not counted) or records than the last build, or lose more than half of a section's
entries. Set `ALLOW_SHRINK=1` only if the removal is intended.

## Deploy (owner only)

There is no CI and no automatic deploy. Merging to `main` changes nothing on the live site. Only the owner deploys.

Run these in order, from an up-to-date `main`:

```bash
npm run build
npm run deploy       # builds again and uploads the Worker
npm run db:remote    # reloads the directory data into the live database
```

Deploy first. `db:remote` empties the directory tables and then refills them. While they are empty, the new Worker
answers 503 and caches nothing, so visitors see the built-in copy. The 6 November Worker would answer with an empty
directory and cache it for 5 minutes. The new Worker works on the old database, so deploying first loses nothing.

Then start a first refresh instead of waiting for the hourly runs:

```bash
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"batch":10}' https://animal-movement-map.ncr0517.workers.dev/api/admin/refresh
```

A reseed (`db:remote`) keeps corrections, feed posts and the refresh log. While it runs, the site shows its built-in
copy of the data for a minute.

Agents: never run `npm run deploy`, `npm run db:remote`, `wrangler deploy` or any wrangler command with `--remote`,
and never call the live site's `/api/admin/*` endpoints. Reading its public pages is fine.

## What the audit fixed

An audit on 10-11 November 2026 confirmed 33 findings (several were the same problem found twice). All were fixed
in the pull request that added this file, each with a test that fails without the fix where a test was practical.

The refresher (hourly feed checks):

- One slow or huge feed could stop the refresher for good. Each check now has a single 12-second deadline that
  covers the whole download, and reads at most 400 KB.
- A source is now marked as being checked before it is fetched. A check that never finishes can't hold the front
  of the queue, and an overlapping manual refresh, including one for a single source, no longer checks a source twice
  or counts one failure twice. Until a check ends, the source shows the error "Check did not finish", so a check that
  was killed shows as failing, not healthy.
- Parsing a feed takes time in proportion to its size. A hostile 220-byte feed used to take seconds of CPU, enough to
  get the whole run killed.
- A run that crashes is still recorded as finished.
- A homepage that answers "not modified" now counts as checked, so healthy profiles stop drifting to "stale".
- If the refresher stops, the page now says "refresh delayed" with an amber dot, and `/api/snapshot` and
  `/api/health` report `refresher.status: "degraded"`.

Feeds and mentions:

- Feed posts no longer link to unrelated entries because of ordinary words. "The Animal Law Podcast" is no longer
  The Animal Law Foundation, and "awash", "lever", "hive", "viva" and "sentient" no longer match entries. Entries
  are also found by their plain names where their full names carry more (European Commission, University of Stirling,
  Wageningen University, Brooks Institute).
- Feed links must be printable web links under 2,000 characters, control characters are dropped from feed text, feed
  dates far in the future are ignored, and the snapshot carries at most 1.5 MB of feed posts. One feed can no longer
  push the snapshot past Movement Match's 4 MB limit.
- A post with no guid is known by its link as written, as before the audit, so posts that share a title are all kept
  and stored posts keep their ids.
- Feed type is read from the document itself, so an RSS post that quotes `<feed>` is not misread as Atom.
- Text from ACE, Sentient Media and Faunalytics feeds is no longer stored or shown, only headline and link, as
  `docs/source-inventory.md` says their terms require.

The public site and API:

- `/api/snapshot?anything` no longer skips the cache. Before, it rebuilt the whole snapshot from the database on
  every request, which could use up the free daily database quota.
- The snapshot query now uses an index instead of reading every feed post.
- An empty database (mid-reseed) now answers 503 and isn't cached, so visitors see the built-in copy.
- The corrections form now accepts JSON only, at most 16 KB each, at most 5 a day from one address (an IPv6 /64
  counts as one), and at most 30 an hour and 200 a day overall. The caps are checked in the same statement that
  stores the correction, so parallel requests can't get past them. Rejected and deleted corrections don't count, so
  clearing spam reopens the form. Before, anyone could fill the database.
- New admin tools: page through corrections (`?before_id=`), reject or delete in bulk
  (`/api/admin/corrections/bulk`), and mark feed posts reviewed (`/api/admin/items/reviewed`).
- Pages are served with a Content-Security-Policy, and amounts with a malformed currency are escaped. A bad value in
  the data could otherwise run a script in visitors' browsers.
- An open call whose deadline has passed now shows as closed, even if an override said "forthcoming".

The data and the build:

- `npm run build` now works on Windows, and in folders whose path has a space.
- A broken data file now stops the build. Before, it quietly published a smaller directory. A missing or emptied
  research file stops it too: the check counts researched entries, not the stubs their records leave behind.
- The build deleted a real grant: EA Funds' second $72,000 grant to Shrimp Welfare Project. It is back. Grants are
  now merged only when marked as the same (`same_as`) or identical. Look-alikes, including grants that differ only in
  amount, are listed as warnings instead; only a person marks grants `disputed`. Records that name each other in
  `same_as` become one record, and chains of `same_as` resolve.
- Two open calls were listed twice (Fish Welfare Initiative India, and Ambitious Impact's February 2027 cohort).
  Each now appears once.
- The Funding totals counted ACE's round 11 twice (the round total plus two of its grants), $174,400 too much.
  Round totals now count once, and disputed amounts are left out.
- Every rebuild used to stamp all 104 records "last checked" with the build date. Records now keep their own
  research date (5 November 2026).
- Overrides in `data/curated/overrides.json` are now checked like research data, and aliases they add (such as
  UFAW for Science for Animal Welfare) are used to spot mentions.
- Feed posts are kept across reseeds. Before, a reseed lost posts that had dropped off their feed.

A review of these fixes on 13 November found 14 more problems in them. They are fixed in the same pull request, and
the list above describes the result.

## What changes only after the owner deploys

Nothing above is live yet. The live site still runs the 6 November code and data.

- After `npm run deploy`: all the refresher, API, corrections, admin, page and security fixes. The Worker creates
  the new `correction_clients` table itself if the database doesn't have it yet.
- After `npm run db:remote`: the restored grant, the de-duplicated calls, the record dates, the new name table for
  spotting mentions (with the plain-name aliases), the headline-only flags for ACE, Sentient Media and Faunalytics,
  and the new indexes.

Do both, in the order under "Deploy". Either step alone is safe: the new code works with the old database and the
old code with the new one, but you get every fix only after both.

## What the audit left open

- Many senders at once can still close the corrections form. One address can send at most 5 a day, but 6 addresses
  can fill the hourly cap and 40 the daily one, and then the form refuses everyone (429) until the window passes.
  Nothing alerts you. If people say the form refuses them, look at `GET /api/admin/corrections` and reject or delete
  the spam: that reopens the form at once. Turnstile (a bot check) on the form would stop this. It needs a site key
  and a secret from your Cloudflare account.
- The `CORRECTIONS_LIMITER` rate-limit binding. The code uses it if it exists, but none is configured. I couldn't
  confirm that the binding is available on the Free plan, and a binding the account can't have would make the deploy
  fail. Its period can only be 10 or 60 seconds, so even its strictest setting (1 a minute per address) allows more
  than the 5 a day the code already allows. It would only take load off the database when one address floods the
  form. To add it, put this in `wrangler.jsonc` and deploy:

  ```jsonc
  "ratelimits": [{ "name": "CORRECTIONS_LIMITER", "namespace_id": "2026111201", "simple": { "limit": 1, "period": 60 } }]
  ```

- A one-step reseed. `db:remote` is still two steps (schema, then data). The 503 above covers the gap between them,
  once the new Worker is deployed.
- A status column for refresh runs. I used the existing columns instead, so the new code doesn't depend on a
  reseed. A crashed run shows as finished with errors. A killed run shows as "did not finish".
- Large feeds are cut at 400 KB, not refused. Five real feeds are larger today (Animal Justice, FarmKind, Hive, Our Hen
  House, Edgars Mission), and refusing them would stop their updates.
- Feed posts are never deleted. They grow by a few thousand a year, and the new index keeps reads small.
- Old feed posts from ACE, Sentient Media and Faunalytics still hold their text in the database. It isn't published,
  but the admin items list shows it.

## Questions for the owner

From `docs/scope-v1.md` (still open, and yours to decide):

1. Who is the first user, and which recurring question should v1 answer first?
2. Keep, restrict or remove direct-action / abolitionist entries after review?
3. Which existing directories can we reuse with permission?
4. Which Hive channels, if any, may be processed, and shown to which audiences?
5. Who maintains corrections and access rules, and how quickly?
6. Is the next section by species (e.g. insects, chickens) or by geography (e.g. India, Brazil)?

New from this audit:

7. Should the corrections form get Turnstile, and are 5 a day per address, 30 an hour and 200 a day overall the
   right caps?
8. Should "stale" (shown after 180 days) mean "nobody has re-checked the research", or "the homepage stopped
   answering"? Today a homepage that answers keeps the profile fresh.
9. Is the headline-only list right? It covers ACE, Sentient Media and Faunalytics. The source inventory also lists
   Tiny Beam Fund and Ambitious Impact as restricted, but neither has a feed today.

## Where things are

- `src/index.js`: the Worker (pages, `/api/*`, cron entry).
- `src/refresh.js`: the hourly refresher.
- `src/lib/`: feed parsing and mention matching, capped body reading, call states, refresher health, and the address
  prefix the corrections form counts.
- `scripts/build-seed.mjs` and `scripts/lib/seed.mjs`: the data build. `scripts/build-static.mjs` bundles `public/`.
- `db/schema.sql`, `db/seed.sql`: database schema and generated data.
- `data/research/`: researched entries and records. `SCHEMA.md` is the format, including `same_as`, `accessed`
  and headline-only feeds.
- `data/curated/overrides.json`: reviewed fixes, applied last.
- `data/seed/build-report.md`: what the last build merged, created and warned about.
- `public/`: the page (`app.js`, `styles.css`, built-in `snapshot.json`).
- `test/`: feeds, build, refresher, Worker routes, Movement Match contract. `test/helpers/d1.js` stands in for D1.
- `docs/update-workflow.md`: the maintainer routine and admin endpoints.
- `docs/scope-v1.md`, `docs/source-inventory.md`, `docs/hive-access.md`: scope, sources and reuse terms, Hive.
