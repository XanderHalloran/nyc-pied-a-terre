// Real taxable assessed values and DOF's own co-op apartment counts, for FY2027.
//
//   npm run assess
//
// Writes data/assess-by-bbl.json — a lookup, NOT a source table, so it stays out of data/raw/.
//
// Why this exists: the supplemental surcharge roll publishes market value but no assessed value,
// so the "tax now" figure was estimated as market x the statutory ratio (45% for class 2). That is
// badly wrong for condos in low-rise buildings, which fall into assessment-capped subclasses —
// measured 7.5x too high on one Manhattan R6. DOF publishes the actual billable figure, so use it.
//
// The bonus is `coop_apts`: DOF's own count of apartments in a co-op. The roll values a co-op as
// one parcel and the threshold applies per apartment, so that divisor decides who is charged. It
// was PLUTO's `unitsres`; this is the number DOF itself uses.

import { writeFileSync, mkdirSync } from 'node:fs'
import { parseDelimited } from '../src/lib/normalize.mjs'

const API = 'https://data.cityofnewyork.us/resource/8y4t-faws.csv'
const OUT = 'data/assess-by-bbl.json'
const PAGE = 50_000
const YEAR = '2027'
// Every record on the surcharge roll cleared $1M (class 2) or $5M (class 1) market value, so this
// is a safe superset that avoids pulling all 2.36M FY2027 rows.
const MIN_MKT = 800_000

const where = `year='${YEAR}' AND curmkttot>${MIN_MKT}`
const FIELDS = 'parid,curmkttot,curacttot,curtrntot,curtxbtot,curtxbextot,curtaxclass,coop_apts,units,period'

/** @type {Map<string, any>} */
const byBbl = new Map()
let read = 0

for (let offset = 0; ; offset += PAGE) {
  const url = `${API}?$select=${FIELDS}&$where=${encodeURIComponent(where)}&$order=:id&$limit=${PAGE}&$offset=${offset}`
  process.stdout.write(`\r  fetching assessments… ${read.toLocaleString()} rows, ${byBbl.size.toLocaleString()} lots`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} at offset ${offset}`)
  const { headers, rows } = parseDelimited(await res.text())
  if (!rows.length) break

  const col = /** @param {string} h */ (h) => headers.indexOf(h)
  const i = Object.fromEntries(FIELDS.split(',').map((f) => [f, col(f)]))
  const num = /** @param {any} v */ (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

  for (const r of rows) {
    read++
    const bbl = String(r[i.parid] ?? '').trim().padStart(10, '0')
    if (!bbl || bbl === '0000000000') continue
    const period = num(r[i.period]) ?? 0
    const prev = byBbl.get(bbl)
    // The file carries a row per period; keep the latest, which is the current billable state.
    if (prev && prev.period >= period) continue
    byBbl.set(bbl, {
      period,
      market: num(r[i.curmkttot]),
      actual: num(r[i.curacttot]),
      transitional: num(r[i.curtrntot]),
      // What the bill is actually computed on, less the exempt portion of it.
      taxable: num(r[i.curtxbtot]),
      exempt: num(r[i.curtxbextot]),
      tax_class: String(r[i.curtaxclass] ?? '').trim() || null,
      coop_apts: num(r[i.coop_apts]) || null,
      units: num(r[i.units]) || null,
    })
  }
  if (rows.length < PAGE) break
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify({
  source: `NYC DOF Property Valuation and Assessment Data (8y4t-faws), year ${YEAR}`,
  fetched_at: new Date().toISOString(),
  filter: `year ${YEAR}, current market value over ${MIN_MKT}`,
  rows_read: read,
  lots: byBbl.size,
  assess: Object.fromEntries(byBbl),
}))

console.log(`\r  ${read.toLocaleString()} rows read -> ${byBbl.size.toLocaleString()} lots  ->  ${OUT}`)
