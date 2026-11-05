# v1 scope proposal: bounded sample section

**Status:** proposal for discussion · Nov 2026

## Recommendation

Make the first in-depth section **fish and other aquatic animals** (farmed fish, wild-caught fish, shrimp and other
crustaceans, octopus and other cephalopods). Alongside it, keep a **lighter movement-wide frame** covering every functional
category, so the product still reads as a map of the whole movement and not a niche directory.

Why aquatic animals:

- **Numbers vs. attention.** Aquatic animals are the largest group of farmed and caught vertebrates (plus crustaceans),
  yet the organisations working on them are few and fairly recent. A map is most useful where people don't already
  know who everyone is.
- **Bounded but not trivial.** Roughly 30–50 dedicated organisations, programmes and resources. That is enough to test entity
  reconciliation (programmes inside larger NGOs, renamed orgs, local-language names) without being overwhelming.
- **A good test of freshness.** There are fast-moving legal developments (octopus farming bans, crustacean sentience
  laws), active grantmaking (Coefficient Giving, the EA Animal Welfare Fund, ACE Movement Grants) and corporate campaigns, so
  "what changed recently" has real content.
- **It matches the brief's example question:** "who is working on fish welfare in a particular region, what they
  are doing, and which recent public grants or announcements support that picture."

## What v1 contains

| Layer | Contents | Depth |
|---|---|---|
| Aquatic deep-dive | Orgs, programmes, funders, resources, with species/region/intervention tags | Every entity researched and source-linked |
| Movement frame | ~50 anchor entities across all 11 categories, incl. direct-action / abolitionist groups | Short profile + website |
| Funding | Disclosed grants awarded (aquatic-heavy) and open calls, stored separately | Each record source-linked |
| Changes | Curated records + auto-detected items from public RSS feeds | Feeds checked daily |

### Direct-action and abolitionist groups

Following the 2026 conversation with Aaron, v1 **includes** groups such as the Animal Liberation Front (as a leaderless
banner, not an organisation), DxE and Animal Rising, so we can see how including them works before deciding.
Safeguards in v1:

- Profiles are encyclopedic: public stance, documented public activities, notable legal designations. They contain no
  tactics, no operational links and no named individuals.
- A distinct, hatched "inclusion under review" territory plus a note on every profile: listing ≠ endorsement or association.
- One click hides the whole category (and the choice is remembered per viewer).
- The decision to keep, restrict or remove them is an open question below, to revisit after people have looked at v1.

## Out of scope for v1

- **Individuals.** No person profiles. Only organisations' own public contact pages are linked. The brief allows
  "professional contacts where appropriate"; this needs a policy before adding any.
- **Slack / Hive content.** Not ingested at all until access and reuse permission are settled (see `hive-access.md`).
- **Causal modelling or influence claims.** These belong to the separate systems-and-leverage project.
- **Effectiveness judgements.** The map describes activity; it doesn't rank anyone.

## How we'll know it's useful

Test with 3–5 real users on real questions, e.g. "who works on shrimp welfare in Southeast Asia?". Measure:

- **Did they find a collaborator, avoid duplicated work, or make a better-informed decision?** (the primary outcome)
- **Factual accuracy**: spot-check 20 random claims per month against their sources.
- **Freshness**: median days since `last_checked`; share of profiles marked stale.
- **Coverage gaps**: entities users expected but couldn't find (logged via "missing organisation" corrections).
- **Correction burden**: corrections received per month and maintainer minutes per correction.

The number of profiles is deliberately not a success metric.

## Open questions

1. Who is the first user, and which recurring question should v1 answer first?
2. Keep, restrict or remove direct-action / abolitionist entries after review?
3. Which existing directories can we reuse with permission? (see `source-inventory.md`)
4. Which Hive channels, if any, may be processed, and shown to which audiences?
5. Who maintains corrections and access rules, and how quickly?
6. Is the next section by species (e.g. insects, chickens) or by geography (e.g. India, Brazil)?
