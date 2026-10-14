import type { PolicyFlags, TaxEstimate } from './lib/rules.mjs'

/** Public NYC datasets joined onto a property by BBL. See scripts/enrich.mjs. */
export interface PublicData {
  year_built: number | null
  floors: number | null
  units_res: number | null
  zoning: string | null
  historic_district: string | null
  council_district: string | null
}

/** One canonical property as produced by scripts/ingest.mjs. */
export interface PropertyRecord {
  id: string
  bbl: string | null
  bin: string | null
  address: string
  unit: string | null
  borough: string | null
  zip: string | null
  neighborhood: string | null
  block: string | null
  lot: string | null
  building_class: string | null
  tax_class: string | null
  property_type: string | null
  market_value: number | null
  assessed_value: number | null
  sale_price: number | null
  owner_name: string | null
  owner_occupied: boolean | null
  primary_residence: boolean | null
  star_exemption: boolean | null
  owner_mailing_state: string | null
  listed_by_source: boolean | null
  lat: number | null
  lon: number | null
  geocode_source: 'point' | 'block' | null
  building_key: string
  units_in_building: number
  /** Co-op rows are whole buildings: how many apartments DOF is assessing as one parcel. */
  apartments?: number | null
  /** For a co-op building row, DOF’s value for the whole parcel (market_value is per apartment). */
  building_market_value?: number | null

  // Last recorded sale, joined by `npm run sales`. Deliberately NOT named `sale_price` — that
  // field is a valuation input, and nothing here may ever reach policy.value_field_priority.
  // The surcharge is charged on DOF's value; this is only context beside it.
  last_sale_price?: number | null
  last_sale_date?: string | null
  /** Apartment identifier as DOF recorded it, when the sale was of one unit. */
  last_sale_unit?: string | null
  /** `lot` = this property itself. `building` = the most recent sale of any apartment in it. */
  last_sale_match?: 'lot' | 'building'
  /** Recorded sales matching that key since 2019, so a single sale can be told from a pattern. */
  sales_in_lot?: number | null

  // StreetEasy's own address-to-listing crosswalk, joined by `npm run listings`. An id, not a
  // price: an asking price is not DOF's market value and never reaches the surcharge calculation.
  listing_id?: string | null
  /** Apartment designator as StreetEasy recorded it on that listing. */
  listing_unit?: string | null
  /** `unit` = the apartment matched too. `building` = only the street address did. */
  listing_match?: 'unit' | 'building'

  /** Building context lifted onto the record at ingest. */
  public?: PublicData
  sources: { file: string; row: number }[]
  notes: string[]
  imported_at: string
}

/** A record with its policy evaluation and a pre-lowered search haystack. */
export interface Row extends PropertyRecord {
  flags: PolicyFlags
  tax: TaxEstimate
  type: 'condo' | 'coop' | 'home_1_3' | 'unknown'
  hay: string
}

export interface Dataset {
  meta: {
    generated_at: string
    policy_version: string
    sources: { file: string; rows: number; new_records: number; imported_at: string; unmapped_columns: string[] }[]
    counts: Record<string, number>
    geocoding: Record<string, number>
    /** Every class 1 + 2 property the city has, from `npm run universe`. Null if never built. */
    universe?: {
      fetched_at: string
      source: string
      note: string
      total: number
      by_borough: Record<string, { total: number; class1: number; class2: number }>
    } | null
  }
  records: PropertyRecord[]
}

export interface BuildingRow {
  building_key: string
  address: string
  borough: string | null
  bbl: string | null
  units: number
  listed: number
  inferred: number
  needs_review: number
  total_value: number
  valued_units: number
  avg_value: number | null
  dominant_type: string
  types: Record<string, number>
  total_current_tax: number
  total_surcharge: number
  surcharge_pct: number | null
}

export type { PolicyFlags, TaxEstimate }
