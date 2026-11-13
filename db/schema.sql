-- Animal Movement Map — D1 schema
-- Design rules (from the project brief):
--  * keep source publication date, last-checked date and the date of the underlying event separate
--  * preserve conflicting reports instead of overwriting them
--  * distinguish grants awarded from open calls, announced plans from active projects
--  * every claim is source-linked; corrections are queued for human review
--
-- `npm run db:remote` runs this file and then db/seed.sql. Tables rebuilt from the research files are
-- dropped and recreated. Tables that hold what the live site has gathered (corrections, feed items and the
-- refresh-run log) are created only if missing, so a reseed never loses them. Every index on those tables is
-- IF NOT EXISTS too, so this file can run again on a database that already has them.

DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS aliases;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS event_entities;
DROP TABLE IF EXISTS sources;

-- corrections are user-submitted: never dropped by a re-seed
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT,
  event_id TEXT,
  kind TEXT NOT NULL DEFAULT 'correction',   -- correction | missing-entity | removal-request | access-concern
  field TEXT,
  proposed_value TEXT,
  evidence_url TEXT,
  note TEXT,
  contact TEXT,                               -- optional, only shown to maintainers
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | rejected | needs-info
  reviewer_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
-- The corrections form counts the corrections of the last hour and day that are not rejected.
CREATE INDEX IF NOT EXISTS idx_corrections_recent ON corrections(created_at, status);

-- Who sent each recent correction, for the per-address cap: an HMAC of the address (an IPv6 address cut to
-- its /64), never the address. Rows older than two days are deleted. The Worker also creates this table if a
-- database that has not been reseeded lacks it.
CREATE TABLE IF NOT EXISTS correction_clients (
  correction_id INTEGER PRIMARY KEY,
  client TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_correction_clients ON correction_clients(client, created_at);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- organisation | programme | funder | resource | network | banner
  parent_id TEXT,
  primary_category TEXT NOT NULL,
  section TEXT NOT NULL,       -- which v1 research slice produced it: aquatic | movement | funding
  status TEXT NOT NULL,        -- active | inactive | unclear
  profile TEXT NOT NULL,       -- full JSON profile (tags, summary, sources, notes)
  stub INTEGER NOT NULL DEFAULT 0, -- 1 = referenced by a record but profile not yet researched
  last_checked TEXT,           -- when a person or the refresher last verified the profile
  updated_at TEXT NOT NULL
);

-- Names used to spot mentions of an entity in feed posts (src/lib/feeds.js detectMentions).
CREATE TABLE aliases (
  alias_norm TEXT NOT NULL,    -- the name in mentionForm(): lower case, punctuation removed, leading "the" dropped
  alias TEXT NOT NULL,         -- the name as written (one-word names match only with these capitals)
  entity_id TEXT NOT NULL,
  PRIMARY KEY (alias_norm, entity_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- grant_awarded | open_call | announcement | plan_announced | project_active
                               -- report_published | campaign_outcome | legal_development
  title TEXT NOT NULL,
  summary TEXT,
  event_date TEXT,             -- when the thing happened (award date, launch date, ruling date)
  source_published TEXT,       -- when the source page was published
  last_checked TEXT,           -- when we last confirmed the source still says this
  source_url TEXT,
  source_title TEXT,
  amount REAL,
  currency TEXT,
  funder_id TEXT,
  recipient_id TEXT,
  deadline TEXT,
  call_state TEXT,             -- reviewed override: open | closed | forthcoming | rolling-or-unstated (else derived from deadline)
  status TEXT NOT NULL,        -- confirmed | reported | uncertain | disputed | superseded
  conflicts_with TEXT,         -- JSON array of event ids that report something different
  origin TEXT NOT NULL,        -- curated | feed
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE event_entities (
  event_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (event_id, entity_id)
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,          -- feed | homepage
  cadence TEXT NOT NULL,       -- daily | weekly | monthly
  visibility TEXT NOT NULL DEFAULT 'public',  -- public | restricted (restricted sources are never shown publicly)
  reuse TEXT NOT NULL DEFAULT 'full',          -- full | headline (publisher allows only headline + link: no excerpts)
  last_checked TEXT,
  last_success TEXT,
  last_status INTEGER,
  etag TEXT,
  last_modified TEXT,
  error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

-- Kept across reseeds: items that have dropped off a feed cannot be fetched again.
CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,         -- hash of source + guid/link
  source_id TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  link TEXT,
  published TEXT,              -- date the feed says the item was published
  first_seen TEXT NOT NULL,    -- when our refresher first saw it
  excerpt TEXT,
  signal TEXT,                 -- heuristic: funding | open_call | report | campaign_outcome | legal | launch | null
  species TEXT,                -- JSON array of species tags detected in the text
  mentions TEXT,               -- JSON array of other entity ids named in the text
  meaningful INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0  -- set by POST /api/admin/items/reviewed
);

CREATE INDEX IF NOT EXISTS idx_feed_items_seen ON feed_items(first_seen);
CREATE INDEX IF NOT EXISTS idx_feed_items_entity ON feed_items(entity_id);
-- /api/snapshot filters and sorts on this expression; without the index every rebuild scans feed_items.
CREATE INDEX IF NOT EXISTS idx_feed_items_when ON feed_items(COALESCE(published, first_seen));

-- Kept across reseeds, so the site's "last refresh" survives one.
CREATE TABLE IF NOT EXISTS refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,            -- NULL while running; stays NULL if the invocation was killed
  trigger TEXT,
  sources_checked INTEGER DEFAULT 0,
  new_items INTEGER DEFAULT 0,
  meaningful_items INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0
);
