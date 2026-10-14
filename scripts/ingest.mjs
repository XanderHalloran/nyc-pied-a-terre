// Ingest pipeline: everything in data/raw/ -> data/processed/properties.json
//
//   npm run ingest
//
// Drop updated NYC Finance files into data/raw and re-run. Nothing else changes.
// File reading and writing live here; the actual transformation is src/lib/canonical.mjs.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { parseDelimited, addressKey, addressKeyVariants, unitKey } from '../src/lib/normalize.mjs'
import { buildRecords, finalise } from '../src/lib/canonical.mjs'
import { POLICY, evaluate } from '../src/lib/rules.mjs'

const RAW = 'data/raw'
const OUT = 'data/processed/properties.json'
const SALES = 'data/sales-by-bbl.json'
const ASSESS = 'data/assess-by-bbl.json'
const LISTINGS = 'data/listings-by-address.json'
const UNIVERSE = 'data/universe-by-borough.json'

/** @returns {{headers: string[], rows: any[][]}|null} */
function readTable(/** @type {string} */ path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') return parseDelimited(readFileSync(path, 'utf8'))
  if (ext === '.json' || ext === '.geojson') {
    const j = JSON.parse(readFileSync(path, 'utf8'))
    const items = Array.isArray(j) ? j
      : j.type === 'FeatureCollection' ? j.features.map((/** @type {any} */ f) => ({
          ...f.properties,
          ...(f.geometry?.type === 'Point' ? { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } : {}),
        }))
      : Array.isArray(j.records) ? j.records : Array.isArray(j.data) ? j.data : null
    if (!items) { console.warn(`  ! ${basename(path)}: no array of records found — skipped`); return null }
    const headers = [...new Set(items.flatMap((/** @type {any} */ o) => Object.keys(o)))]
    return { headers, rows: items.map((/** @type {any} */ o) => headers.map((h) => o[h])) }
  }
  // ponytail: CSV/TSV/JSON/GeoJSON only. Export spreadsheets to CSV — a zip+xml reader is not
  // worth carrying for a format the city does not publish this roll in.
  console.warn(`  ! ${basename(path)}: unsupported extension — export it to CSV`)
  return null
}

// -------------------------------------------------------------------- main

const files = (() => {
  try { return readdirSync(RAW).filter((f) => !f.startsWith('.') && statSync(join(RAW, f)).isFile()) }
  catch { return [] }
})()

if (!files.length) {
  console.error(`No files in ${RAW}/. Run \`npm run fetch\` to download the DOF roll.`)
  process.exit(1)
}

/** @type {{file: string, headers: string[], rows: any[][]}[]} */ const tables = []
for (const file of files.sort()) {
  const t = readTable(join(RAW, file))
  if (t) tables.push({ file, ...t })
}

const { records, sourceMeta, stats, importedAt } = buildRecords(tables)
for (const s of sourceMeta) {
  console.log(`${s.file}: ${s.rows} rows -> ${s.new_records} new, ${s.rows - s.new_records} merged/skipped` +
    (s.unmapped_columns.length ? `  (unmapped: ${s.unmapped_columns.join(', ')})` : ''))
}

finalise(records, importedAt)

// Context columns that arrived on the source rows become one `public` object, so the UI has a
// single place to read building facts from.
for (const r of records) {
  /** @type {Record<string, any>} */ const p = {}
  const pick = {
    year_built: r.year_built, floors: r.floors, units_res: r.residential_units,
    historic_district: r.historic_district, zoning: r.zoning, council_district: r.council_district,
  }
  for (const [k, v] of Object.entries(pick)) if (v != null) p[k] = v
  if (Object.keys(p).length) r.public = p
}

// Real taxable assessed value and DOF's own co-op apartment count, from `npm run assess`.
//
// This replaces an estimate that was wrong by a median 2.6x for 1-3 family homes: the roll carries
// no assessed value, so it was derived as market x the statutory ratio, which ignores the Class 1
// assessment caps. `assessed_value` is what rules.mjs prefers for the existing-tax figure, so
// setting it here makes that figure real and stamps it `source` rather than `estimated`.
//
// It does NOT touch `market_value` — the surcharge is charged on the supplemental roll's FMV, and
// this file's `curmkttot` is a different roll. Only the existing-tax side changes.
if (existsSync(ASSESS)) {
  const { assess, fetched_at } = JSON.parse(readFileSync(ASSESS, 'utf8'))
  let av = 0, apts = 0
  for (const r of records) {
    const a = r.bbl ? assess[r.bbl] : null
    if (!a) continue

    // DOF's own apartment count beats PLUTO's residential-unit count: it is the divisor the
    // per-apartment threshold test turns on, and DOF is the one applying that test.
    if (a.coop_apts && r.apartments != null && a.coop_apts !== r.apartments) {
      r.notes = [...(r.notes ?? []), `apartment count ${r.apartments} (PLUTO) replaced with ${a.coop_apts} (DOF assessment roll)`]
      r.apartments = a.coop_apts
      if (r.building_market_value) r.market_value = Math.round(r.building_market_value / a.coop_apts)
      apts++
    }

    if (a.taxable > 0) {
      // Scaling, and this is the part that bites: DOF assesses a co-op as ONE parcel, and EVERY
      // co-op row on the roll carries that parcel's BBL — the ~6k building rows and the ~11.9k
      // individual apartment rows alike. Handing each of them the parcel's taxable value put the
      // whole building's tax bill on one apartment and tripled the citywide total.
      //
      // `a.coop_apts >= 2` is DOF's own statement that this lot is a co-op building, so it is the
      // signal used rather than anything inferred from building class.
      let taxable = a.taxable
      let exempt = a.exempt ?? 0
      if (a.coop_apts >= 2) {
        // A building row is already presented per apartment, so take the average. A unit row is one
        // specific apartment, so take its share of the parcel by DOF's own market values — closer
        // than an average, and it degrades to the average when the market figures are unusable.
        const share = r.building_market_value == null && a.market > 0 && r.market_value > 0
          ? Math.min(1, r.market_value / a.market)
          : 1 / a.coop_apts
        taxable *= share
        exempt *= share
      }
      r.assessed_value = Math.round(taxable)
      r.assessed_exempt = exempt > 0 ? Math.round(exempt) : null
      av++
    }
  }
  console.log(`assessments: ${av.toLocaleString()} records given DOF's taxable assessed value, `
    + `${apts.toLocaleString()} co-op apartment counts corrected — index ${fetched_at.slice(0, 10)}`)
} else {
  console.log(`assessments: ${ASSESS} not found — run \`npm run assess\`; existing-tax figures will be estimated`)
}

// Last recorded sale, joined on BBL from `npm run sales`. Deliberately named `last_sale_*` and not
// `sale_price`: the surcharge is charged on DOF's market value, and nothing here may ever reach
// policy.value_field_priority. This is context beside the figure, never an input to it.
if (existsSync(SALES)) {
  const { sales, by_address, fetched_at } = JSON.parse(readFileSync(SALES, 'utf8'))
  const tally = { lot: 0, building: 0 }
  for (const r of records) {
    // Exact lot first — that is this property itself. Otherwise the building, which is what an
    // apartment sale is filed against. The distinction is stored, because it changes the wording.
    const exact = r.bbl ? sales[r.bbl] : null
    const near = exact ? null : (r.bbl && r.address ? by_address[`${r.bbl[0]}|${addressKey(r.address)}`] : null)
    const s = exact ?? near
    if (!s) continue
    tally[exact ? 'lot' : 'building']++
    r.last_sale_price = s.price
    r.last_sale_date = s.date
    r.last_sale_unit = s.unit
    r.last_sale_match = exact ? 'lot' : 'building'
    r.sales_in_lot = s.n
  }
  const hit = tally.lot + tally.building
  console.log(`sales: ${hit.toLocaleString()} of ${records.length.toLocaleString()} records matched `
    + `(${tally.lot.toLocaleString()} exact lot, ${tally.building.toLocaleString()} same building) `
    + `— index ${fetched_at.slice(0, 10)}`)
} else {
  console.log(`sales: ${SALES} not found — run \`npm run sales\` to add last-sale context`)
}

// The StreetEasy listing for the address, from `npm run listings`. Stored as an id, never a price:
// an asking price is not DOF's market value and must never be mistaken for a valuation input.
//
// The export carries no borough, so this join is on street address alone and a numbered street can
// repeat across boroughs. `listing_match` records how much weight the link can carry — `unit` means
// the apartment designator agreed too, `building` means only the address did — and the app words
// the link from it rather than presenting every match as if it were the property itself.
if (existsSync(LISTINGS)) {
  const { listings, fetched_at } = JSON.parse(readFileSync(LISTINGS, 'utf8'))
  const tally = { unit: 0, building: 0 }
  for (const r of records) {
    const at = addressKeyVariants(r.address).map((k) => listings[k]).find(Boolean)
    if (!at?.length) continue
    const want = unitKey(r.unit)
    const exact = want ? at.find((/** @type {[string, string]} */ l) => unitKey(l[1]) === want) : null
    const [id, unit] = exact ?? at[0]
    r.listing_id = id
    r.listing_unit = unit || null
    r.listing_match = exact ? 'unit' : 'building'
    tally[r.listing_match]++
  }
  const hit = tally.unit + tally.building
  console.log(`listings: ${hit.toLocaleString()} of ${records.length.toLocaleString()} records matched `
    + `(${tally.unit.toLocaleString()} same unit, ${tally.building.toLocaleString()} same address) `
    + `— index ${fetched_at.slice(0, 10)}`)
} else {
  console.log(`listings: ${LISTINGS} not found — run \`npm run listings\`; StreetEasy links stay searches`)
}

// Summary only — the app re-runs evaluate() itself, so an edited policy.json takes effect on
// refresh with no re-ingest.
const tally = { listed: 0, inferred: 0, not_flagged: 0, needs_review: 0 }
for (const r of records) {
  const f = evaluate(r)
  tally[f.status]++
  if (f.review.length) tally.needs_review++
}

mkdirSync('data/processed', { recursive: true })

// Null fields and the columns that moved into `public` are ~a third of the payload at 30k records.
// Missing keys read back as undefined, which every `== null` check in the app already handles.
const MOVED = new Set(['year_built', 'floors', 'residential_units', 'historic_district', 'zoning', 'council_district', 'raw'])
const lean = records.map((r) => {
  /** @type {Record<string, any>} */ const o = {}
  for (const [k, v] of Object.entries(r)) {
    if (v == null || MOVED.has(k)) continue
    if (Array.isArray(v) && !v.length) continue
    o[k] = v
  }
  return o
})

writeFileSync(OUT, JSON.stringify({
  meta: {
    generated_at: importedAt,
    policy_version: POLICY.version,
    sources: sourceMeta,
    counts: {
      read_rows: stats.readRows, records: records.length,
      merged_duplicates: stats.dupes, skipped_unusable: stats.skipped, ...tally,
    },
    geocoding: {
      point: records.filter((r) => r.geocode_source === 'point').length,
      block: records.filter((r) => r.geocode_source === 'block').length,
    },
    // The denominator, from `npm run universe`. Without it the macro view has no left edge and
    // simply hides the share-of-city column rather than inventing one.
    universe: existsSync(UNIVERSE) ? JSON.parse(readFileSync(UNIVERSE, 'utf8')) : null,
  },
  records: lean,
}))

console.log(`\n${OUT}  (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`)
console.log(`  ${records.length} properties  ·  ${stats.dupes} duplicate rows merged  ·  ${stats.skipped} unusable rows dropped`)
console.log(`  ${tally.listed} listed  ·  ${tally.inferred} inferred  ·  ${tally.needs_review} need review`)
