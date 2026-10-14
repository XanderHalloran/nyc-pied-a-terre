// Last recorded sale price per tax lot, from NYC DOF's annualized sales file.
//
//   npm run sales
//
// Writes data/sales-by-bbl.json — a lookup, NOT a source table, so it lives outside data/raw/
// where ingest would otherwise read it as property records.
//
// Why this dataset (w2pb-icbu, "NYC Citywide Annualized Calendar Sales Update") rather than the
// rolling one: it carries `bbl` directly, so no borough+block+lot reconstruction, and it goes back
// to 2016 instead of a rolling twelve months.

import { writeFileSync, mkdirSync } from 'node:fs'
import { parseDelimited, addressKey } from '../src/lib/normalize.mjs'

const API = 'https://data.cityofnewyork.us/resource/w2pb-icbu.csv'
const OUT = 'data/sales-by-bbl.json'
const PAGE = 50_000

// $0 and nominal-value deeds are everywhere in this file — family transfers, LLC restructuring,
// estate moves. They are not market evidence, so a floor is applied rather than reporting them.
const MIN_PRICE = 100_000
const SINCE = '2019-01-01'

const where = `sale_price>${MIN_PRICE} AND bbl IS NOT NULL AND sale_date>'${SINCE}'`

/**
 * Two indexes, because DOF does not record an apartment sale against the lot the roll uses.
 *
 *   byBbl   exact tax lot. Works for 1–3 family houses.
 *   byAddr  borough + normalised street address, i.e. the BUILDING. Condo and co-op apartment
 *           sales are filed against the building's BASE lot (block 528 Manhattan sells as
 *           ...0008, ...0067) while the roll carries the condo UNIT lot (...1202). Joining those
 *           on BBL matched 12 condos out of 12,375; on address it matches the building, which is
 *           the honest unit of comparison anyway.
 *
 * @typedef {{price: number, date: string, unit: string|null, n: number}} Sale
 */
/** @type {Map<string, Sale>} */ const byBbl = new Map()
/** @type {Map<string, Sale>} */ const byAddr = new Map()
let read = 0

/** @param {Map<string, Sale>} m @param {string} k @param {Sale} s */
function keep(m, k, s) {
  const cur = m.get(k)
  if (!cur) { m.set(k, { ...s }); return }
  cur.n++
  if (s.date > cur.date) { cur.price = s.price; cur.date = s.date; cur.unit = s.unit }
}

for (let offset = 0; ; offset += PAGE) {
  const url = `${API}?$select=bbl,borough,address,sale_price,sale_date,apartment_number`
    + `&$where=${encodeURIComponent(where)}&$order=:id&$limit=${PAGE}&$offset=${offset}`
  process.stdout.write(`\r  fetching sales… ${read.toLocaleString()} rows`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} at offset ${offset}`)
  const { headers, rows } = parseDelimited(await res.text())
  if (!rows.length) break

  const col = /** @param {string} h */ (h) => headers.indexOf(h)
  const [iB, iBo, iA, iP, iD, iU] =
    ['bbl', 'borough', 'address', 'sale_price', 'sale_date', 'apartment_number'].map(col)

  for (const r of rows) {
    read++
    const bbl = String(r[iB] ?? '').trim()
    const price = Number(r[iP])
    const date = String(r[iD] ?? '').slice(0, 10)
    if (!Number.isFinite(price) || price < MIN_PRICE || !date) continue
    const sale = { price, date, unit: String(r[iU] ?? '').trim() || null, n: 1 }

    if (bbl) keep(byBbl, bbl, sale)

    // "204 WEST HOUSTON STREET, 1C" — the unit is a comma-suffixed tail in this file, and
    // addressKey does not strip that form, so take the street part before normalising.
    const boro = String(r[iBo] ?? '').trim() || bbl[0]
    const street = String(r[iA] ?? '').split(',')[0]
    const key = addressKey(street)
    if (boro && key) keep(byAddr, `${boro}|${key}`, sale)
  }
  if (rows.length < PAGE) break
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify({
  source: 'NYC DOF Citywide Annualized Calendar Sales (w2pb-icbu)',
  fetched_at: new Date().toISOString(),
  filter: `sale_price > ${MIN_PRICE} and sale_date after ${SINCE}`,
  caveat: 'A single deed covering several lots repeats its full price on each lot, so an outlier '
    + 'on a multi-parcel sale is the price of the package, not of the one property.',
  rows_read: read,
  lots: byBbl.size,
  buildings: byAddr.size,
  sales: Object.fromEntries(byBbl),
  by_address: Object.fromEntries(byAddr),
}))

console.log(`\r  ${read.toLocaleString()} sales read -> ${byBbl.size.toLocaleString()} tax lots, `
  + `${byAddr.size.toLocaleString()} buildings  ->  ${OUT}`)
