# Hive Slack access: separate investigation

**Status:** not started; no access requested, no connection made, nothing ingested.

The brief lists "appropriately authorised Hive Slack channels" as a candidate source, but neither access nor reuse
permission has been established. Membership of a Slack workspace, or the technical ability to read it, **does not**
authorise public aggregation, redistribution or profiling. This document lists what has to be settled before any
Slack-derived information touches the map. Public facts about Hive are in `source-inventory.md`.

## Questions to put to Hive

1. **Permission.** Does Hive permit automated reading of any channels? Which ones, and under what terms?
2. **Audience.** Is derived information allowed on a public map, a members-only view, or only in a private
   maintainer feed used as a lead to then confirm from public sources?
3. **Consent of posters.** Do community guidelines cover reuse of posts? Would posters need to opt in (e.g. a
   dedicated `#map-updates` channel where posting = consent to publication)?
4. **What may be extracted.** Organisation-level facts only (launches, hiring, grants, reports)? Or also people's
   roles? We propose organisation-level only.
5. **Retention.** How long can raw messages be held? We propose: never store raw message text; keep only the
   extracted organisation-level claim, a channel name and a date.
6. **Corrections and takedown.** Who can ask for removal, and how fast must we act?

## Proposed technical approach, if and when permitted

- A **separate source class** `visibility = 'restricted'` already exists in the schema (`sources.visibility`).
  Restricted sources are excluded from `/api/snapshot` by every query; they can only feed a maintainer review queue.
- The **least-risk pattern** is "Slack as a lead, public source as evidence". A Slack mention prompts a maintainer
  to find a public confirmation (a blog post or grant record), and only that public record appears on the map.
- If Hive agrees to direct publication from an opt-in channel, use a Slack app with `channels:history` on that
  channel only. It would be installed by a Hive admin, never as a user token.
- Every derived claim keeps its source restriction: `{source: 'hive', channel, audience}`, and it is filtered by audience at
  render time.

## Alternative: Notion destination

If the team wants Notion as the editing surface, evaluate Notion's Worker database sync. It creates and manages a
**separate synced database**; it doesn't sync into an existing editable database and isn't two-way. That suggests
keeping this D1 store as the system of record and treating Notion as a read-only mirror. This has not been enabled.

## Decision needed before any of the above

A named person at Hive who can grant permission, and a named maintainer on our side accountable for access rules.
