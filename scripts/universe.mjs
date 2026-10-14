// The denominator: how many class 1 and class 2 properties the city has in total.
//
//   npm run universe
//
// The roll is only meaningful against the size of the thing it was drawn from. DOF's supplemental
// files are published as EVERY class 1 and class 2 property ("includes, but is not limited to"),
// which is why fetch-nyc.mjs filters 959,710 rows down to the 31,541 that meet the criteria —
// so the same two files are also the citywide denominator, counted the same way, off the same rows.
// That matters: numerator and denominator are the same kind of thing, which is not true if you
// reach for a census household count instead.
//
// Writes data/universe-by-borough.json — a lookup, NOT a source table, so it stays out of data/raw/.
// Kept separate from `npm run fetch` on purpose: fetch re-hits the PLUTO API for minutes, and this
// only ever needs the two CSVs already on disk.

import { writeFileSync, existsSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { BOROUGH_BY_CODE } from '../src/lib/normalize.mjs'

const YEAR = 2027
const DL = 'data/raw/_dl'
const OUT = 'data/universe-by-borough.json'

const files = ['TC1', 'TC2'].map((t) => `${DL}/supplemental_roll_${t}_${YEAR}.csv`)
const missing = files.filter((f) => !existsSync(f))
if (missing.length) {
  console.error(`${missing.join(', ')} not found — run \`npm run fetch\` first (it unzips them).`)
  process.exit(1)
}

/** @type {Record<string, {total: number, class1: number, class2: number}>} */
const byBorough = {}
let total = 0

for (const file of files) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  /** @type {string[]|null} */ let header = null
  let iBoro = -1, iClass = -1
  for await (const line of rl) {
    if (!header) {
      header = line.split(',').map((h) => h.trim())
      iBoro = header.indexOf('BORO')
      iClass = header.indexOf('TAX_CLASS')
      if (iBoro < 0 || iClass < 0) throw new Error(`no BORO/TAX_CLASS column in ${file}`)
      continue
    }
    if (!line.trim()) continue
    // Only the two columns matter and neither is ever quoted, so a plain split beats a real parse
    // over 960k lines. ponytail: if DOF ever quotes BORO, switch to parseDelimited and eat the cost.
    const cells = line.split(',')
    const borough = BOROUGH_BY_CODE[Number(cells[iBoro])]
    if (!borough) continue
    const b = (byBorough[borough] ??= { total: 0, class1: 0, class2: 0 })
    b.total++
    if (String(cells[iClass] ?? '').trim().startsWith('1')) b.class1++
    else b.class2++
    total++
  }
}

writeFileSync(OUT, JSON.stringify({
  fetched_at: new Date().toISOString(),
  source: `DOF supplemental market value roll FY${YEAR}, both tax-class files, unfiltered`,
  note: 'Rows on the same two files the roll is drawn from, so the roll and this count the same '
    + 'kind of unit: a co-op row is a whole building and a condo row is one apartment, on both sides.',
  total,
  by_borough: byBorough,
}, null, 1))

console.log(`universe: ${total.toLocaleString()} class 1+2 properties citywide -> ${OUT}`)
for (const [b, v] of Object.entries(byBorough)) {
  console.log(`  ${b.padEnd(14)} ${v.total.toLocaleString().padStart(9)}  (class 1 ${v.class1.toLocaleString()}, class 2 ${v.class2.toLocaleString()})`)
}
