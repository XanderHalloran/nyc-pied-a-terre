// Downloads THE LIST — the NYC Department of Finance supplemental market value roll published
// 2026-07-24 for the Non-Primary Residence Property Surcharge — and prepares it for the pipeline.
//
//   npm run fetch                use the cached download if present
//   npm run fetch -- --refresh   re-download from nyc.gov
//
// Sources:
//   nyc.gov/npsurcharge                        the surcharge rules, rates and exemption process
//   .../tar/supplemental_roll_tc1_2027.zip     tax class 1 (one- to three-family homes)
//   .../tar/supplemental_roll_tc2_2027.zip     tax class 2 (condominium and cooperative)
//   64uk-42ks (PLUTO)                          coordinates, floors, units, historic district
//
// The rolls contain EVERY class 1 and class 2 property, not just the affected ones — DOF's page
// says the roll "includes, but is not limited to, those properties that may be subject to the
// surcharge". This script keeps the rows that meet the published value criteria.

import { writeFileSync, mkdirSync, existsSync, createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const DL = 'data/raw/_dl'
const YEAR = '2027'
const BASE = 'https://www.nyc.gov/assets/finance/downloads/tar'
const UA = 'Mozilla/5.0 (compatible; the-list/1.0; +https://thelist.traqqit.com)'

// Published criteria — nyc.gov/npsurcharge, tax years 2026-27 and 2027-28.
const HOME_MIN = 5_000_000   // "more than $5 million"
const UNIT_MIN = 1_000_000   // "$1 million or more"

mkdirSync(DL, { recursive: true })

async function download(/** @type {string} */ name) {
  const path = `${DL}/${name}`
  if (existsSync(path) && !argv.includes('--refresh')) {
    console.log(`  ${name} — cached (${(statSync(path).size / 1e6).toFixed(1)} MB)`)
    return path
  }
  console.log(`  ${name} — downloading…`)
  const res = await fetch(`${BASE}/${name}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(600_000) })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  console.log(`    ${(statSync(path).size / 1e6).toFixed(1)} MB`)
  return path
}

/** ponytail: shell out to the platform's unzip rather than hand-roll a ZIP reader. */
function unzip(/** @type {string} */ zip) {
  if (process.platform === 'win32')
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${DL}' -Force`], { stdio: 'ignore' })
  else execFileSync('unzip', ['-o', '-q', zip, '-d', DL], { stdio: 'ignore' })
}

/** RFC4180-aware line splitter — OWNER contains commas inside quotes. */
function splitCsv(/** @type {string} */ line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

/** Stream a roll, keeping rows that meet the published criteria. */
async function readRoll(/** @type {string} */ file, /** @type {string} */ label) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  /** @type {string[]|null} */ let header = null
  /** @type {any[]} */ const kept = []
  let total = 0
  for await (const line of rl) {
    if (!header) { header = splitCsv(line).map((h) => h.trim()); continue }
    if (!line.trim()) continue
    total++
    const p = splitCsv(line)
    const g = (/** @type {string} */ k) => p[/** @type {string[]} */ (header).indexOf(k)]?.trim() ?? ''
    const fmv = Number(g('FMV') || 0)
    const taxClass = g('TAX_CLASS')
    const isHome = taxClass.startsWith('1')
    if (!(isHome ? fmv > HOME_MIN : fmv >= UNIT_MIN)) continue

    const houseLo = g('HOUSENUM_LO'), houseHi = g('HOUSENUM_HI')
    const house = houseHi && houseHi !== houseLo ? `${houseLo}-${houseHi}` : houseLo
    kept.push({
      bbl: g('PARID').padStart(10, '0'),
      borough: g('BORO'),
      block: g('BLOCK'),
      lot: g('LOT'),
      address: [house, g('STREET_NAME')].filter(Boolean).join(' '),
      unit: g('APTNO') && g('APTNO') !== 'RES' ? g('APTNO') : '',
      zip: g('ZIP_CODE'),
      tax_class: taxClass,
      building_class: g('BLDG_CLASS'),
      owner_name: g('OWNER'),
      market_value: fmv,
      coop_number: g('COOP_NUM'),
      condo_number: g('CONDO_NUMBER'),
      on_published_list: 'Y',
      roll: label,
    })
  }
  console.log(`  ${label}: ${total.toLocaleString()} rows → ${kept.length.toLocaleString()} meet the published criteria`)
  return kept
}

// ------------------------------------------------------------------ 1. the roll
console.log(`DOF supplemental market value roll FY${YEAR} — nyc.gov/npsurcharge`)
for (const z of [`supplemental_roll_tc1_${YEAR}.zip`, `supplemental_roll_tc2_${YEAR}.zip`]) {
  const path = await download(z)
  const csv = `${DL}/supplemental_roll_${z.includes('tc1') ? 'TC1' : 'TC2'}_${YEAR}.csv`
  if (!existsSync(csv) || argv.includes('--refresh')) unzip(path)
}

const records = [
  ...(await readRoll(`${DL}/supplemental_roll_TC1_${YEAR}.csv`, 'tc1')),
  ...(await readRoll(`${DL}/supplemental_roll_TC2_${YEAR}.csv`, 'tc2')),
]
console.log(`  ${records.length.toLocaleString()} properties on the list`)

// ------------------------------------------------------- 2. coordinates + context
// PLUTO is keyed by tax lot. Condo UNIT lots (…1001+) are not in PLUTO — it carries the condo
// BILLING lot instead — so index by borough+block too. Every unit of a condo sits in a building
// on its block, so a block-level point is the honest position for it.
console.log('PLUTO coordinates and building facts (64uk-42ks)…')
const boros = [...new Set(records.map((r) => r.borough))].sort()
/** @type {Map<string, any>} */ const byBbl = new Map()
/** @type {Map<string, any>} */ const byBlock = new Map()
const num = (/** @type {any} */ v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

for (const b of boros) {
  for (let offset = 0; ; offset += 50_000) {
    const qs = new URLSearchParams({
      $select: 'bbl,block,latitude,longitude,yearbuilt,numfloors,unitsres,histdist,zonedist1,council',
      $where: `borocode='${b}' AND latitude IS NOT NULL`,
      $order: 'bbl', $limit: '50000', $offset: String(offset),
    })
    const res = await fetch(`https://data.cityofnewyork.us/resource/64uk-42ks.json?${qs}`, { signal: AbortSignal.timeout(180_000) })
    if (!res.ok) throw new Error(`PLUTO HTTP ${res.status}`)
    /** @type {any[]} */ const rows = await res.json()
    for (const p of rows) {
      byBbl.set(String(Math.round(Number(p.bbl))).padStart(10, '0'), p)
      const bk = `${b}:${num(p.block)}`
      const cur = byBlock.get(bk)
      // the block's largest residential building is the best stand-in for an unmapped unit lot
      if (!cur || num(p.unitsres) > num(cur.unitsres)) byBlock.set(bk, p)
    }
    if (rows.length < 50_000) break
  }
  console.log(`  boro ${b}: ${byBbl.size.toLocaleString()} lots indexed`)
}

const COOP_CLASSES = new Set(['C6', 'C8', 'D0', 'D4'])

let exact = 0, block = 0, none = 0, coopBuildings = 0, coopNoCount = 0
for (const r of records) {
  const hit = byBbl.get(r.bbl)
  const geo = hit ?? byBlock.get(`${r.borough}:${Number(r.block)}`) ?? null
  if (hit) exact++
  else if (geo) block++
  else none++

  // DOF assesses a co-operative as ONE parcel for the whole building, but the surcharge threshold
  // and rate band both apply per UNIT ("condominium and cooperative units valued by DOF at
  // $1,000,000 or more"). So for a co-op building row the value that gets tested is the building
  // value divided by its apartment count — the average apartment — and the building's own total is
  // kept alongside it. Testing the building total instead would charge Co-op City and Roosevelt
  // Island tens of millions a year on apartments DOF values at $55k and $164k.
  const isCoopBuilding = COOP_CLASSES.has(r.building_class) && !r.unit
  const apts = isCoopBuilding ? num(geo?.unitsres) : 0
  if (isCoopBuilding) {
    r.building_market_value = r.market_value
    if (apts > 1) {
      r.apartments = apts
      r.market_value = Math.round(r.market_value / apts)
      coopBuildings++
    } else {
      // No apartment count, so no per-unit value can be derived. Say so rather than guess.
      r.apartments = null
      r.market_value = null
      coopNoCount++
    }
  }

  Object.assign(r, {
    lat: geo ? Number(geo.latitude) : null,
    lon: geo ? Number(geo.longitude) : null,
    geo_precision: hit ? 'lot' : geo ? 'block' : null,
    year_built: num(geo?.yearbuilt) || null,
    floors: num(geo?.numfloors) || null,
    residential_units: num(geo?.unitsres) || null,
    historic_district: geo?.histdist || null,
    zoning: geo?.zonedist1 || null,
    council_district: geo?.council || null,
  })
}

const out = `data/raw/nyc-nps-supplemental-roll-fy${YEAR}.json`
writeFileSync(out, JSON.stringify(records))
console.log(`\n${out}`)
console.log(`  ${records.length.toLocaleString()} properties`)
console.log(`  coordinates: ${exact.toLocaleString()} exact lot · ${block.toLocaleString()} block-level · ${none.toLocaleString()} none`)
console.log(`  co-ops: ${coopBuildings.toLocaleString()} buildings valued per apartment · ${coopNoCount.toLocaleString()} with no apartment count (no per-unit value derivable)`)
console.log('next: npm run ingest')
