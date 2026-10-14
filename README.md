# The List — NYC's pied-à-terre tax roll

**Live: [thelist.traqqit.com](https://thelist.traqqit.com)**

On 24 July 2026 the NYC Department of Finance published the supplemental market value roll for its
new **Non-Primary Residence Property Surcharge** — the "pied-à-terre tax" — as two zip files
totalling about 100 MB and a million rows. **31,541** properties in it meet the published criteria.

This turns that into something you can search: find an address, see which rate band it lands in,
what the surcharge works out to next to the property tax already paid, and the routes out.

> **Being on the roll is not a bill.** DOF's own page says the roll "includes, but is not limited
> to, those properties that may be subject to the surcharge". The surcharge is not owed if the home
> is a primary residence — of the owner, a tenant, an immediate family member, a majority-interest
> holder in an owning entity, or the sole beneficiary of a trust. No public record establishes those
> relationships, so DOF settles it by application. **Deadline: 6 October 2026 (homes, condos and co-ops — DOF extended from the August dates).**

---

## What the roll actually says

| Property type | Count on the roll | Threshold | Surcharge rate |
| --- | --- | --- | --- |
| Condominium | 12,425 | DOF market value ≥ $1M | 4.0% / 5.25% / 6.5% |
| Co-operative | 12,354 | DOF market value ≥ $1M | 4.0% / 5.25% / 6.5% |
| 1–3 family home | 6,762 | DOF market value > $5M | 0.8% / 1.05% / 1.3% |

The $1M line catches **3.6× more properties** than the $5M line. That asymmetry is the story.

Two things about the rate table that are easy to get wrong, and that this tool gets right:

1. **It is a flat percentage of the FULL market value**, not a marginal rate on the amount above a
   threshold. A condo at $2,999,999 pays 4% of the whole value; at $3,000,001 it pays 5.25% of the
   whole value — about **$52,000 more for one dollar of value**. Every property shows how far it is
   from the next band edge and what crossing it would cost.
2. **DOF assesses a co-op as one parcel for the entire building.** A co-op row is a building, not a
   home. The app never presents a building's value as a single apartment's — it shows the parcel
   value, the apartment count and the per-apartment share, and says so in words.

## Run it

```bash
npm install
npm run fetch     # download the DOF roll + PLUTO coordinates (~100 MB, a few minutes)
npm run ingest    # build the app dataset
npm run dev       # http://localhost:5180
```

| Command | What it does |
| --- | --- |
| `npm run fetch` | Download the DOF supplemental roll and join PLUTO coordinates. `-- --refresh` re-downloads. |
| `npm run sales` | Download last-recorded-sale context from NYC Open Data (optional; ingest works without it) |
| `npm run ingest` | Rebuild the app dataset from everything in `data/raw/` |
| `npm run assess` | Download DOF's FY2027 taxable assessed values and co-op apartment counts (optional) |
| `npm run listings` | Index StreetEasy's address→listing crosswalk from `data/latest_listing.csv` (optional) |
| `npm run universe` | Count every class 1 + 2 property in the city, the denominator for the citywide view (optional) |
| `npm run check` | The test suite — 45 checks, no framework |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` on its own (the `.mjs` modules are checked too, via JSDoc) |

## How it opens

A visit with no parameters gets a **front door**, not a workspace: the headline count, one search
box, an *"explore the map"* way in for anyone without an address in mind, and the two findings the
dataset actually supports. Any URL that carries filters, a selection or a view opens straight into
the full tool, so every shared link behaves exactly as it did when it was copied.

## Two modes

Opens in **Simple** mode: one search box, four filters, three to five columns, a plain-English
answer per property. **Full data** (in the ⋯ menu, remembered per browser) restores the full
investigative tool. Nothing is removed in Simple mode, only folded away behind one *"Show the full
record"* disclosure.

| | Simple | Full data |
| --- | --- | --- |
| Filters | borough, type, status, value, rate cliff | + which rule applies, tax class, building class, ZIP, units per building, data-quality toggles, bookmarks |
| Table | address, value, extra per year (+ type and status above 720px) | + borough, tax now, % increase, units in building, review count, compare |
| Drawer | verdict, tax impact, rate cliff, deadline, exemption routes, city lookups | + identity, valuation, rule checks, provenance, raw JSON, building rollup, nearby records |
| Map | cluster, point count | + layer subsets, heatmap, borough outlines, PNG export |
| Tabs | properties, co-ops by surcharge | + buildings |
| Exports | one-page property report (print / PDF) | + filtered CSV, buildings CSV, co-op CSV, single-property JSON |

## On a phone

Below 720px the three docked columns become one: the filter panel and the detail panel are sheets
over a full-width map and table, the table drops to the three columns that answer the question
(address, value, extra per year), and the roll's disclaimer keeps its full sentence rather than
clipping it. This is the layout a homeowner checking one address actually gets.

## What's in it

**Map** — 31,541 points, clustered, coloured by property type, optional heatmap, borough outlines.
19,056 sit on their exact parcel; the rest are placed on the correct block, because DOF does not map
condo unit lots individually. That distinction is disclosed per record, never hidden.

**Per property** — the plain-English verdict, the rate band and what the surcharge works out to next
to the existing tax bill, the application deadline with a countdown, every exemption route with the
documents DOF asks for (never behind a disclosure — for most visitors it is the answer), and deep
links to the city's own records (parcel record, ZoLa, OASIS, ACRIS deeds, HPD, Street View).

**Rate cliffs** — because the rate is a flat percentage of the full value, the band edge just below
a property is worth real money. **5,959 properties sit within 10% above one**, with **$324M a year**
between them riding on a revaluation; the tightest is over its line by a few hundred dollars. There
is a filter for exactly that population, and each one shows what dropping below the edge would save.
It is arithmetic on DOF's published table — not a claim that a reduction is achievable, which is the
Tax Commission's call, and the wording says so.

**Co-ops by surcharge** — co-op buildings ranked by the charge per apartment, with the caveat that a
real co-op allocates by shares rather than per door.

**Buildings** — one row per building with counts, totals and the surcharge that could land on a
co-op corporation rather than an individual shareholder.

**Methodology** — the published rate table, the exemption routes, what the "tax now" figure leaves
out, and the sources. It has its own URL (`?view=method`), so a section of it can be cited.

**Exports** — a printable **one-page property report** (the figure, how it is reached, the cliff,
the deadline, every exemption route and a dated source citation — `@media print` and the browser's
own Save-as-PDF, no dependency), filtered properties CSV, building summary CSV, co-op CSV,
single-property JSON, map PNG, and shareable URLs for any view.

## Where the numbers come from

| Half | Basis | Trust |
| --- | --- | --- |
| **Surcharge** | DOF's published rate table, applied to the DOF market value on the roll | Official. Both come from the same city source. |
| **Existing property tax** | DOF's published **taxable** assessed value × the class tax rate | Official on both sides. `npm run assess` joins DOF's FY2027 assessment roll, so this is the figure a real bill is computed on — after transitional phase-in, assessment caps and exemptions already netted out. It was estimated from the statutory ratio until 2026-07-29; that overstated 1–3 family homes by a median 2.6× because it ignored the Class 1 caps. If the join is missing it falls back to the ratio and the record says `estimated` rather than `from source`. |

## Change the rules

Everything policy-shaped lives in **`src/lib/policy.json`**: thresholds, the rate bands, exemption
routes, deadlines, the building-class map, review triggers, citations. Edit it, refresh, and every
figure, explanation and count recomputes. No code change, no re-ingest. When DOF publishes the
FY2028 rates, that file is the only thing that changes.

## Layering in more public data

`npm run fetch` already pulls **PLUTO** `64uk-42ks` (free, no API key) and joins it by BBL — that is
where coordinates, year built, floors, unit counts and historic district come from, and where a
co-op building's apartment count comes from, which the per-unit test depends on.

The roll itself already carries the **owner of record**. An LLC, trust or partnership as owner is
worth a reporter's attention, but it decides nothing — DOF explicitly exempts an entity-owned
property when a majority-interest holder or sole trust beneficiary lives there, and publishes an
affidavit for exactly that. The engine treats it as a weak signal and says so, and never applies it
to co-ops, where the corporation owns every unit by construction.

`npm run assess` joins **DOF's Property Valuation and Assessment Data** (`8y4t-faws`, FY2027) on BBL.
Unlike the sales file, condo unit lots are in it, so a plain BBL join matches **all 31,541 records**.
It supplies two things:

- **`curtxbtot`** — the taxable assessed value a bill is actually computed on, replacing an estimate
  that overstated houses by a median 2.6×
- **`coop_apts`** — DOF's own count of apartments in a co-op, which is the divisor the per-apartment
  threshold test turns on. It agrees with PLUTO on 6,001 of 6,011 buildings; where they differ, DOF
  wins and the record carries a note saying so.

`npm run sales` joins **DOF's Citywide Annualized Calendar Sales** (`w2pb-icbu`, also free, no key)
to put the last recorded sale beside the value the surcharge is charged on. **23,737 of 31,541
records match** — 12,359 on the exact tax lot, 11,378 on the building.

The building fallback is not laziness. DOF files an apartment sale against the building's **base
lot** while the roll carries the condo **unit lot**, so a BBL-only join matched 12 condos out of
12,425. Matching on the normalised street address instead gets the building, which is the honest
unit of comparison for an apartment anyway — and each property says which kind of match it got.

What that comparison shows, across every matched record:

| Type | With a recorded sale | Median sale ÷ DOF value |
| --- | --- | --- |
| Condominium | 11,184 | **2.81×** |
| Co-operative | 10,887 | **2.95×** |
| 1–3 family home | 1,537 | **0.83×** |

This is **not** evidence the city is undervaluing anything. State law requires DOF to value condos
and co-ops from comparable *rental* income rather than sale prices, which is precisely why those
multiples sit near 3×. Houses are valued toward sale value and land near 1× — that's the sanity
check confirming it's a methodology difference and not a data error. The surcharge is charged on
DOF's figure either way, and `last_sale_price` is deliberately named so it can never be mistaken
for, or wired into, `value_field_priority`.

`npm run listings` joins **StreetEasy's own address-to-listing crosswalk** — a 163,695-row export
(`listing_id, address, unit, url`, one row per address) supplied directly by StreetEasy rather than
scraped, kept at `data/latest_listing.csv`. **23,442 of 31,541 records match**, and the drawer's
StreetEasy link becomes the listing page itself instead of a search box.

Two caveats are carried in the data rather than glossed over, because the export has no BBL, no
borough and no ZIP — the street address is the only join there is:

- **`listing_match`** — `unit` (553 records) means the apartment designator agreed too, so it is
  this property. `building` (22,889) means only the address did: right for a co-op row, which *is*
  the building, and a neighbouring apartment for a condo unit. The wording under the link says which.
- **No borough in the export**, so a numbered street that repeats across boroughs can point at the
  wrong one. Nothing derived from it ever reaches `value_field_priority` — it stores an id, never a
  price, and an asking price is not DOF's market value.

House-number ranges get one fallback: `148-152 Reade Street` retries as `148 Reade Street`, worth
1,341 matches. Queens addresses are hyphenated too, so the fallback only fires when the second
number is the larger one — Queens house numbers count up from the block and are left alone.

`npm run universe` re-reads the two supplemental roll files **unfiltered** and counts them, which is
the denominator behind the citywide view (`?view=macro`). Both files are published as every class 1
and class 2 property, so the roll's 31,541 and the city's **959,710** are rows on the same files,
counted the same way — a co-op building counts once on each side. **The roll is 3.29% of the city's
class 1 and 2 property**, and almost nowhere near evenly: Manhattan 14.33%, Brooklyn 2.18%, Queens
0.33%, Bronx 0.67%, Staten Island 0.04%.

That view is also the only place this project **models** rather than reports. The gross surcharge
($2.90B a year, nobody exempt) and the property counts are arithmetic on published figures; what the
city actually collects depends on who claims an exemption, which no public dataset records. So the
exempt share is a slider, defaulted to the rate implied by the city's own ~$500M estimate (**83%**),
and all six assumptions — including the two that are genuinely arguable, a flat exemption rate across
boroughs and nobody moving, selling or appealing — are listed in the view beside the numbers they
produce.

### Not layered in, and why

- **ACRIS deed data via API** — the richest ownership trail, but needs a multi-table join through
  `document_id`. The drawer links to the search form meanwhile.
- **DOF exemption detail** (`8y4t-faws`) — per-property STAR/SCHE/DHE records, the best public
  primary-residence proxy. The pipeline reads `star_exemption` if a source file supplies it.
- **DOB permits, HPD violations, 311** — noisy, and keyed to lots rather than units.

## Load your own files

Drop any CSV / TSV / JSON / GeoJSON into `data/raw/` and run `npm run ingest`. Multiple files merge
into one canonical dataset — a roll and an assessment extract with completely different column names
dedupe onto the same records and pool their fields. Column headers are matched by alias, case- and
punctuation-insensitively; teach it a new one by adding a string to `FIELD_ALIASES` in
`src/lib/canonical.mjs`, which prints what it mapped and what it skipped.

## Limits worth stating

- The roll is a starting point, not a determination. DOF says so itself.
- Primary residence decides liability and is not in any public dataset. Records show occupancy as
  *unknown* and are never upgraded to "non-primary".
- DOF market values for condos and co-ops are derived from comparable rental income and are
  typically well below what a unit would sell for.
- Co-op rows are whole buildings. The per-apartment figures are the building value divided by the
  apartment count from PLUTO — indicative, not DOF's own allocation. Any **citywide** total has to
  multiply those rows back up, or a 10,914-apartment co-op counts as one flat; `homesOnRow()` in
  `src/lib/data.ts` is the single place that happens, and `npm run check` fails if the gross leaves
  the $2.5–3.5B band.
- Every total assumes **nobody is exempt**, because public data cannot show who lives where. Priced
  that way the roll is worth about **$2.9B a year** against the city's own **~$500M** estimate — so
  roughly five of every six dollars on it are expected to be exempted away. Which five is not
  knowable from here, and the tool does not pretend otherwise.
- The basemap and cluster-label glyphs come from public CDNs (CARTO, OpenMapTiles). Everything else
  runs offline.

## Layout

```
data/raw/                 downloaded city files (gitignored)
data/processed/           pipeline output, served as static assets
scripts/
  fetch-nyc.mjs           download the DOF roll + PLUTO coordinates
  fetch-assessments.mjs   DOF taxable assessed values + co-op apartment counts (lookup)
  fetch-sales.mjs         last recorded sale per lot and per building (lookup)
  ingest.mjs              file I/O; calls src/lib/canonical.mjs, applies the two lookups
  check.mjs               the test suite
src/
  lib/
    policy.json           ← the rules. Edit this, not the code.
    rules.mjs             classify, pick a value, test, rate, explain
    canonical.mjs         raw row → canonical record; aliases, merge, dedupe
    normalize.mjs         address / borough / money / CSV primitives
    data.ts               load, filter, aggregate, export, plain-English layer
  features/landing|map|properties|buildings|methodology
  state.ts                URL-backed filter state + bookmarks
  styles.css              one stylesheet; the phone layout is one media query
```

Architecture notes — the rules engine, mapping choices, pipeline design — in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Sources

- [NYC DOF — Non-primary residence property surcharge](https://www.nyc.gov/site/finance/property/non-primary-residence-surcharge.page) (rules, rates, exemptions)
- [NYC DOF — Property Assessments](https://www.nyc.gov/site/finance/property/property-assessments.page) (the supplemental roll downloads)
- [Mayor's Office — Mayor Mamdani Notifies Property Owners of New Pied-à-Terre Tax](https://www.nyc.gov/mayors-office/news/2026/07/mayor-mamdani-notifies-property-owners-of-new-pied-a-terre-tax)
- [NYC Tax Commission — surcharge appeal](https://www.nyc.gov/site/taxcommission/forms/surcharge-appeal.page)
- [Bloomberg — NYC's initial pied-à-terre tax roll far exceeds early estimates](https://www.bloomberg.com/news/articles/2026-07-24/nyc-s-initial-pied-a-terre-tax-roll-far-exceeds-early-estimates)

Not affiliated with the City of New York.
