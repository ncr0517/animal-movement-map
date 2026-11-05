# Source inventory: funding, directories and news feeds

Research date: 2026-11-05. All requests were made server-side from a cloud container (curl via an egress proxy, with no browser and no spoofed user-agent). "Works" means it worked from that server. A source that works from a browser can still fail from a server, and that is noted where it happened.

Companion data: `data/research/funding-events.json` (40 `grant_awarded` + 14 `open_call` events).

---

## 1. Endpoint tests (live, 2026-11-05)

| Endpoint | Result from server | Format | Key needed? | Notes |
|---|---|---|---|---|
| `https://funds.effectivealtruism.org/api/grants` | **Works** (200) | `text/csv`: id, fund, description, grantee, amount, round, year, highlighted | No | 1,695 grants 2017–2026 across all EA Funds (395 Animal Welfare Fund). The page labels it "Download grants database CSV". The same data is also embedded as JSON in `__NEXT_DATA__` on `/grants`. robots.txt allows everything. |
| `https://projects.propublica.org/nonprofits/api/v2/search.json?q=…` and `/organizations/{EIN}.json` | **Works** (200) | JSON | No | Tested: "aquatic life institute" gives EIN 87-3020380 (NY, NTEE D30). EIN 99-4093462 gives Hive Community Inc (ruling 2024-12, no 990 data yet). The docs say use "constitutes agreement to our Data Terms of Use". robots.txt disallows the HTML `/nonprofits/search*` pages but not `/nonprofits/api/`. |
| `https://api.threesixtygiving.org/api/v1/org/{org-id}/grants_received/` (360Giving Datastore API) | **Works** (200) | JSON, paginated, each grant carries its `data_license` | No | Tested GB-CHC-1215720 (Crustacean Compassion: 2 grants) and GB-CHC-1095050 (CIWF International: 5 grants). Also `/org/{id}/` and `/grants_made/`. Queries are by org ID only (no keyword search). |
| `https://grantnav.threesixtygiving.org/search(.json/.csv)?query=…` | **Blocked** (503 "Verifying your browser") | n/a | n/a | robots.txt disallows `/search`, `/recipients` and `/funders` for all agents. Individual `/grant/{id}` pages return 200. Keyword search would have to be done by hand in a browser, or by downloading the publishers' raw files. |
| `https://coefficientgiving.org/*` (grants, `/funds/`, robots.txt, `/feed/`, `/wp-json/`) | **Blocked** (403, Cloudflare) | n/a | n/a | Blocked for both curl and the WebFetch tool. Old `openphilanthropy.org/grants/...` URLs 301-redirect to `coefficientgiving.org/funds/`. No Wayback snapshot of `/grants/` is listed, and `web.archive.org` is unreachable from this server. |
| `https://www.longtermwiki.com/grants` (third-party mirror of the CG grants database) | **Works** (200, 4.6 MB HTML with embedded JSON records) | HTML + embedded JSON | No | 5,876 grants; 2,626 of them Coefficient Giving. Per-record pages at `/things/{id}` are allowed. robots.txt **disallows `/organizations/*/grants/`**. The site banner says it "has not been actively maintained since May 2026". Atom feed: `/feed.xml`. |
| `https://gtr.ukri.org/gtr/api/projects?q=…` (Accept: `application/vnd.rcuk.gtr.json-v7`) and `https://gtr.ukri.org/api/search/project?term=…` | **Works** (200) | JSON | No | Response header reported `lastRefreshDate: 06 Jul 2026` (about 4 months stale). **robots.txt is `Disallow: /`**: use only the documented API (`/resources/api.html`), at low volume. |
| `POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=…` (EU Funding & Tenders) | **Works** (200, POST with multipart `query` JSON) | JSON | Public key `SEDIA` | A GET returns 405. Status codes: 31094501 = forthcoming, 31094502 = open. Topic detail JSON is at `ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/{topic}.json`. |
| `https://api.charitycommission.gov.uk/register/api/...` | 401 | JSON error | **Yes** (subscription key) | "Access denied due to missing subscription key". |
| `https://api.globalgiving.org/api/public/projectservice/...` | 400 without key | XML | **Yes** (`api_key`) | The API page links to a Code of Conduct and Terms of Service. |
| `https://api.charitynavigator.org/graphql` | not called | GraphQL | **Yes** (the developer site has a pricing page) | Covers about 2.4M US nonprofit profiles. |
| `https://en.wikipedia.org/w/api.php?...` | Works, but **rate-limited** ("too many requests") after a few calls | JSON | No | Wikimedia asks clients to send a descriptive User-Agent with contact details and to follow its rate-limit guidance. Text is CC BY-SA. |
| `https://forum.effectivealtruism.org/*` (posts, `feed.xml`) | **429** | n/a | n/a | Rate-limited for server requests, so EA Forum funding announcements (BluePerch, the Movement Infrastructure Lab RFP, documentary fund) could not be verified at source. |

RSS/Atom feeds were verified separately (section 6).

---

## 2. Grant databases (awarded grants)

### 2.1 EA Funds: Animal Welfare Fund (AWF)
- **URL:** https://funds.effectivealtruism.org/grants (CSV: `/api/grants`); fund page https://funds.effectivealtruism.org/funds/animal-welfare
- **Contains:** every EA Funds grant 2017–2026 with grantee, short description, amount and quarter ("2026 Q2"). The AWF 3-year strategy explicitly includes "Aquatic animal welfare" and "Humane slaughter as the default" for shrimp.
- **Machine-readable:** CSV export (no key) and embedded JSON. A sitemap is at `/sitemap.xml`.
- **Cadence observed:** the latest round in the CSV is 2026 Q2, so the CSV lags payouts by about 1–2 quarters.
- **Terms/robots:** robots.txt `Disallow:` (empty, so everything is allowed). The T&Cs reviewed cover user content (CC BY-NC for submitted content) and contain no scraping prohibition. No licence is stated for the grants data, so attribute it and link back.
- **Caveats:** dates are quarters only, and currency is not stated per record (the site presents amounts in US$). Some grantees are anonymised as "(Anonymous)".
- **Suggested refresh:** **weekly** (cheap: one CSV). Diff on `id`.

### 2.2 Coefficient Giving (formerly Open Philanthropy)
- **Rename verified:** Wikipedia (https://en.wikipedia.org/wiki/Coefficient_Giving) says "In November 2025, Open Philanthropy was renamed Coefficient Giving". The grant texts mirrored on LongtermWiki still say "Open Philanthropy recommended a grant of…".
- **URL:** https://coefficientgiving.org/funds/ (the old `openphilanthropy.org/grants/` redirects here).
- **Machine-readable:** none reachable. Every path tested returns Cloudflare 403 to server requests, including robots.txt and the feeds.
- **Workaround used:** LongtermWiki's mirror (https://www.longtermwiki.com/grants, per-record `/things/{id}`). It has amount, currency, month, and the original grant text in `notes`. The 17 CG records in our JSON are marked `status: "reported"` for this reason.
- **Red flags:** (a) the primary source can't be fetched by an automated pipeline at all; (b) the mirror is unmaintained since May 2026 (records synced around March 2026), and its robots.txt disallows `/organizations/*/grants/`; (c) both licence and ToS for the CG data are unknown.
- **Suggested refresh:** **monthly**, done by hand in a browser (or ask CG for a data export). Don't build automation against the mirror beyond a one-off seed.

### 2.3 Animal Charity Evaluators: Movement Grants
- **URLs:** past recipients https://animalcharityevaluators.org/movement-grants/past-movement-grants-recipients/; apply page `/movement-grants/apply-for-funding/`; round announcements on the blog (e.g. `/blog/announcing-round-11-movement-grants/`, published 2026-09-29).
- **Contains:** every round since 2019 with recipient and amount (USD); the announcement posts add per-grant descriptions. The impact panel says "$8.6M… 292 grants… 58 countries".
- **Machine-readable:** HTML only, plus a WordPress RSS feed at `/feed/` (verified) and a Yoast sitemap index. The server answers some non-browser requests with **HTTP 406** but still returns the body.
- **Cadence:** about 2–3 rounds a year (round 10 in Feb–Mar 2026, round 11 in June 2026, round 12 call closed 2026-10-18).
- **Terms:** robots.txt allows everything except export and admin paths. **But the Terms of Use say Content is "for your information and personal use only and may not be used, copied, reproduced, distributed… without the prior written consent of Animal Charity Evaluators."** That is fine for facts (who got how much), but don't copy descriptions or reviews verbatim without permission.
- **Suggested refresh:** **weekly** via the RSS feed; re-scrape the past-recipients page **monthly**.

### 2.4 360Giving (UK open grants data): GrantNav and Datastore API
- **URLs:** https://grantnav.threesixtygiving.org/ (browser UI); API `https://api.threesixtygiving.org/api/v1/org/{org-id}/…`
- **Fish and aquatic grants found:** Crustacean Compassion (GB-CHC-1215720) got **£20,000 from The National Lottery Community Fund** (Awards for All England, "Crustacean Compassion's Decade of Decapods", awarded 2026-01-22) and **£17,500 unrestricted from ShareGift** (2026-08-20). CIWF International (GB-CHC-1095050) got £16,000 from Pears Foundation in both 2024 and 2025, plus £60,000 from ShareGift in 2026. These are not aquatic-specific, so they were left out of the JSON. Keyword search for "fish welfare" etc. could not be run, because GrantNav search is bot-gated and disallowed by robots.txt.
- **Licence:** per publisher, and included in every record (`data_license`). NLCF publishes under **OGL v3.0**, ShareGift under **CC BY 4.0**. Both allow reuse with attribution.
- **Cadence observed:** the NLCF record was modified 2026-02-18 for a 2026-01-22 award (about 4 weeks' lag).
- **Suggested refresh:** **monthly**, polling `grants_received` for a maintained list of UK aquatic/animal charity org-IDs (Crustacean Compassion, CIWF, Humane Slaughter Association, Science for Animal Welfare, Animal Equality UK, etc.). Org IDs are `GB-CHC-{charity no.}` or `GB-COH-{company no.}`.

### 2.5 UKRI Gateway to Research (public research grants)
- **URL:** https://gtr.ukri.org/ (API docs `/resources/api.html`).
- **Found:** BBSRC BB/Z515255/1, "On-demand, electric-powered aeration for improved fish welfare in salmon aquaculture" (University of Stirling, £256,879, started 2024-07). Also BBSRC studentships on decapod loss of consciousness and humane slaughter, and on fish-welfare video prediction (studentships are listed at £0), and Innovate UK 10147468 (fish-welfare monitoring feasibility, £99,821).
- **Machine-readable:** JSON API, no key. GtR gives fund start dates, not award dates.
- **Red flag:** robots.txt `Disallow: /`, and the data was last refreshed 06 Jul 2026.
- **Suggested refresh:** **monthly**, a handful of keyword queries.

### 2.6 Tiny Beam Fund
- **URL:** https://tinybeamfund.org/ (Grant-Recipients, 2023-FAI-Grantees, Grants-Program, Fellowship-Awards).
- **Contains:** recipient names and project descriptions (e.g. Aquatic Life Institute 2023, and NYU/Becca Franks on species-specific fish welfare), but **no amounts**. The ranges are published: FAI grants $6,000–$24,000; fellowships US$60k/45k.
- **Machine-readable:** HTML plus `sitemap.xml`; robots.txt allows everything.
- **Terms:** the ToU forbid "reusing, and storing of any Content for other than personal use… without specific written prior permission". Store facts and links only.
- **Suggested refresh:** **monthly**.

### 2.7 Other funders checked
- **Builders Initiative** (`buildersinitiative.org`): **unreachable** from the server (connection reset / 503 via WebFetch). Note that `builders.org` is an unrelated home-builders association. Retry in a browser.
- **Farmed Animal Funders** (`farmedanimalfunders.org`): **unreachable** (connection reset; `www.` returns 404). Membership network; check by hand.
- **Open Wing Alliance / The Humane League:** `openwingalliance.org` returns 200, but no grant amounts were extracted. CG's 2025 $10M THL grant "includes support for the Open Wing Alliance". OWA is chicken-focused, so it is low priority for v1.
- **Mercy For Animals:** RSS works (section 6). No grants database was found.

---

## 3. Open-call sources (for `open_call` events)

| Source | What | Access | Suggested refresh |
|---|---|---|---|
| EA AWF https://funds.effectivealtruism.org/apply-for-funding | "Always open to applications", $1,000–$500,000 | HTML | monthly (state rarely changes) |
| ACE Movement Grants https://animalcharityevaluators.org/movement-grants/apply-for-funding/ | Round 12 closed 2026-10-18; round 12 listed aquatic animals as a priority group | HTML + RSS `/feed/` | weekly via RSS |
| Fish Welfare Initiative https://www.fishwelfareinitiative.org/post/rfp-india | **Open until 2026-11-18**: India farmed-fish ideas, up to INR 50 lakh | RSS `blog-feed.xml` | weekly |
| Science for Animal Welfare (formerly UFAW) https://scienceforanimalwelfare.org/award/centenary-research-award/ | **£250k Centenary Research Award; concept notes due 2026-12-31** | HTML (also `/for-scientists/grants-and-awards/`) | monthly |
| Strategic Animal Funding Circle https://www.animalfundingcircle.com/ | Twice-yearly rounds; latest closed 2026-11-01 | HTML | monthly |
| Tiny Beam Fund `Grants-Program`, `Fellowship-Awards` | Annual windows (June; Mar–Apr) | HTML | monthly |
| Ambitious Impact https://www.ambitiousimpact.com/start-a-charity | Feb 2027 "Transforming factory farming" cohort closed; Aug 2027 cohort is non-animal | HTML. **AIM ToU prohibit "systematic or automated data collection… without our express written consent"** | monthly, by hand |
| Coefficient Giving RFPs | Fish-slaughter RFP (~$7M, closed 2026-07-01); alt-protein R&D (closed 2026-08-10) | **Blocked (403)**; known only via press (WeAreAquaculture) and Hive Highlights | monthly, by hand |
| EU Funding & Tenders | HORIZON-CL6-2027-02-FARM2FORK-06 (forthcoming, deadline 2027-09-23), which mentions aquatic animal welfare | JSON search API (public key `SEDIA`) | monthly |
| UKRI opportunities https://www.ukri.org/opportunity/feed/ | RSS works (20 items); none animal-welfare relevant on 2026-11-05 | RSS | weekly |
| Hive Highlights (fortnightly), https://joinhive.substack.com/feed | Best single aggregator of movement funding calls (FWI, SAW, BluePerch, Movement Infrastructure Lab, etc.) | RSS (full content) | weekly |

---

## 4. Directories that might be reused (with permission)

| Directory | URL | Contents | Access | Terms / reuse notes |
|---|---|---|---|---|
| ACE charity reviews | `animalcharityevaluators.org/charity-review/{slug}/`; `review-sitemap.xml` | Reviews of evaluated charities | HTML + sitemap (some requests get 406) | ToU say personal use only; reproduction needs written consent. **Ask permission.** |
| ACE master farmed-animal charity list (2023, public copy) | Google Sheet `1z9UiJW8hBQgsTOsQ1uw6OQdRxjXBIn2aMmOxidbZ3CA` ("Public copy: ACE's master animal charity list (2023)") | Longlist of farmed-animal advocacy orgs worldwide plus per-country counts; collated partly from the World Federation for Animals Directory | **CSV export works** (`/export?format=csv`, first tab = context; other tabs hold the list) | ACE says it shared the list "in case of use to others in the movement" and that it "is not exhaustive". No licence is stated, and it dates from 2023. Best seed candidate; **ask ACE before republishing.** |
| EAA community directory (old link) | Google Sheet `1fxYa2Oae0yOG6mtxW-whLMyFMpbhoYbfgyi_miuTUp0` | Now just a pointer to `bit.ly/eaadirectory_public` | CSV | Follow the new link by hand. |
| Hive Resources | https://resources.joinhive.org/ (library incl. `/library/fundraising`, "database of current opportunities") | Guides, fundraising database, community guidelines | HTML (Next.js); robots.txt allows everything except `/api` and `/_next` | No licence seen. Ask Hive, especially about the fundraising database. |
| Animal Advocacy Careers | https://animaladvocacycareers.org/job-board/ | Job board (shows which orgs are hiring), career guides | **Job RSS works:** `https://animaladvocacycareers.org/?feed=job_feed` (10 items); blog RSS `/feed/` | No public organisation directory found (`/organisations/` returns 404). Useful as a liveness signal for orgs. |
| Animal Ask Country Priorities Map | https://www.animalask.org/country-priority-map | Map of Animal Ask's country prioritisation research | HTML (Wix) | Research product; link to it, don't copy. |
| World Animal Net directory | `worldanimal.net` | Reportedly 17,000+ animal protection orgs (claim from search results, not verified) | Root unreachable (connection reset); `/27-about-us` returns 403 | Check by hand; likely needs a licence. |
| Wikipedia categories | e.g. `Category:Animal_welfare_organizations` | Org articles | MediaWiki API (JSON) | CC BY-SA, so attribution and share-alike apply to any text reused. Send a descriptive User-Agent; rate limits were hit. |
| "Animal Advocacy Map" / existing movement maps | none found | Searches found no maintained interactive map of farmed-animal advocacy orgs. Aussie Farms' farm-location map (2019) was controversial for targeting farmers, which is a reputational caution for any map that shows farms. | n/a | n/a |

### Registry data (enrichment, not discovery)
- **US IRS / ProPublica Nonprofit Explorer:** works with no key (see section 1). Good for EIN, NTEE code, revenue and 990 links. Refresh **quarterly**.
- **UK Charity Commission API:** needs a subscription key (401). The public register HTML is reachable at `register-of-charities.charitycommission.gov.uk`. Refresh **quarterly**.
- **Charity Navigator:** GraphQL, key/pricing. **GuideStar/Candid:** `guidestar.org` returns 200; `candid.org` is unreachable from this server; Candid APIs are paid. Low priority.
- **GlobalGiving:** API needs a key. Project pages are reachable. Not searched for aquatic projects (no key). Refresh **monthly** if a key is obtained.

---

## 5. Hive's Slack (public information only; we did not join or access it)

- **Who runs it:** Hive, operated by **Hive Community Inc**, a US 501(c)(3) (EIN 99-4093462 per its footer; ProPublica shows a 2024-12 ruling date). Hive was **formerly Impactful Animal Advocacy (IAA)** and announced the rebrand on 2024-05-07 (https://joinhive.substack.com/p/introducing-hive-a-rebrand-for-impactful). The Our People page lists a Co-founder & Executive Director (Sofia, also board treasurer, i.e. Sofia Balderson) and a Managing Director (Kevin). The board president, Cameron King, "started the Hive Slack space". Workspace: `join-hive.slack.com`.
- **Scale (self-reported, https://www.joinhive.org/hive-slack):** 5,000+ members, 700+ average weekly active, 100,000+ messages in 2024, 100+ public channels, including `c-` cause channels such as aquatic animals. Automated feed bots post jobs, EA Forum posts, events (with Connect for Animals) and research (with Faunalytics).
- **Membership basis:** open sign-up through a Tally form (`tally.so/r/wkGKer`). The guidelines say the community "is for everyone interested in farmed animal advocacy… We welcome anyone who has a sincere desire to be more effective in helping non-human animals". There is no stated vetting beyond the form.
- **Published guidelines** (https://resources.joinhive.org/community-guidelines and `/slack-code-of-conduct`): stay on topic (farmed animal advocacy), no donation solicitation, no automated mass messaging ("immediate deactivation"), cite sources, warn before graphic content. **Data-relevant rules:** members must not "Export or use Hive's member data outside of Hive" or "Add or subscribe community members to newsletters, mailing lists… without their explicit consent". No explicit rule about screenshots or recording conversations was found in the public pages. There is a separate Privacy Policy (`joinhive.org/privacy`, not reviewed).
- **Implication for the map:** treat Slack content as off-limits to any automated ingestion. Use Hive's *public* outputs instead: the Hive Highlights RSS (fortnightly, full text) and resources.joinhive.org. Any Slack-derived listing would need Hive's explicit agreement.

---

## 6. News and announcement feeds (all fetched and parsed 2026-11-05)

| Feed | Type | Items | Latest item | Notes / terms | Refresh |
|---|---|---|---|---|---|
| https://sentientmedia.org/feed/ | RSS | 10 | 2026-11-04 | ToU forbid copying/aggregating Content for commercial purposes without written permission. Use headline + link only. A "Republishing Guidelines" page exists, but its body didn't render server-side; check in a browser. | daily |
| https://faunalytics.org/feed/ | RSS | 9 | 2026-11-05 | ToU: no distribution or exploitation of Site Content without prior written permission. Headline + link only. | daily |
| https://joinhive.substack.com/feed | RSS (full text) | 20 | 2026-10-28 | Fortnightly digest; the best source of funding calls | weekly |
| https://animalcharityevaluators.org/feed/ | RSS | 10 | 2026-10-28 | Movement Grants announcements, calls | weekly |
| https://www.fishwelfareinitiative.org/blog-feed.xml | RSS (Wix) | 20 | 2026-11-03 | Org feed (incl. open calls and retractions) | weekly |
| https://www.crustaceancompassion.org/blog-feed.xml | RSS (Wix) | 20 | 2026-09-30 | Org feed | weekly |
| https://animaladvocacycareers.org/feed/ and `/?feed=job_feed` | RSS | 10 + 10 | 2026-10-27 (blog) | Blog and jobs | weekly |
| https://www.mercyforanimals.org/feed/ | RSS | 10 | 2026-11-02 | Org feed | weekly |
| https://www.ukri.org/opportunity/feed/ | RSS | 20 | n/a | Public funding calls | weekly |
| https://www.longtermwiki.com/feed.xml | Atom | 50 | 2026-10-08 | Mirror; unmaintained | skip |
| `https://news.google.com/rss/search?q=%22fish+welfare%22&hl=en-US&gl=US&ceid=US:en` | RSS | 46 | 2026-11-02 | Works with no key. Items link through Google redirect URLs, and the content belongs to the publishers. Google's terms for programmatic use were not reviewed, so use for discovery only. | daily |
| `https://news.google.com/rss/search?q=%22shrimp+welfare%22+OR+%22aquatic+animal+welfare%22&…` | RSS | 39 | 2026-08-08 | Same | daily |

Not available: Aquatic Life Institute (`ali.fish/feed` 404), Shrimp Welfare Project (`/feed`, `/blog-feed.xml` 404), The Humane League (`/feed` 404), Eurogroup for Animals (`/rss.xml` 404), WeAreAquaculture (`/rss` 404), EA Forum (`feed.xml` 429). Those need HTML change-detection or a by-hand check.

---

## 7. Licensing and access red flags (summary)

1. **Coefficient Giving, the largest funder, can't be fetched automatically** (Cloudflare 403). The only machine-readable copy found is an unmaintained third-party mirror whose robots.txt disallows its per-org grant paths. CG records in our data are therefore `reported`, not `confirmed`.
2. **ACE, Sentient Media, Faunalytics, Tiny Beam Fund and Ambitious Impact** all have ToU that restrict reproduction or reuse without written permission. AIM's ToU explicitly ban automated data collection/scraping. Store facts (names, amounts, dates) and links; don't copy text; ask permission for anything more.
3. **GrantNav** search is bot-gated and robots-disallowed. Use the 360Giving Datastore API (open licences: CC BY 4.0 / OGL, attribution required) instead.
4. **UKRI GtR** robots.txt is `Disallow: /`. Use only the documented API at low volume. Data was last refreshed July 2026.
5. **Hive Slack:** the guidelines prohibit exporting or using member data outside Hive. Don't ingest it.
6. **Wikipedia** text is CC BY-SA (share-alike). The API rate-limits clients that don't send a descriptive User-Agent.
7. **Registry APIs** (Charity Commission, Charity Navigator, GlobalGiving) need keys or paid plans. ProPublica needs no key but is governed by its Data Terms of Use.
8. **Unreachable from the server:** buildersinitiative.org, farmedanimalfunders.org, worldanimal.net, candid.org, web.archive.org, and several small org sites (proxy connection resets). Check these by hand before concluding anything.
