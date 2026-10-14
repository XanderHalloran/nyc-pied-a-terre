// Load, decorate, filter, aggregate, export. 12k records is small enough that a plain array
// beats anything with an index — no DuckDB, no SQLite, no worker. Re-measure past ~200k rows.

import { evaluate, explainFlags, classify, estimateTax, explainTax, onCliff, deadlines, POLICY, aggregateBuildings } from './rules.mjs'
import { toCsvRow } from './normalize.mjs'
import type { Dataset, PropertyRecord, Row, BuildingRow } from '../types'
import { BANDS, type Filters } from '../state'

export { POLICY, explainFlags, explainTax, onCliff, deadlines }

const BASE = import.meta.env.BASE_URL

export async function loadDataset(): Promise<{ rows: Row[]; meta: Dataset['meta'] }> {
  const res = await fetch(`${BASE}properties.json`)
  if (!res.ok) throw new Error(`properties.json not found (${res.status}). Run: npm run fetch && npm run ingest`)
  const data: Dataset = await res.json()
  return { rows: data.records.map(decorate), meta: data.meta }
}

export async function loadBoroughs(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(`${BASE}boroughs.geojson`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export const decorateAll = (records: PropertyRecord[]): Row[] => records.map(decorate)

function decorate(r: PropertyRecord): Row {
  const flags = evaluate(r)
  const type = classify(r).type
  return {
    ...r,
    flags,
    tax: estimateTax(r, flags),
    type,
    hay: [r.address, r.unit, r.borough, r.zip, r.neighborhood, r.bbl, r.bin, r.building_class, r.owner_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }
}

// ------------------------------------------------------------------ filtering

/** All query tokens must appear somewhere in the haystack. Cheap, predictable, no dep. */
function matchesQuery(hay: string, tokens: string[]) {
  for (const t of tokens) if (!hay.includes(t)) return false
  return true
}

export function applyFilters(rows: Row[], f: Filters): Row[] {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const bands = BANDS.filter((b) => f.bands.includes(b.id))
  const bc = f.buildingClass.trim().toUpperCase()

  return rows.filter((r) => {
    if (tokens.length && !matchesQuery(r.hay, tokens)) return false
    if (f.boroughs.length && !f.boroughs.includes(r.borough ?? '')) return false
    if (f.types.length && !f.types.includes(r.type)) return false
    if (f.status.length && !f.status.includes(r.flags.status)) return false
    if (f.buckets.length && !f.buckets.includes(r.flags.bucket)) return false
    if (f.taxClass.length && !f.taxClass.includes((r.tax_class ?? '')[0] ?? '')) return false
    if (f.zip && !(r.zip ?? '').startsWith(f.zip.trim())) return false
    if (bc && !(r.building_class ?? '').startsWith(bc)) return false
    if (f.minValue != null && !(r.flags.value_used != null && r.flags.value_used >= f.minValue)) return false
    if (f.minUnits != null && r.units_in_building < f.minUnits) return false
    if (f.onlyReview && !r.flags.review.length) return false
    if (f.onlyNearCutoff && !r.flags.near_cutoff) return false
    if (f.onlyCliff && !onCliff(r.tax, r.flags.value_used)) return false
    if (f.onlyNoOccupancy && r.flags.occupancy !== 'unknown') return false
    if (f.onlyMissing && !(r.flags.value_used == null || r.type === 'unknown' || !r.building_class)) return false
    if (bands.length) {
      const v = r.flags.value_used
      if (v == null || !bands.some((b) => v >= b.min && v < b.max)) return false
    }
    return true
  })
}

// ----------------------------------------------------------------- buildings

export function buildings(rows: Row[]): BuildingRow[] {
  // Feed the classified type, not the raw source column — most city files never state one.
  return aggregateBuildings(rows.map((r) => ({ ...r, property_type: r.type }))) as BuildingRow[]
}

/**
 * How many homes one row's money figures describe. A co-op row is a whole BUILDING whose value,
 * surcharge and existing tax were all divided down to one apartment at ingest, so any citywide
 * total has to multiply them back — otherwise a 10,914-apartment co-op counts as one flat.
 */
export const homesOnRow = (r: Row) => (r.type === 'coop' && (r.apartments ?? 0) >= 2 ? (r.apartments as number) : 1)

/** Citywide totals for the current filter — the "in context" numbers. */
export function taxTotals(rows: Row[]) {
  let current = 0, currentCharged = 0, surcharge = 0, charged = 0, unmodellable = 0, cliffN = 0, cliffAtStake = 0
  for (const r of rows) {
    const n = homesOnRow(r)
    current += (r.tax.current ?? 0) * n
    if (r.tax.surcharge != null) {
      surcharge += r.tax.surcharge * n
      if (r.tax.surcharge > 0) { charged++; currentCharged += (r.tax.current ?? 0) * n }
      if (onCliff(r.tax, r.flags.value_used)) { cliffN++; cliffAtStake += (r.tax.appeal_saving ?? 0) * n }
    } else if (r.flags.affected) unmodellable++
  }
  return {
    current, currentCharged, surcharge, charged, unmodellable, cliffN, cliffAtStake,
    // Surcharge over the tax paid by the properties that actually owe it. Dividing by every
    // record's tax instead — including the thousands of co-op buildings under the line — halved
    // the figure and made it read like a citywide average nobody actually experiences.
    pct: currentCharged > 0 ? surcharge / currentCharged : null,
    pctAll: current > 0 ? surcharge / current : null,
  }
}

/**
 * Sale price over DOF's value, by property type — the measured version of the claim that condos and
 * co-ops sell for roughly 3x what the city values them at. Computed so the copy cannot drift from
 * the data, and excluding multi-unit lots, whose ratio compares one apartment to a whole block.
 */
export function saleRatios(rows: Row[]) {
  const buckets: Record<string, number[]> = {}
  for (const r of rows) {
    const m = marketGap(r)
    if (!m?.ratio || m.multiUnitLot) continue
    ;(buckets[r.type] ??= []).push(m.ratio)
  }
  const out: Record<string, { n: number; p25: number; med: number; p75: number }> = {}
  for (const [k, a] of Object.entries(buckets)) {
    if (a.length < 30) continue
    a.sort((x, y) => x - y)
    const q = (p: number) => a[Math.floor(a.length * p)]
    out[k] = { n: a.length, p25: q(0.25), med: q(0.5), p75: q(0.75) }
  }
  return out
}

/** Other records in the same building. */
export const nearby = (rows: Row[], r: Row) =>
  rows.filter((x) => x.building_key === r.building_key && x.id !== r.id)

// ------------------------------------------------------------------- exports

const PROPERTY_COLUMNS = [
  'id', 'address', 'unit', 'borough', 'zip', 'neighborhood', 'bbl', 'bin', 'block', 'lot',
  'building_class', 'tax_class', 'property_type', 'market_value', 'assessed_value', 'sale_price',
  'owner_mailing_state', 'owner_occupied', 'star_exemption', 'listed_by_source',
  'lat', 'lon', 'geocode_source', 'units_in_building', 'building_key', 'imported_at',
  'last_sale_price', 'last_sale_date', 'last_sale_unit', 'last_sale_match', 'sales_in_lot',
] as const

const FLAG_COLUMNS = [
  'affected', 'status', 'confidence', 'rule_id', 'threshold', 'value_used', 'value_field',
  'near_cutoff', 'occupancy', 'bucket',
] as const

const TAX_COLUMNS = ['tax_class', 'assessed', 'assessed_source', 'current', 'surcharge', 'band', 'rate', 'total', 'increase_pct', 'next_edge', 'cliff', 'floor_edge', 'appeal_drop', 'appeal_saving'] as const

export function propertiesCsv(rows: Row[]) {
  const header = [
    ...PROPERTY_COLUMNS,
    ...FLAG_COLUMNS.map((c) => `flag_${c}`),
    'flag_review', 'flag_explanation',
    ...TAX_COLUMNS.map((c) => `tax_${c}`),
    'tax_current_formula', 'tax_surcharge_formula', 'tax_caveats',
    'source_files',
  ]
  const lines = rows.map((r) =>
    toCsvRow([
      ...PROPERTY_COLUMNS.map((c) => (r[c] == null ? '' : String(r[c]))),
      ...FLAG_COLUMNS.map((c) => (r.flags[c] == null ? '' : String(r.flags[c]))),
      r.flags.review.join('; '),
      explainFlags(r).explain,
      ...TAX_COLUMNS.map((c) => {
        const v = r.tax[c]
        return v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
      }),
      ...(() => { const t = explainTax(r, r.flags); return [t.current_formula, t.surcharge_formula, t.caveats.join('; ')] })(),
      (r.sources ?? []).map((s) => `${s.file}:${s.row}`).join('; '),
    ]),
  )
  return [toCsvRow(header), ...lines].join('\n')
}

export function buildingsCsv(bs: BuildingRow[]) {
  const cols = ['building_key', 'address', 'borough', 'bbl', 'units', 'listed', 'inferred', 'needs_review', 'total_value', 'avg_value', 'dominant_type', 'total_current_tax', 'total_surcharge', 'surcharge_pct'] as const
  return [toCsvRow([...cols]), ...bs.map((b) => toCsvRow(cols.map((c) => (b[c] == null ? '' : String(b[c])))))].join('\n')
}

export function download(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

// ------------------------------------------------------- the lay-reader layer

/**
 * The four things a non-specialist actually wants: is it on the list, why, how much, what now.
 * Same facts as flags.explain, without the hedging vocabulary — the hedges live in `caveat`.
 */
/**
 * DOF assesses a co-op as one parcel for the entire building, so a co-op row on the roll is a
 * building, not a home. Everything user-facing has to say so — presenting $136M as "a co-op"
 * would be the single most misleading thing this tool could do.
 */
export function coopBuilding(r: Row) {
  const apts = r.apartments ?? 0
  if (r.type !== 'coop' || apts < 2) return null
  // The record already carries the AVERAGE apartment: the threshold and rate band apply per unit,
  // so `market_value` was divided by the apartment count at ingest. Building totals multiply back.
  return {
    apartments: apts,
    perApartment: r.flags.value_used,
    buildingValue: r.building_market_value ?? null,
    perApartmentSurcharge: r.tax.surcharge,
    buildingSurcharge: r.tax.surcharge != null ? r.tax.surcharge * apts : null,
  }
}

export interface CoopRank {
  row: Row
  apartments: number
  perApartment: number
  perApartmentSurcharge: number
  buildingSurcharge: number
  buildingValue: number | null
  rate: number
}

/**
 * Co-op buildings ranked by what the surcharge works out to per apartment — the figure that
 * actually reaches a shareholder, rather than the building total DOF publishes.
 *
 * Only buildings with a known apartment count can be ranked; `unranked` counts the rest so the
 * board never implies it covers every co-op.
 */
export function coopLeaderboard(rows: Row[]): { ranked: CoopRank[]; unranked: number } {
  const ranked: CoopRank[] = []
  let unranked = 0
  for (const r of rows) {
    if (r.type !== 'coop') continue
    const c = coopBuilding(r)
    if (!c || c.perApartmentSurcharge == null || c.perApartment == null || !r.tax.rate) {
      if (r.flags.affected) unranked++
      continue
    }
    ranked.push({
      row: r,
      apartments: c.apartments,
      perApartment: c.perApartment,
      perApartmentSurcharge: c.perApartmentSurcharge,
      buildingSurcharge: c.buildingSurcharge ?? 0,
      buildingValue: c.buildingValue,
      rate: r.tax.rate,
    })
  }
  ranked.sort((a, b) => b.perApartmentSurcharge - a.perApartmentSurcharge)
  return { ranked, unranked }
}

export function plainVerdict(r: Row) {
  const t = r.tax
  const coop = coopBuilding(r)
  const typeWord = coop ? 'co-op building' : r.type === 'condo' ? 'condo' : r.type === 'coop' ? 'co-op' : r.type === 'home_1_3' ? 'house' : 'property'
  const threshold = r.flags.threshold

  // On DOF's roll, but under every threshold once the rule is applied the way DOF applies it —
  // per apartment for a co-op. Nothing is owed, and saying so is the whole job of this branch.
  // Most of the roll's co-op buildings land here, so getting it wrong alarms a lot of people
  // who owe nothing.
  const listedBelow = r.flags.status === 'listed' && !t.surcharge && r.flags.bucket === 'below_threshold'

  const headline =
    listedBelow ? 'On the city’s list, but under the line'
    : r.flags.status === 'listed' ? 'On the city’s list'
    : r.flags.status === 'inferred' ? 'Not on the list, but it fits the criteria'
    : 'Does not meet the criteria'

  // The "would have been" threshold for an unflagged property comes from the policy, never from
  // a constant retyped into the UI.
  const wouldBe = POLICY.thresholds.find((x) => x.applies_to.includes(r.type))?.min_value ?? null

  const why =
    listedBelow
      ? coop
        ? `DOF assesses this co-op as one parcel of ${money(coop.buildingValue)} covering ${coop.apartments} apartments, which is why it appears on the roll. But the threshold applies per apartment, and at ${money(coop.perApartment)} each it is under the ${money(threshold ?? POLICY.thresholds.find((x) => x.applies_to.includes('coop'))?.min_value ?? null)} line. No surcharge is owed.`
        : `It is on the published roll, but DOF values it at ${money(r.flags.value_used)}, under the ${money(threshold ?? null)} line for ${typeWord}s. No surcharge is owed.`
    : r.flags.status === 'not_flagged'
      ? r.flags.value_used == null
        ? `This ${typeWord} has no valuation in the data, so nothing could be checked. That is not the same as being in the clear.`
        : wouldBe != null
          ? `This ${typeWord} is valued at ${money(r.flags.value_used)}, under the ${money(wouldBe)} line for ${typeWord}s.`
          : `This ${typeWord} is valued at ${money(r.flags.value_used)}, and no reported threshold covers this kind of property.`
      : coop && r.flags.value_used != null
        ? `DOF values this co-op as one parcel of ${money(coop.buildingValue)} across ${coop.apartments} apartments, so the average apartment is worth ${money(coop.perApartment)} to the city. That per-apartment figure is what the $1M line and the rate band are applied to.`
      : threshold != null && r.flags.value_used != null
        ? `It is a ${typeWord} valued by DOF at ${money(r.flags.value_used)}, at or above the ${money(threshold)} line that applies to ${typeWord}s.`
        : `It is a ${typeWord}. The city listed it, but this record carries no valuation to explain why.`

  const increase = t.increase_pct == null ? null : t.increase_pct >= 10 ? `${t.increase_pct.toFixed(0)} times` : `about ${(t.increase_pct * 100).toFixed(0)}%`
  const cost = !t.surcharge || !t.rate
    ? null
    : coop
      ? `At ${(t.rate * 100).toFixed(2)}%, that works out to ${moneyFull(coop.perApartmentSurcharge)} a year per apartment, about ${moneyFull(coop.buildingSurcharge)} across the building, billed to the corporation, before any shareholder's exemption.`
      : `The surcharge would be ${moneyFull(t.surcharge)} a year, ${(t.rate * 100).toFixed(2)}% of the full DOF value` +
        (t.current ? `, on top of roughly ${moneyFull(t.current)} in property tax already paid. That is an increase of ${increase}.` : '.')

  const next =
    r.flags.status === 'not_flagged' ? null
    : listedBelow
      ? 'DOF’s roll “includes, but is not limited to, those properties that may be subject to the surcharge”. Being on it was never the same as owing it. There is nothing to apply for here.'
      // "None of that is in public records" was the earlier wording, and it implied the city
      // *could not* know. It could, for the owner at least — the state already checks primary
      // residence against income tax filings for STAR. What no record establishes is the rest of
      // the exemption: which tenant, relative or LLC member lives where. Claim the narrower thing.
      : 'It is not owed if the home is a main residence: the owner, a tenant, an immediate family member, someone holding a majority stake in an owning company, or the sole beneficiary of a trust. No public record establishes those relationships, so DOF settles it by application. The exemption deadline is 6 October 2026.'

  // `status` drives the colour. A property that owes nothing must not be painted like one that does.
  return { headline, why, cost, next, listedBelow, status: listedBelow ? 'not_flagged' : r.flags.status }
}

/** One legible sentence of building context, when the public-data layer has been pulled in. */
export function buildingFacts(r: Row): string | null {
  const p = r.public
  if (!p) return null
  const bits: string[] = []
  if (p.year_built) bits.push(`Built ${p.year_built}`)
  if (p.floors) bits.push(`${p.floors} floor${p.floors === 1 ? '' : 's'}`)
  if (p.units_res) bits.push(`${p.units_res} home${p.units_res === 1 ? '' : 's'}`)
  if (r.type === 'coop' && (r.apartments ?? 0) > 1) bits.push('assessed as one parcel')
  if (p.historic_district) bits.push(p.historic_district)
  return bits.length ? bits.join(' · ') : null
}

/**
 * What the market says, next to what DOF says. The two numbers are not measuring the same thing
 * for most of this roll and the copy has to say so: state law makes DOF value condos and co-ops
 * from comparable RENTAL income, which is why a unit that would list at $3M carries a DOF value
 * near $900k. Class 1 houses are the apples-to-apples case.
 *
 * Returns null when there is no recorded sale to compare against — an absent sale is not evidence
 * of anything, and this never guesses a value.
 */
export function marketGap(r: Row) {
  const dof = r.flags.value_used
  const sale = r.last_sale_price
  if (sale == null || !r.last_sale_date) return null
  return {
    sale,
    date: r.last_sale_date,
    unit: r.last_sale_unit ?? null,
    // For a co-op row this `dof` is the per-apartment figure, so it is compared against one
    // apartment that actually changed hands — the same unit of measurement on both sides.
    dof,
    ratio: dof && dof > 0 ? sale / dof : null,
    // Rental-income valuation applies to condos and co-ops; a house is valued to sell.
    statutory: r.type === 'condo' || r.type === 'coop',
    // 'lot' is this property itself. 'building' is the most recent sale of any apartment in it —
    // DOF files apartment sales against the building's base lot, not the roll's unit lot.
    scope: r.last_sale_match ?? 'lot',
    others: Math.max(0, (r.sales_in_lot ?? 1) - 1),
    // A single condominium lot (DOF class R9) can hold an entire apartment block — one deed, one
    // tax lot, many homes. Its value covers all of them, so one apartment's sale price is not a
    // comparable and the multiple would be meaningless rather than merely imprecise.
    multiUnitLot: multiUnitLot(r),
  }
}

/** One tax lot, one deed, many apartments — so a per-apartment comparison does not apply. */
export function multiUnitLot(r: Row) {
  if (r.type === 'coop') return false // co-ops are handled by the per-apartment division
  const homes = r.public?.units_res ?? 0
  return !r.unit && homes > 3
}

/** Listing sites, for the market side of that comparison. See `directListing` on how exact these are. */
export function listingLinks(r: Row) {
  // The roll carries house-number ranges ("163-15-163-19") and DOF's own apartment format, so
  // these are searches rather than deep links to a known listing page. Address only, no unit:
  // a unit suffix in the query is more likely to zero out the result than to sharpen it.
  const street = r.address?.replace(/\s+/g, ' ').trim()
  if (!street) return []
  const q = [street, r.borough, 'NY', r.zip].filter(Boolean).join(', ')
  const isCoopBuilding = r.type === 'coop' && (r.apartments ?? 0) >= 2
  const direct = directListing(r)
  return [
    direct ? { label: 'StreetEasy listing', url: direct.url, note: direct.note } : {
      label: 'StreetEasy',
      url: `https://streeteasy.com/search?q=${encodeURIComponent(q)}`,
      note: isCoopBuilding ? 'listings in this building, because a co-op row is the whole building' : 'asking prices and sale history',
    },
    {
      label: 'Zillow',
      url: `https://www.zillow.com/homes/${encodeURIComponent(q)}_rb/`,
      note: 'Zestimate, an algorithmic estimate rather than an appraisal',
    },
  ]
}

/**
 * StreetEasy's own address-to-listing crosswalk, joined at ingest — a real listing page rather
 * than a search box. Returns null when the address is not in it, which is the common case: the
 * crosswalk only knows addresses that have been listed for sale.
 *
 * How exact the link is depends on `listing_match`, and the wording says which:
 *   unit      the apartment designator matched as well, so this is the property on the roll.
 *   building  only the street address matched. For a co-op row, which IS the building, that is
 *             the right unit of measurement anyway; for one apartment in a condo it is a
 *             neighbour, and useful as a comparable rather than as this home's asking price.
 * The export carries no borough, so a numbered street shared across boroughs can point at the
 * wrong one. That is why nothing computed here ever feeds the surcharge.
 */
export function directListing(r: Row) {
  if (!r.listing_id) return null
  const url = `https://streeteasy.com/sale/${r.listing_id}`
  const exact = r.listing_match === 'unit'
  const isCoopBuilding = r.type === 'coop' && (r.apartments ?? 0) >= 2
  const note = exact
    ? `the listing for unit ${r.listing_unit}, matched by address and apartment`
    : isCoopBuilding
      ? 'the most recent listing in this building — a co-op row is the whole building'
      : r.unit
        ? `the most recent listing at this address${r.listing_unit ? ` (unit ${r.listing_unit})` : ''}, not necessarily this apartment`
        : 'the most recent listing at this address'
  return { url, note, exact, unit: r.listing_unit ?? null }
}

/**
 * Where to check this property against the city's own records. Every one of these was
 * confirmed reachable; ACRIS and HPD are search forms, so those get a "paste the BBL" note.
 */
export function officialLinks(r: Row) {
  const boro = r.bbl ? r.bbl[0] : null
  const links: { label: string; url: string; note?: string }[] = []
  if (r.bbl && boro && r.block && r.lot) {
    links.push({ label: 'City parcel record', url: `https://propertyinformationportal.nyc.gov/parcels/parcel/${r.bbl}`, note: 'ownership, assessments, tax map' })
    links.push({ label: 'Zoning & land use (ZoLa)', url: `https://zola.planning.nyc.gov/l/lot/${boro}/${r.block}/${r.lot}` })
    links.push({ label: 'Neighbourhood data (OASIS)', url: `http://www.oasisnyc.net/map.aspx?zoomto=lot:${r.bbl}` })
  }
  links.push({ label: 'Deeds & mortgages (ACRIS)', url: 'https://a836-acris.nyc.gov/DS/DocumentSearch/BBL', note: r.bbl ? `search by BBL, paste ${r.bbl}` : 'search by address' })
  links.push({ label: 'Housing complaints (HPD)', url: 'https://hpdonline.nyc.gov/hpdonline/', note: 'search by address' })
  if (r.lat != null && r.lon != null)
    links.push({ label: 'Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${r.lat},${r.lon}` })
  return links
}

// ----------------------------------------------------------------- formatting

/** Compact, and never "$2576.5M" — the roll totals reach ten figures. Trailing .0 is dropped. */
const compact = (n: number, div: number, suffix: string, dp: number) =>
  `$${(n / div).toFixed(dp).replace(/\.0+$/, '')}${suffix}`

export const money = (n: number | null | undefined) =>
  n == null ? '—'
    : n >= 1e9 ? compact(n, 1e9, 'B', 2)
    : n >= 1e6 ? compact(n, 1e6, 'M', n >= 1e7 ? 1 : 2)
    : `$${Math.round(n).toLocaleString('en-US')}`

export const moneyFull = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)

/** Percentages here run from 0% to several thousand — keep them readable at both ends. */
export const pct = (n: number | null | undefined) =>
  n == null ? '—' : n >= 10 ? `+${n.toFixed(0)}×` : `+${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`

/**
 * A plain share, e.g. "79%". Distinct from `pct` on purpose: that one formats an INCREASE and
 * prepends a +, which turns "79% of the gross" into "+79% of the gross" — a different claim.
 */
export const share = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`

export const TYPE_LABEL: Record<string, string> = POLICY.type_labels

export const TYPE_COLOR: Record<string, string> = {
  condo: '#f0a13a',
  coop: '#4ea8de',
  home_1_3: '#8ac926',
  unknown: '#9aa4b2',
}

/**
 * Borough identity, for the macro flows. A second dimension, so it needs its own hues rather than
 * borrowing the type colours — a borough ribbon must never read as "condo".
 *
 * Both sets were produced by the palette validator (OKLCH lightness band, chroma floor, adjacent
 * CVD ΔE, normal-vision floor, contrast against the surface) and both pass every check. The order
 * below is the order they were validated in AND the order everything stacks in, because the CVD
 * check only tests adjacent pairs — reordering these silently invalidates them. Dark and light are
 * separate steps rather than one set reused, which is why the value is a CSS variable.
 */
export const BOROUGH_ORDER = ['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'] as const

export const BOROUGH_COLOR: Record<string, string> = {
  Manhattan: 'var(--boro-1)',
  Bronx: 'var(--boro-2)',
  Brooklyn: 'var(--boro-3)',
  Queens: 'var(--boro-4)',
  'Staten Island': 'var(--boro-5)',
}

export const STATUS_LABEL: Record<string, string> = {
  listed: 'On city list',
  inferred: 'Inferred affected',
  not_flagged: 'Not flagged',
}

export const REVIEW_LABEL: Record<string, string> = Object.fromEntries(
  POLICY.review_triggers.map((t) => [t.id, t.label]),
)
export const REVIEW_NOTE: Record<string, string> = Object.fromEntries(
  POLICY.review_triggers.map((t) => [t.id, t.note]),
)

export const GEOCODE_LABEL: Record<string, string> = {
  point: 'Exact parcel from the city',
  block: 'The building on this block, because condo unit lots are not mapped individually',
}
