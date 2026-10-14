// StreetEasy listing crosswalk: address -> the listing page for it.
//
//   npm run listings
//
// Reads data/latest_listing.csv — a direct address-to-URL export, one row per address, supplied by
// StreetEasy rather than scraped. Writes data/listings-by-address.json, a lookup like the other
// data/*-by-*.json files: NOT a source table, so it stays out of data/raw/ where ingest would read
// it as property records.
//
// Why a lookup keyed on address and not on BBL: the export carries no BBL, no borough and no ZIP —
// listing_id, address, unit, url. Address is the only join there is. That has a cost, and ingest
// records which kind of match it got so the app can word the link honestly.

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { parseDelimited, addressKey } from '../src/lib/normalize.mjs'

const SRC = 'data/latest_listing.csv'
const OUT = 'data/listings-by-address.json'

// A building with more listings than this is a tower, and the extras add nothing a reader would
// click. ponytail: keep the first few, raise it if a building view ever wants the full set.
const PER_ADDRESS = 4

if (!existsSync(SRC)) {
  console.error(`${SRC} not found — drop the StreetEasy export there and re-run.`)
  process.exit(1)
}

const { headers, rows } = parseDelimited(readFileSync(SRC, 'utf8'))
const [iId, iAddr, iUnit] = ['listing_id', 'address', 'unit'].map((h) => headers.indexOf(h))
if (iId < 0 || iAddr < 0) throw new Error(`unexpected columns in ${SRC}: ${headers.join(', ')}`)

/** @type {Record<string, [string, string][]>} address key -> [listing id, unit][] */
const listings = {}
let kept = 0
let skipped = 0

for (const r of rows) {
  const key = addressKey(r[iAddr])
  const id = String(r[iId] ?? '').trim()
  // A neighbourhood name in the address column ("BAYSIDE") keys to nothing a property can match,
  // and an id-less row has no URL to build. Both are dropped rather than stored as near-misses.
  if (!key || !id || !/^\d+$/.test(id)) { skipped++; continue }
  const at = (listings[key] ??= [])
  if (at.length >= PER_ADDRESS) continue
  at.push([id, String(r[iUnit] ?? '').trim()])
  kept++
}

writeFileSync(OUT, JSON.stringify({
  fetched_at: new Date().toISOString(),
  source: SRC,
  url_template: 'https://streeteasy.com/sale/{id}',
  counts: { rows: rows.length, kept, skipped, addresses: Object.keys(listings).length },
  listings,
}))

console.log(`listings: ${kept.toLocaleString()} of ${rows.length.toLocaleString()} rows over `
  + `${Object.keys(listings).length.toLocaleString()} addresses -> ${OUT}`
  + (skipped ? ` (${skipped.toLocaleString()} unusable rows dropped)` : ''))
