// Address / borough / value normalisation shared by the Node ingest pipeline and the browser app.
// Plain JS + JSDoc so `node scripts/ingest.mjs` and Vite both consume it with no build step,
// while `tsc --noEmit` still type-checks it (checkJs) and every .tsx caller.
// Checks live in scripts/check.mjs — `npm run check`.

/** @typedef {'condo'|'coop'|'home_1_3'|'unknown'} PropertyType */

const BOROUGHS = /** @type {const} */ ([
  'Manhattan',
  'Bronx',
  'Brooklyn',
  'Queens',
  'Staten Island',
])

/** DOF borough code -> name. Also the BBL first digit. */
export const BOROUGH_BY_CODE = { 1: 'Manhattan', 2: 'Bronx', 3: 'Brooklyn', 4: 'Queens', 5: 'Staten Island' }

const BOROUGH_ALIASES = new Map(
  Object.entries({
    manhattan: 'Manhattan', mn: 'Manhattan', ny: 'Manhattan', 'new york': 'Manhattan', 1: 'Manhattan',
    bronx: 'Bronx', bx: 'Bronx', 'the bronx': 'Bronx', 2: 'Bronx',
    brooklyn: 'Brooklyn', bk: 'Brooklyn', kings: 'Brooklyn', 3: 'Brooklyn',
    queens: 'Queens', qn: 'Queens', qns: 'Queens', 4: 'Queens',
    'staten island': 'Staten Island', si: 'Staten Island', richmond: 'Staten Island', 5: 'Staten Island',
  }),
)

/**
 * @param {unknown} v
 * @returns {string|null} canonical borough name, or null if unrecognisable
 */
export function normBorough(v) {
  if (v == null) return null
  const k = String(v).trim().toLowerCase().replace(/\s+/g, ' ')
  if (!k) return null
  return BOROUGH_ALIASES.get(k) ?? (BOROUGHS.includes(/** @type {any} */ (k)) ? k : null)
}

// Street-type and directional abbreviations, expanded so "5th Ave" and "FIFTH AVENUE" collide.
const STREET_WORDS = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', rd: 'road',
  dr: 'drive', ln: 'lane', ct: 'court', pl: 'place', plz: 'plaza', pkwy: 'parkway', pky: 'parkway',
  ter: 'terrace', trl: 'trail', cir: 'circle', hwy: 'highway', sq: 'square', bldg: 'building',
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
}
const ORDINALS = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7',
  eighth: '8', ninth: '9', tenth: '10', eleventh: '11', twelfth: '12',
}

/**
 * Display form of a street address: trimmed, single-spaced, title-cased, unit stripped off.
 * @param {unknown} v
 * @returns {string}
 */
export function cleanAddress(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s
    .split(' ')
    .map((w) => (/^[0-9]+(st|nd|rd|th)$/i.test(w) || /^[0-9]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/**
 * Aggressive key for deduplication and building grouping. Lossy on purpose:
 * strips unit designators so every unit in a tower collapses to one building key.
 * @param {unknown} address
 * @param {unknown} [borough]
 * @returns {string}
 */
export function addressKey(address, borough) {
  let s = String(address ?? '').toLowerCase()
  // drop unit designators before punctuation is stripped: "apt 4b", "unit 12", "#3", "ph2", "fl 9"
  // ponytail: a leading "#5 Tudor City Place" would lose its house number - vanishingly rare in DOF data.
  s = s.replace(/#\s*[\w-]+/g, ' ')
  s = s.replace(/\b(apt|apartment|unit|ste|suite|fl|floor|rm|room|ph|penthouse)\b\.?[\s-]*[\w-]*/g, ' ')
  s = s.replace(/[.,]/g, ' ')
  s = s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ORDINALS[/** @type {keyof typeof ORDINALS} */ (w)] ?? w)
    .map((w) => w.replace(/^([0-9]+)(st|nd|rd|th)$/, '$1'))
    .map((w) => STREET_WORDS[/** @type {keyof typeof STREET_WORDS} */ (w)] ?? w)
    .join(' ')
    .trim()
  const b = normBorough(borough)
  return b ? `${s}|${b.toLowerCase()}` : s
}

/**
 * Address keys to try, most exact first. The roll carries house-number RANGES ("148-152 Reade
 * Street") where a listing site carries the single number the building answers to, so the low end
 * of the range is tried as a fallback. Queens addresses are hyphenated too ("141-01 73 Terrace")
 * but count UP from the block, never down, so requiring the second number to be the larger one
 * leaves them alone.
 * @param {unknown} address
 * @param {unknown} [borough]
 * @returns {string[]}
 */
export function addressKeyVariants(address, borough) {
  const keys = [addressKey(address, borough)]
  const m = String(address ?? '').match(/^\s*(\d+)\s*-\s*(\d+)\b(.*)$/)
  if (m && Number(m[2]) > Number(m[1])) keys.push(addressKey(m[1] + m[3], borough))
  return keys.filter(Boolean)
}

/**
 * Comparable form of an apartment designator: "#4-B", "Apt 4b" and "4B" are one unit.
 * @param {unknown} unit
 * @returns {string}
 */
export function unitKey(unit) {
  return String(unit ?? '').toUpperCase().replace(/\b(APT|APARTMENT|UNIT|STE|SUITE)\b/g, '').replace(/[^A-Z0-9]/g, '')
}

/**
 * Pull a unit designator out of a raw address string, if one is there.
 * @param {unknown} address
 * @returns {string|null}
 */
export function extractUnit(address) {
  const s = String(address ?? '')
  const m =
    s.match(/\b(?:apt|apartment|unit|ste|suite|rm|room|fl|floor)\b\.?\s*#?\s*([\w-]+)/i) ??
    s.match(/#\s*([\w-]+)/) ??
    s.match(/\b(ph\s?-?\d+\w*|penthouse\s?\w*)/i)
  return m ? m[1].toUpperCase().replace(/\s+/g, '') : null
}

/**
 * Borough(1) + block(5) + lot(4) = 10-digit BBL. Accepts an already-formed BBL too.
 * @param {unknown} bblOrBoro
 * @param {unknown} [block]
 * @param {unknown} [lot]
 * @returns {string|null}
 */
export function normBBL(bblOrBoro, block, lot) {
  if (block != null || lot != null) {
    const b = String(bblOrBoro ?? '').replace(/\D/g, '')
    const bl = String(block ?? '').replace(/\D/g, '')
    const lt = String(lot ?? '').replace(/\D/g, '')
    if (!b || !bl || !lt) return null
    return b.slice(0, 1) + bl.padStart(5, '0') + lt.padStart(4, '0')
  }
  const d = String(bblOrBoro ?? '').replace(/\D/g, '')
  return d.length === 10 ? d : null
}

/** @param {string|null|undefined} bbl */
export function splitBBL(bbl) {
  if (!bbl || bbl.length !== 10) return null
  return {
    borough: BOROUGH_BY_CODE[/** @type {keyof typeof BOROUGH_BY_CODE} */ (Number(bbl[0]))] ?? null,
    block: String(Number(bbl.slice(1, 6))),
    lot: String(Number(bbl.slice(6))),
  }
}

/**
 * Money that arrives as "$1,250,000.00", "1.25M", 1250000, or junk.
 * @param {unknown} v
 * @returns {number|null}
 */
export function normMoney(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/[$,\s]/g, '')
  const m = s.match(/^(-?[0-9]*\.?[0-9]+)\s*([kmb])?$/i)
  if (!m) return null
  const n = Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ''] ?? 1)
  return Number.isFinite(n) ? n : null
}

/** @param {unknown} v @returns {string|null} 5-digit ZIP */
export function normZip(v) {
  const m = String(v ?? '').match(/\b(\d{5})\b/)
  return m ? m[1] : null
}

/** @param {unknown} v @returns {boolean|null} tri-state: true / false / unknown */
export function normBool(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  if (['y', 'yes', 't', 'true', '1'].includes(s)) return true
  if (['n', 'no', 'f', 'false', '0'].includes(s)) return false
  return null
}

/**
 * Deterministic 32-bit hash - used for stable ids and for reproducible jitter
 * when a record can only be placed at a centroid.
 * @param {string} s
 */
export function hash32(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * RFC4180-ish CSV/TSV parser. Handles quotes, embedded commas/newlines, CRLF, BOM.
 * ponytail: hand-rolled instead of a csv dep - 30 lines, and the pipeline is the only caller.
 * @param {string} text
 * @param {string} [delimiter] inferred from the header row when omitted
 * @returns {{headers: string[], rows: string[][]}}
 */
export function parseDelimited(text, delimiter) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const head = src.split('\n', 1)[0]
  const d = delimiter ?? (head.split('\t').length > head.split(',').length ? '\t' : ',')
  /** @type {string[][]} */ const rows = []
  /** @type {string[]} */ let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === d) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const headers = (rows.shift() ?? []).map((h) => h.trim())
  return { headers, rows: rows.filter((r) => r.some((v) => v !== '')) }
}

/**
 * @param {(string|number|null|undefined)[]} values
 * @returns {string} one CSV line, quoted where needed
 */
export function toCsvRow(values) {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v)
      return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(',')
}
