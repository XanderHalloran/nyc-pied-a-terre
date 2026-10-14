# Architecture notes

Three decisions carry the tool: where policy lives, how records get mapped, and how source files
become one dataset. Everything else is UI over those.

---

## 1. The rules engine

**The rules are data, not code.** `src/lib/policy.json` holds thresholds, comparators, the valuation
field priority, the building-class → property-type map, the rate bands, exemption definitions, review
triggers, deadlines and source citations. `src/lib/rules.mjs` is an interpreter of that file and
asserts nothing on its own. Edit the JSON, refresh the browser, and every flag, count, explanation
and table recomputes.

That mattered when the policy was uncertain — the app was first built against press reporting — and
it is what made the switch to DOF's official published roll and rate table a change to one file
rather than a rewrite. It is also why a new string anywhere in the UI that states a rule has to read
it from `POLICY` rather than restate it: the lay copy, the printed report and the engine all move
together or they drift apart.

### Evaluation, in order

```
classify(record)        explicit type → DOF building class → tax class → unknown
                        each result carries `basis` (why) and `certain` (whether to trust it)
pickValue(record)       first non-null of policy.value_field_priority
                        other values on the record are reported as alternatives
test thresholds         known type → its one rule; unknown type → all of them, marked ambiguous
                        comparator (gte / gt) comes from the policy, not from code
near-cutoff             |value − threshold| ≤ threshold × near_threshold_pct
occupancyEvidence()     owner_occupied / primary_residence / STAR / owner mailing state
reconcile with the list listed → direct; threshold-only → inferred; listed-but-below → review
```

### Three invariants

**Absence of evidence is never evidence.** The tax applies to non-primary residences. Public data
does not record primary residence. A record with no occupancy evidence returns `occupancy:
'unknown'`, gets a `no_occupancy_evidence` review flag, and is never upgraded to “non-primary”. An
out-of-state owner mailing address is a signal, not a finding — the explanation says so in words.

**Missing data is not a pass.** A record with no usable valuation returns `passed: null` (“cannot
test”), not `false`. The plain-English output says *treat this as “not assessed”, not “cleared”*.

**Disagreement is surfaced, not smoothed.** A property on the city list that no threshold explains
is still `status: 'listed'` — the city said so — but gains a `listed_but_below` review flag and an
explanation that names the three possible causes. The methodology panel counts these separately.
They are the most interesting rows in the dataset.

### Explainability

`evaluate()` returns a `checks[]` array. Each check has an id, a human label, a tri-state verdict, a
`detail` string with the actual numbers, and `inputs` — the source column names that fed it. The
detail strings are built from the policy's own note text, so a threshold's caveat travels with every
record it touches. The drawer renders the array directly; there is no second, prettier code path
that could drift from the one that decides.

`explain()` composes those into a paragraph. It is deliberately hedged — the engine describes a
lead, never asserts a liability.

There is no numeric relevance score. An earlier version had one and nothing ever ranked by it, so it
went: `status` and `confidence` are categorical and legible, and a 0–1 float that only ever broke
ties was a number readers could mistake for a probability of owing tax.

### The tax model, and keeping two confidence levels apart

`estimateTax()` answers "how big is this, really?" by putting the surcharge next to the bill the
owner already pays. Both halves are now official, but they come from different rolls and the code
keeps that visible rather than blending them:

- **Current bill** is taxable assessed value × the class tax rate. The surcharge roll publishes no
  assessed value, so it comes from DOF's FY2027 assessment roll via `npm run assess` — `curtxbtot`,
  the billable figure, with transitional phase-in, assessment caps and exemptions already netted out.
  Every record is stamped `from source`. Where the join is missing, assessed value falls back to the
  statutory ratio and the record says `estimated` — degrade visibly, never silently.

  **This was an estimate until a user reported it didn't match their bill, and they were right.**
  Deriving assessed value as market × the statutory ratio overstated 1–3 family homes by a median
  2.6×, because it ignores the Class 1 caps that hold assessed values far below the ratio — the
  single largest source of error in the model, correctly listed in `policy.json` as unmodelled and
  then shipped anyway. One Upper East Side house read $547,754 against an actual $111,530.

  Two things that cost time when fixing it, both worth knowing before touching this path again:

  **The roll contains Class 1 condos.** Tax classes `1A`/`1B`/`1C` are condominiums assessed at 6%,
  not the 45% that "condo ⇒ class 2" would suggest. A hand calculation that assumed class 2 produced
  a phantom 7.5× discrepancy and sent the investigation in the wrong direction for a while; the
  engine had been reading the record's own tax class correctly all along.

  **Every co-op row carries the parcel's BBL** — the ~6k building rows and the ~11.9k individual
  apartment rows alike. Joining assessed value on BBL therefore hands each apartment the *whole
  building's* taxable value. That read $21B of citywide existing tax against a ~$33B city levy, which
  is the only reason it was caught. Building rows take `taxable / coop_apts`; unit rows take their
  share by DOF's own market values.
- **Surcharge** is DOF's own published rate table applied to DOF's own published value, so both sides
  of the multiplication come from the same city source. It is stamped `OFFICIAL`, and the band, the
  rate and the arithmetic are all shown so the number can be checked by hand.

The single most important property of that table: **the rate is a flat percentage of the FULL market
value, not a marginal rate on the amount above a line.** A condo at $2,999,999 pays 4% of the whole
value; at $3,000,001 it pays 5.25% of the whole value — about $52,000 more for one dollar. Getting
this wrong in either direction would misstate every figure in the app, so the structure is named in
`policy.json` (`structure: "flat_rate_on_full_value"`) rather than implied by the code.

That structure has a consequence worth surfacing rather than burying: **every band edge is a cliff.**
`estimateTax` therefore also returns `floor_edge` (the edge below this property), `appeal_drop` (how
far the value would have to fall) and `appeal_saving` (what falling would be worth), and `onCliff()`
answers whether the drop is small relative to the value. 5,959 properties are within 10% of an edge.
The wording around it is deliberately arithmetical — it says what the published table implies, never
that DOF's value is wrong or that a reduction is winnable, which is the Tax Commission's call.

Two design choices keep the rest honest. The bands key off **each property's own type and threshold**
rather than fixed dollar values, so editing the policy moves the surcharge with it instead of leaving
the two silently inconsistent. And the surcharge uses `flags.value_used` — the same figure the
threshold test used — so the flag and the bill can never disagree about which number describes the
property.

`null` and `0` mean different things here and the tests pin both. A flagged record with no applicable
threshold or no usable valuation returns `surcharge: null` ("cannot model"), because returning `0`
would read as "owes nothing". A record below every threshold returns `0` — genuinely nothing.

### Two speeds of the same engine

`evaluate()` / `explainFlags()` and `estimateTax()` / `explainTax()` are the same functions behind one
`verbose` flag. The fast pair skips building the `checks[]` array, the `detail` strings and the
formula prose; the verbose pair is called only for the one record open in the drawer or on a printed
report. This was measured, not guessed: composing explanations for all 31,541 records on load cost
**26.9 seconds**, and splitting the paths brought it to **311 ms** — an 87× difference and the reason
a cold load reaches the map in about a second. Because it is one function with a branch rather than
two implementations, the fast and verbose paths cannot disagree, and a test asserts they don't.

### Co-ops are buildings, and this is the bug that matters most

DOF assesses a co-op as **one parcel for the whole building**, but the threshold and the rate band
apply **per unit** ("cooperative *units* valued at $1,000,000 or more"). So `fetch-nyc.mjs` divides a
co-op building row's market value by its PLUTO apartment count and keeps the parcel total in
`building_market_value`; the per-unit figure is what gets tested and rated.

Two places have to multiply back up, and both are single points of truth: `coopBuilding()` for a
building's own totals, and `homesOnRow()` for any citywide aggregate. Testing the parcel total
instead of the per-apartment value charged Co-op City (10,914 apartments at ~$56k each) and Roosevelt
Island tens of millions a year; forgetting to multiply back in the citywide total understated the
roll by ~$320M. Both bugs shipped at some point and both were caught by the same sanity check — gross
with nobody exempt should land near $2.9B against the city's ~$500M net estimate — which is now an
assertion in `npm run check` rather than a thing to remember.

### Two audiences, one app

Simple mode is not a second app or a cut-down dataset — it is one boolean that narrows what is
rendered. Columns carry a `simple` flag, filter groups are wrapped in `expert &&`, and the drawer's
technical half is wrapped in a `<Technical>` component that is a pass-through in Full data mode and a
single `<details>` in Simple. Nothing is computed differently and nothing is unavailable; the full
record is always one disclosure away. That is why there is no risk of the two modes disagreeing —
there is only one code path producing the numbers. (The toggle is labelled *Full data* rather than
*Expert*: it names the content, not the reader.)

A third axis narrows the same way. Columns also carry an `sm` flag and one media query drops the rest
below 720px, where the docked sidebar and drawer become sheets over a single stacked column. Same
data, same components, no mobile build.

### The front door

A visit carrying no URL parameters at all renders `features/landing` in place of the workspace —
inside the same shell, so the top bar and the disclaimer strip do not move when you enter. Any
parameter (a filter, a selection, `?view=method`) means the visitor was sent somewhere specific and
goes straight to the tool. `useUrlState` captures that bareness once, before its own effect writes
the default filter back into the address bar; getting the ordering wrong would make every visit look
parameterised and the front door would never appear.

The plain-English layer (`plainVerdict`) is presentation, not policy, so it lives in `data.ts` rather
than the engine. It reads the same flags and tax estimate as everything else and pulls its threshold
figures from `POLICY` rather than restating them, so editing `policy.json` moves the lay copy too.

### Lookups are a third input, and they live outside data/raw/

Ingest reads *everything* in `data/raw/` as property records, so the four enrichment files —
`data/assess-by-bbl.json`, `data/sales-by-bbl.json`, `data/listings-by-address.json` and
`data/universe-by-borough.json` — deliberately sit one directory up, as does the `latest_listing.csv`
the third is built from. Dropping any of them into `raw/` would have it parsed as a roll. All are
applied after `finalise()`, all are optional, and each prints what it matched so a silent miss is
visible in the ingest log.

The universe file is the odd one out: it is not joined per record but attached whole to `meta`, and
it is the only figure on the site that is a *denominator*. It is counted off the same two DOF files
the roll is filtered from, which is the entire reason it is trustworthy — a census household count
would not be the same unit as a roll row, and a co-op building has to count once on both sides of
the fraction or the share is nonsense.

The listings lookup is the one keyed on address alone — StreetEasy's export carries no BBL and no
borough — so it stores `listing_match` beside the id and the UI words the link from it. An address
join that cannot see a borough is allowed to be a link; it is never allowed to be a number.

**One tax lot is not always one home.** Three separate cases bit this project, and they are the first
thing to check when a per-property figure looks wrong by a large multiple:

| Shape | The trap |
| --- | --- |
| Co-op building row | DOF values the whole parcel; the threshold applies per apartment |
| Co-op apartment row | Carries the *parcel's* BBL, so any BBL join returns building-level data |
| Condo class R9 | One deed, one lot, an entire apartment block inside it |

The R9 case is deliberately **not** divided. An R9 lot is legally a single condominium unit, so
applying the per-unit rule to it is the correct reading, and inventing a per-apartment allocation DOF
does not publish would be worse than the confusion it causes. `multiUnitLot()` suppresses the
comparison that would be meaningless and says why, which is the honest half of the fix. 183 rows,
about $180M a year of surcharge, and revisiting it should be a decision rather than a default.

### The market number is context, never an input

`npm run sales` joins DOF's own sales file to show what a property last changed hands for, beside
the value the surcharge is charged on. Three deliberate choices:

**It is named `last_sale_price`, not `sale_price`.** The latter is a valuation field name, and
`policy.value_field_priority` is the list of things that can become the figure the tax is computed
on. A test asserts the sale can never appear there. Context that quietly becomes an input is how a
tool starts producing numbers the city would not recognise.

**Two join keys, and the record says which one hit.** DOF files an apartment sale against the
building's base lot; the roll carries the condo unit lot. BBL-only matched 12 condos out of 12,375.
Falling back to borough + normalised street address matches the building — reusing `addressKey()`,
the same lossy matcher the dedupe path already uses — and lifts coverage to 23,737 of 31,541. A
`building` match is worded as "last recorded sale in this building", never as this unit's price.

**The gap is explained where it appears.** Condos and co-ops sell at a median 2.78× and 2.94× DOF's
value; houses at 0.83×. That is not undervaluation, it is RPTL §581 requiring condos and co-ops to
be valued from comparable rental income — and the house figure near 1× is the control that proves
it. A bare side-by-side would read as "the city is lowballing by 3×" to every owner who saw it, so
the number never ships without the sentence.

### Public data is a join, not a dependency

`scripts/fetch-nyc.mjs` pulls PLUTO in bulk once and joins it by BBL, falling back to borough+block
because condo *unit* lots are not in PLUTO — it carries the condo billing lot. That join is where
coordinates, year built, floors, historic district and, critically, the co-op apartment count come
from. It writes to `data/raw/`, so ingest stays fast and offline and re-runs as often as you like
without touching the network.

The owner-of-record rule earns its place because it converts a *guess* into an *inference*: an out-of-
state mailing address is suggestive, but an LLC or trust as owner of record is dispositive on the
question of primary residence. The co-op exclusion is the part worth reading twice — a co-op
building is owned by its corporation, so without that carve-out the rule would flag every co-op
shareholder in New York City. It is encoded in `policy.json` as
`residency_rule.entity_owner_applies_to` with the reason next to it, and pinned by a test.

### Why not a rules DSL

Two thresholds and one residency test do not need an expression language. The JSON is a list of
`{applies_to, min_value, comparator}` objects and the interpreter is a loop. If the real policy grows
phase-in dates or borough-specific figures, add fields to the objects — that is a small change to one
loop, and still not a DSL.

---

## 2. Mapping

**MapLibre GL JS, raster basemap, no wrapper.** MapLibre gives clustering and heatmaps as built-in
source/layer types, so there is no cluster plugin and no heatmap plugin. The basemap is CARTO raster
tiles declared inline as a style object — no external style JSON, no API key, no account. Cluster
count labels need glyphs, which come from OpenMapTiles' public font CDN; if that is unreachable
MapLibre renders digits locally and the map still works.

There is no React wrapper library. The map is a `useRef` plus a handful of effects: one to
initialise, one per prop that maps to a MapLibre call. Event handlers are bound once at layer
creation and read current props through refs, so nothing rebinds on every render.

**Two sources of the same data.** `cluster: true` is a source-level option that cannot be toggled
after creation, and a heatmap over clustered points is wrong. So there are two GeoJSON sources — one
clustered, one flat — both fed by the same `setData`, with layer visibility switching between them.
More memory, far less code than tearing down and rebuilding a source.

**Layer toggles filter the data, not the layer.** “Likely condos / co-ops” subsets the array before
building the FeatureCollection rather than applying a MapLibre layer filter. A layer filter would
hide points inside clusters while leaving the cluster counts unchanged — the map would lie about how
many properties it was showing.

**Geocoding degrades visibly.** Coordinates from the PLUTO join are used if they fall inside a NYC
bounding box (which rejects swapped lat/lon, state-plane values and `0,0`). Anything unplaced falls
back to its **ZIP centroid — derived from the records that do have points**, so no ZIP lookup table
ships — then to a borough centroid. Fallback positions get a deterministic hash-based jitter so
stacked records stay distinguishable, `geocode_source` records the downgrade, and the map draws them
faded with a white ring. A guess never looks like a parcel. 19,070 of 31,541 sit on their exact
parcel; the rest are on the correct block, and every record says which.

**Framing by bounds, not centre/zoom.** The map fits the five-borough bounding box, so it stays
correct as the side panels open and the table pane resizes. Selecting a borough filter refits to that
borough rather than leaving the viewport where it was.

---

## 3. The data pipeline

```
data/raw/*.{csv,tsv,json,geojson}
        │  scripts/ingest.mjs        file I/O
        │  src/lib/canonical.mjs     alias mapping → canonicalise → dedupe → merge → derive
        ▼
data/processed/properties.json   canonical records + provenance + counts
```

**The transformation is shared with the browser.** `canonical.mjs` is plain JavaScript with JSDoc
types, so Node runs it with no build step and Vite bundles it unchanged, while `tsc --noEmit`
type-checks it through `checkJs` alongside every `.tsx` caller. One implementation, so there is no
second, subtly different browser copy to drift.

**Aliases are the extension point.** `FIELD_ALIASES` maps canonical field → accepted headers,
compared with punctuation and case stripped. Teaching the pipeline a new DOF header is one string.
Unmapped columns are reported per file so nothing is silently discarded.

**Merging, not overwriting.** Dedupe key is `BBL + unit` when a BBL exists, normalised address +
unit otherwise. Later files fill gaps in earlier ones; a `true` published-list flag is sticky;
`sources[]`, `notes[]` and the raw column blobs accumulate. A published-list file and an assessment
extract with completely different schemas converge on one record carrying both provenances.

**Address normalisation is two functions with different jobs.** `cleanAddress()` produces the display
form. `addressKey()` produces a lossy matching key — expands `Ave`→`avenue` and `5th`→`5`, strips
unit designators — so `740 Park Ave, Apt 12B` and `740 PARK AVENUE #12b` collide, and so every unit
in a tower collapses to one building key. Keeping them separate means matching can be aggressive
without mangling what the user reads.

**One output file, and it is lean.** Records are written with nulls and empty arrays stripped, which
is worth several megabytes across 31,541 rows — so consumers read `row.notes` / `row.sources`
defensively with `?? []`. The payload is 21 MB, which Caddy serves as **1.3 MB gzipped**; that is the
number that matters, and it is why there is no second lazy-loaded file to keep in sync.

**Flags are not persisted.** Ingest computes them once for the summary counts and throws them away.
The browser re-runs `evaluate()` on load (31,541 records in ~300 ms, thanks to the fast/verbose
split above). That is what makes editing `policy.json` take effect on refresh with no re-ingest —
the alternative would bake a policy version into the dataset and require a rebuild to change a
threshold.

**Data quality is a list, not a grade.** `flags.review[]` names what is actually wrong with a record
— missing valuation, unclassifiable type, approximated position, listed-but-below-threshold — and
each entry carries its own explanation from `policy.review_triggers`. A single rolled-up quality
score would let "we know almost nothing about this property" and "we know everything and one field
disagrees" land in the same bucket, which is exactly the distinction a reporter is looking for.

---

## Client-side stack

**No database.** 31,541 records filter through a dozen predicates in a few milliseconds. DuckDB-WASM
would add megabytes of WASM, an async boundary and a query language to beat a `.filter()` that is
already imperceptible. The threshold to revisit is roughly 200k rows — at which point the table needs
virtualising too, which pagination currently avoids.

**No state library.** Filters, the selected property, the compare set and the open document live in
the URL via `URLSearchParams`. Sharing a view is free, the back button works, there is no store to
keep in sync with the address bar — and the methodology is citable because `?view=method` is a real
address rather than modal state.

**No CSS framework, no PDF library, no dropdown library.** One stylesheet of CSS custom properties;
light and dark are two token sets behind a `data-theme` attribute, defaulting to the OS preference on
a first visit. The printable property report is `@media print` plus `window.print()`. The overflow
menu is a native `<details>`. Each of those is a dependency not taken for a feature the platform
already ships.

**Search is substring-over-tokens, not fuzzy-matching.** Every query token must appear in a
precomputed lowercase haystack per record. An investigator typing a BBL or a street name wants exact
containment; edit-distance matching would surface plausible-looking wrong addresses, which in this
context is worse than no result.

**Testing is one file.** `scripts/check.mjs` — 44 assertions over normalisation, merging, the rules
engine and the tax model, run with `node`, no framework. It covers the logic that would silently
produce wrong journalism if it broke: the headline asymmetry (a $2M house is clear while a $1.1M
condo is not), the guarantee that reordering `value_field_priority` changes the outcome, the
flat-rate band arithmetic and the exact cliff figures, the `null`-vs-`0` distinction in the
surcharge, the agreement of the fast and verbose paths, and — against the built dataset when one
exists — the citywide revenue sanity check that has now caught two co-op scaling bugs. UI rendering
is not tested; it fails visibly, and the engine does not.
