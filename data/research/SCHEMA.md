# Research output schema (v1)

All research files are JSON arrays. Use ONLY facts you verified on a fetched page during research.
Every entity and event must carry at least one source URL you actually fetched. If unsure, put it in `notes`
and set status "uncertain" rather than guessing. Never invent grant amounts, dates or URLs.
Today is 2026-11-05 — use that as `accessed` / `last_checked`.

## Entity (organisation / programme / funder / resource / network / banner)
{
  "id": "kebab-case-slug",
  "name": "Official name",
  "aliases": ["Abbreviations", "former names", "local-language names"],
  "kind": "organisation | programme | funder | resource | network | banner",
        // banner = a leaderless name/umbrella used by unaffiliated individuals (e.g. ALF), not a formal org
  "parent_id": "slug of parent org if this is a programme of another entity, else null",
  "categories": [ one or more of:
      "advocacy-campaigns", "welfare-science", "welfare-technology", "policy-law", "funding",
      "incubation-careers", "movement-infrastructure", "community-media", "direct-action", "sanctuary-rescue",
      "alt-protein" ],
  "species": [ any of: "farmed-fish", "wild-fish", "crustaceans", "cephalopods", "chickens", "pigs", "cows",
      "farmed-animals", "wild-animals", "insects", "companion-animals", "animals-in-research", "fur-animals", "all-animals" ],
  "regions": [ any of: "global", "europe", "uk", "north-america", "latin-america", "asia", "south-asia",
      "southeast-asia", "east-asia", "africa", "middle-east", "oceania" ],
  "countries": ["ISO-3166 alpha-2 codes where they operate, if known"],
  "interventions": [ any of: "corporate-campaigns", "legislation-policy", "litigation", "research",
      "humane-slaughter", "farm-practices", "producer-engagement", "certification-standards", "alt-proteins",
      "public-awareness", "diet-change", "protest", "open-rescue", "direct-action", "investigations",
      "capacity-building", "grantmaking", "careers-talent", "data-tools", "education", "sanctuary" ],
  "approach": "welfare-reform | abolitionist | mixed | research | neutral-infrastructure | unclear",
  "summary": "<= 300 chars. Neutral, factual, present tense: what they do and for whom. No praise, no evaluation.",
  "website": "https://... (homepage)",
  "hq": "country name or null",
  "founded": "YYYY or null",
  "status": "active | inactive | unclear",
  "feeds": [{ "url": "https://.../feed", "type": "rss | atom", "verified": true }],
        // only list feeds you fetched and that returned valid RSS/Atom XML with items
  "sources": [{ "url": "...", "title": "...", "accessed": "2026-11-05", "published": "YYYY-MM-DD or null" }],
  "notes": "uncertainties, naming conflicts, things to check, or null"
}

## Event (grant, open call, announcement, report, etc.)
{
  "id": "kebab-case-slug",
  "entity_ids": ["slugs of entities this concerns"],
  "type": "grant_awarded | open_call | announcement | plan_announced | project_active | report_published | campaign_outcome | legal_development",
  "title": "short",
  "summary": "<= 300 chars, neutral",
  "event_date": "YYYY-MM-DD or YYYY-MM or YYYY (date the thing happened / was awarded)",
  "source_published": "YYYY-MM-DD or null (date the source page was published)",
  "source_url": "...",
  "source_title": "...",
  "amount": number or null,
  "currency": "USD | GBP | EUR | ... or null",
  "funder_id": "slug or null",
  "recipient_id": "slug or null",
  "deadline": "YYYY-MM-DD or null (open calls only)",
  "status": "confirmed | reported | uncertain",
  "notes": null
}
