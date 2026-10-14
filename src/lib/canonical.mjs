// Raw source row -> canonical property record: header aliasing, dedupe, merge, derived columns.
// Plain JS + JSDoc so Node runs it with no build step and tsc still type-checks it.
// Checks live in scripts/check.mjs — `npm run check`.

import {
  normBorough, normBBL, normMoney, normZip, normBool,
  cleanAddress, addressKey, extractUnit, splitBBL, BOROUGH_BY_CODE,
} from './normalize.mjs'

/**
 * Canonical field -> accepted source headers. Add aliases here when a new city file shows up;
 * nothing else in the pipeline needs to know.
 */
export const FIELD_ALIASES = {
  bbl: ['bbl', 'bble', 'boro_block_lot', 'boroughblocklot', 'parcel_id'],
  boro_code: ['boro', 'borocode', 'boro_code', 'borough_code'],
  borough: ['borough', 'boro_name', 'boroname', 'borough_name', 'county'],
  block: ['block', 'tax_block'],
  lot: ['lot', 'tax_lot'],
  bin: ['bin', 'building_identification_number'],
  address: ['address', 'property_address', 'full_address', 'street_address', 'addr', 'location'],
  house_number: ['house_number', 'houseno', 'house_no', 'housenum', 'street_number', 'stnum'],
  street_name: ['street_name', 'street', 'streetname', 'stname'],
  unit: ['unit', 'apt', 'apt_no', 'aptno', 'apartment', 'unit_no', 'unitnumber'],
  zip: ['zip', 'zipcode', 'zip_code', 'postcode', 'postal_code'],
  neighborhood: ['neighborhood', 'neighbourhood', 'nta', 'ntaname', 'community', 'area'],
  building_class: ['building_class', 'bldgcl', 'bldg_class', 'buildingclass', 'bldgclass', 'building_class_at_present'],
  tax_class: ['tax_class', 'taxclass', 'taxclasscurr', 'tax_class_at_present', 'class'],
  property_type: ['property_type', 'type', 'proptype'],
  market_value: ['market_value', 'fullval', 'full_market_value', 'est_market_value', 'estimated_market_value', 'mktval', 'curmkttot'],
  assessed_value: ['assessed_value', 'avtot', 'assessed_total', 'curavltot', 'assessment'],
  sale_price: ['sale_price', 'saleprice', 'last_sale_price'],
  owner_occupied: ['owner_occupied', 'ownerocc', 'owner_occupancy'],
  primary_residence: ['primary_residence', 'primaryres', 'is_primary_residence'],
  star_exemption: ['star_flag', 'star', 'star_exemption', 'basic_star', 'enhanced_star'],
  owner_mailing_state: ['owner_state', 'owner_mailing_state', 'mailing_state', 'ownerstate'],
  owner_name: ['owner', 'owner_name', 'ownername'],
  listed_by_source: ['listed', 'on_published_list', 'onpublishedlist', 'published', 'flagged', 'pied_a_terre'],
  lat: ['lat', 'latitude', 'y', 'ycoord'],
  lon: ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord'],
  // DOF assessment roll + PLUTO extras
  exempt_total: ['exempt_total', 'curactextot', 'exempttot', 'exemption_total', 'exempt_value'],
  apartments: ['apartments', 'coop_apts', 'coop_units'],
  building_market_value: ['building_market_value'],
  building_assessed_value: ['building_assessed_value'],
  residential_units: ['residential_units', 'unitsres', 'units'],
  year_built: ['year_built', 'yrbuilt', 'yearbuilt'],
  floors: ['floors', 'numfloors', 'num_floors', 'stories', 'bld_story'],
  historic_district: ['historic_district', 'histdist'],
  zoning: ['zoning', 'zonedist1', 'zoning_district'],
  council_district: ['council_district', 'council'],
  geo_precision: ['geo_precision'],
}

export const headerKey = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** canonicalised header -> canonical field */
export const HEADER_INDEX = new Map(
  Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) => aliases.map((a) => [headerKey(a), field])),
)


/**
 * @param {Record<string, any>} raw one source row, keyed by its original headers
 * @param {string} file
 * @param {number} rowNo
 */
export function canonicalise(raw, file, rowNo) {
  /** @type {Record<string, any>} */ const f = {}
  /** @type {string[]} */ const notes = []
  for (const [h, v] of Object.entries(raw)) {
    const field = HEADER_INDEX.get(headerKey(h))
    if (field && (f[field] == null || f[field] === '')) f[field] = v
  }

  const bbl = normBBL(f.bbl) ?? normBBL(f.boro_code ?? f.borough, f.block, f.lot)
  const parts = splitBBL(bbl)

  const borough = normBorough(f.borough) ?? normBorough(f.boro_code) ?? parts?.borough ?? null
  if (!f.borough && borough) notes.push(`borough derived from ${parts?.borough === borough ? 'BBL' : 'borough code'}`)

  let address = String(f.address ?? '').trim()
  if (!address && (f.house_number || f.street_name)) {
    address = [f.house_number, f.street_name].filter(Boolean).join(' ').trim()
    notes.push('address assembled from house number + street name')
  }
  const unit = String(f.unit ?? '').trim() || extractUnit(address)
  address = cleanAddress(address.replace(/,?\s*(apt|unit|ste|suite)\.?\s*#?\s*[\w-]+\s*$/i, ''))

  const lat = Number(f.lat), lon = Number(f.lon)
  // NYC bounding box — rejects swapped lat/lon, state-plane coordinates and 0,0 placeholders.
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon) &&
    lat > 40.3 && lat < 41.1 && lon > -74.4 && lon < -73.6
  if (f.lat != null && String(f.lat) !== '' && !hasPoint) notes.push('supplied coordinates rejected (outside NYC bounds)')

  // 'block' means the point is a building on the correct block rather than the exact parcel —
  // condo unit lots are not mapped individually, so this is the honest best position for them.
  const precision = String(f.geo_precision ?? '').trim()
  const geocode_source = !hasPoint ? null : precision === 'block' ? 'block' : 'point'
  if (hasPoint && precision === 'block') notes.push('condo/unit lot is not mapped individually — positioned on its block')

  return {
    id: `${file}#${rowNo}`,
    bbl,
    bin: String(f.bin ?? '').replace(/\D/g, '') || null,
    address,
    unit: unit || null,
    borough,
    zip: normZip(f.zip) ?? normZip(f.address),
    neighborhood: String(f.neighborhood ?? '').trim() || null,
    block: parts?.block ?? (f.block != null ? String(f.block) : null),
    lot: parts?.lot ?? (f.lot != null ? String(f.lot) : null),
    building_class: String(f.building_class ?? '').trim().toUpperCase() || null,
    tax_class: String(f.tax_class ?? '').trim() || null,
    property_type: String(f.property_type ?? '').trim().toLowerCase() || null,
    market_value: normMoney(f.market_value),
    assessed_value: normMoney(f.assessed_value),
    sale_price: normMoney(f.sale_price),
    owner_name: String(f.owner_name ?? '').trim() || null,
    owner_occupied: normBool(f.owner_occupied),
    primary_residence: normBool(f.primary_residence),
    star_exemption: normBool(f.star_exemption) ?? (String(f.star_exemption ?? '').trim() ? true : null),
    owner_mailing_state: String(f.owner_mailing_state ?? '').trim().toUpperCase() || null,
    listed_by_source: normBool(f.listed_by_source),
    exempt_total: normMoney(f.exempt_total),
    apartments: normMoney(f.apartments),
    building_market_value: normMoney(f.building_market_value),
    residential_units: normMoney(f.residential_units),
    year_built: normMoney(f.year_built),
    floors: normMoney(f.floors),
    historic_district: String(f.historic_district ?? '').trim() || null,
    zoning: String(f.zoning ?? '').trim() || null,
    council_district: String(f.council_district ?? '').trim() || null,
    lat: hasPoint ? lat : null,
    lon: hasPoint ? lon : null,
    geocode_source,
    sources: [{ file, row: rowNo }],
    notes,
    raw: { [file]: raw },
  }
}

/** Dedup key: BBL+unit when we have a BBL, else normalised address+unit. */
export const dedupeKey = (/** @type {any} */ r) =>
  (r.bbl ? `bbl:${r.bbl}` : `adr:${addressKey(r.address, r.borough)}`) + `|${(r.unit ?? '').toUpperCase()}`

/** Later files fill gaps; a `true` list flag is sticky; provenance accumulates. */
export function merge(/** @type {any} */ a, /** @type {any} */ b) {
  for (const [k, v] of Object.entries(b)) {
    if (['sources', 'notes', 'raw', 'id'].includes(k)) continue
    if (v == null || v === '') continue
    if (a[k] == null || a[k] === '') a[k] = v
    else if (k === 'listed_by_source' && v === true) a[k] = true
  }
  a.sources.push(...b.sources)
  a.notes.push(...b.notes)
  Object.assign(a.raw, b.raw)
  return a
}

/**
 * Rows -> deduped canonical records with derived columns. The whole pipeline minus file I/O.
 * @param {{file: string, headers: string[], rows: any[][]}[]} tables
 * @param {{importedAt?: string}} [opts]
 */
export function buildRecords(tables, opts = {}) {
  const importedAt = opts.importedAt ?? new Date().toISOString()
  /** @type {Map<string, any>} */ const byKey = new Map()
  /** @type {any[]} */ const sourceMeta = []
  let readRows = 0, dupes = 0, skipped = 0

  for (const { file, headers, rows } of tables) {
    const unmapped = headers.filter((h) => !HEADER_INDEX.has(headerKey(h)))
    let kept = 0
    for (const row of rows) {
      readRows++
      /** @type {Record<string, any>} */ const raw = {}
      headers.forEach((h, i) => { if (row[i] !== '' && row[i] != null) raw[h] = row[i] })
      const rec = canonicalise(raw, file, readRows)
      if (!rec.address && !rec.bbl) { skipped++; continue }
      const k = dedupeKey(rec)
      const existing = byKey.get(k)
      if (existing) { merge(existing, rec); dupes++ } else { byKey.set(k, rec); kept++ }
    }
    sourceMeta.push({ file, rows: rows.length, new_records: kept, imported_at: importedAt, unmapped_columns: unmapped })
  }

  const records = [...byKey.values()]
  return { records, sourceMeta, stats: { readRows, dupes, skipped }, importedAt }
}

/** Second pass: provenance, building keys, per-building unit counts. */
export function finalise(/** @type {any[]} */ records, /** @type {string} */ importedAt) {
  for (const r of records) {
    r.imported_at = importedAt
    r.building_key = r.bbl ? `bbl:${r.bbl.slice(0, 6)}` : `adr:${addressKey(r.address, r.borough)}`
    if (!r.borough && r.bbl) r.borough = BOROUGH_BY_CODE[/** @type {keyof typeof BOROUGH_BY_CODE} */ (Number(r.bbl[0]))] ?? null
  }
  /** @type {Map<string, number>} */ const unitsPer = new Map()
  for (const r of records) unitsPer.set(r.building_key, (unitsPer.get(r.building_key) ?? 0) + 1)
  for (const r of records) r.units_in_building = unitsPer.get(r.building_key)
  return records
}
