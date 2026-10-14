// The rules engine. Everything policy-shaped lives in policy.json; this file only interprets it.
// Editing policy.json changes the thresholds, the value field, the classification map and the
// plain-English output without touching a line of UI or engine code.
// Checks live in scripts/check.mjs — `npm run check`.

import POLICY from './policy.json' with { type: 'json' }
import { normMoney, normBool } from './normalize.mjs'

export { POLICY }

/** @typedef {import('./normalize.mjs').PropertyType} PropertyType */

/**
 * @typedef {Object} Check
 * @property {string} id
 * @property {string} label
 * @property {boolean|null} passed  null = could not be evaluated
 * @property {string} detail
 * @property {string[]} inputs source columns that fed this check
 */

/**
 * @typedef {Object} PolicyFlags
 * @property {boolean} affected
 * @property {'listed'|'inferred'|'not_flagged'} status
 * @property {'direct'|'inferred'|'ambiguous'} confidence
 * @property {string|null} rule_id
 * @property {string|null} rule_label
 * @property {number|null} threshold
 * @property {string} bucket  threshold bucket id, or 'below_threshold' / 'unknown'
 * @property {number|null} value_used
 * @property {string|null} value_field
 * @property {boolean} near_cutoff
 * @property {'non_primary_signal'|'unknown'} occupancy
 * @property {string[]} review review_trigger ids
 * @property {Check[]} checks
 * @property {string} explain
 */

// Cached — `toLocaleString` costs ~13x more per call, and fmt() runs ~20 times per record.
const NF = new Intl.NumberFormat('en-US')
const fmt = (/** @type {number|null} */ n) => (n == null ? 'no value' : '$' + NF.format(Math.round(n)))

/**
 * Longest-prefix match of a DOF building class against the policy map.
 * @param {string|null|undefined} cls
 * @param {typeof POLICY} [policy]
 * @returns {PropertyType|null}
 */
export function typeFromBuildingClass(cls, policy = POLICY) {
  const c = String(cls ?? '').trim().toUpperCase()
  if (!c) return null
  const map = policy.classification.building_class_prefixes
  for (const len of [2, 1]) {
    const hit = map[/** @type {keyof typeof map} */ (c.slice(0, len))]
    if (hit) return /** @type {PropertyType} */ (hit)
  }
  return null
}

/**
 * Decide what the property is, and say how we decided.
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} [policy]
 * @returns {{type: PropertyType, basis: string, inputs: string[], certain: boolean}}
 */
export function classify(rec, policy = POLICY) {
  const explicit = String(rec.property_type ?? '').trim().toLowerCase()
  if (['condo', 'coop', 'home_1_3'].includes(explicit))
    return { type: /** @type {PropertyType} */ (explicit), basis: `source file states property type "${explicit}"`, inputs: ['property_type'], certain: true }

  const fromClass = typeFromBuildingClass(rec.building_class, policy)
  if (fromClass)
    return { type: fromClass, basis: `DOF building class "${rec.building_class}" maps to ${policy.type_labels[fromClass]}`, inputs: ['building_class'], certain: true }

  const tc = String(rec.tax_class ?? '').trim()[0]
  if (tc === '1')
    return { type: 'home_1_3', basis: 'tax class 1, broadly 1–3 family homes (fallback; class alone is not definitive)', inputs: ['tax_class'], certain: false }
  if (tc === '2')
    return { type: 'condo', basis: 'tax class 2 covers condos, co-ops and 4+ unit rentals, so treated as a condo for threshold purposes, but condo vs co-op is NOT determinable from tax class alone', inputs: ['tax_class'], certain: false }

  return { type: 'unknown', basis: 'no explicit type, no recognised building class, no usable tax class', inputs: [], certain: false }
}

/**
 * First non-null valuation in the policy's priority order.
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} [policy]
 * @returns {{value: number|null, field: string|null, alternatives: {field: string, value: number}[]}}
 */
export function pickValue(rec, policy = POLICY) {
  /** @type {{field: string, value: number}[]} */ const alternatives = []
  let value = /** @type {number|null} */ (null)
  let field = /** @type {string|null} */ (null)
  for (const f of policy.value_field_priority) {
    const v = normMoney(rec[f])
    if (v == null) continue
    if (value == null) { value = v; field = f } else alternatives.push({ field: f, value: v })
  }
  return { value, field, alternatives }
}

/**
 * Owner-occupancy evidence. Public data barely carries this, so 'unknown' is the common answer
 * and the engine never upgrades 'unknown' into 'non-primary'.
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} [policy]
 * @returns {{occupancy: 'non_primary_signal'|'unknown', detail: string, inputs: string[]}}
 */
export function occupancyEvidence(rec, policy = POLICY) {
  /** @type {string[]} */ const inputs = []
  // An entity owner is a lead, NOT a finding: DOF exempts an entity-owned property when a
  // majority-interest holder (or a sole trust beneficiary) lives there, and publishes an affidavit
  // for exactly that. Not applied to co-ops, where the corporation owns every unit by construction.
  const r = policy.residency_rule
  const owner = String(rec.owner_name ?? rec.public?.owner_name ?? '').trim()
  if (owner && r.entity_owner_applies_to.includes(classify(rec, policy).type)) {
    const m = owner.toUpperCase().match(new RegExp(r.entity_owner_patterns))
    if (m) {
      inputs.push('owner_name')
      return {
        occupancy: 'non_primary_signal',
        detail: `owner of record is "${owner}", and the "${m[1]}" marks it as a company or trust rather than a named person. That is worth a look, but it settles nothing: DOF exempts an entity-owned property when a majority-interest holder or sole trust beneficiary lives there, and publishes an affidavit for that route`,
        inputs,
      }
    }
  }

  const state = String(rec.owner_mailing_state ?? '').trim().toUpperCase()
  if (state && state !== 'NY') {
    inputs.push('owner_mailing_state')
    return { occupancy: 'non_primary_signal', detail: `owner mailing address is in ${state}, not NY, which is suggestive of a non-primary residence, but not proof`, inputs }
  }

  return {
    occupancy: 'unknown',
    detail: `no owner-occupancy evidence in the source (looked for: ${policy.residency_rule.evidence_fields.join(', ')})`,
    inputs,
  }
}

/**
 * Evaluate one canonical record against the policy. Pure — same record in, same flags out.
 * Fast path: no per-check detail strings, no explanation paragraph. Those cost ~20 formatted
 * strings per record and are read for one record at a time, so explainFlags() builds them.
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} [policy]
 * @returns {PolicyFlags}
 */
export const evaluate = (rec, policy = POLICY) => run(rec, policy, false)

/**
 * The same evaluation with its working shown. One record at a time — never the whole roll.
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} [policy]
 * @returns {PolicyFlags}
 */
export const explainFlags = (rec, policy = POLICY) => run(rec, policy, true)

/**
 * @param {Record<string, any>} rec
 * @param {typeof POLICY} policy
 * @param {boolean} verbose build checks[] and explain
 * @returns {PolicyFlags}
 */
function run(rec, policy, verbose) {
  /** @type {Check[]} */ const checks = []
  /** @type {string[]} */ const review = []

  const cls = classify(rec, policy)
  if (verbose) checks.push({
    id: 'classification', label: 'Property type', passed: cls.type !== 'unknown' ? true : null,
    detail: `${policy.type_labels[cls.type]}: ${cls.basis}`, inputs: cls.inputs,
  })
  if (cls.type === 'unknown') review.push('unknown_type')

  const { value, field, alternatives } = pickValue(rec, policy)
  if (verbose) checks.push({
    id: 'valuation', label: 'Valuation used', passed: value != null ? true : null,
    detail: value == null
      ? `no usable figure in any of: ${policy.value_field_priority.join(', ')}`
      : `${fmt(value)} from "${field}" (first available in policy priority ${policy.value_field_priority.join(' → ')})` +
        (alternatives.length ? `. Other values on this record: ${alternatives.map((x) => `${x.field}=${fmt(x.value)}`).join(', ')}` : ''),
    inputs: field ? [field] : [],
  })
  if (value == null) review.push('missing_value')

  // Which thresholds could apply? A known type picks exactly one; an unknown type is tested
  // against all of them and reported as ambiguous.
  const candidates = policy.thresholds.filter((t) =>
    cls.type === 'unknown' ? true : t.applies_to.includes(cls.type))

  /** @type {(typeof policy.thresholds)[number]|null} */ let matched = null
  let overAny = false
  for (const t of candidates) {
    const over = value != null && (t.comparator === 'gt' ? value > t.min_value : value >= t.min_value)
    if (over) { overAny = true; matched = matched ?? t }
    if (verbose) checks.push({
      id: `threshold:${t.id}`, label: t.label,
      passed: value == null ? null : over,
      detail: `${fmt(value)} ${t.comparator === 'gt' ? '>' : '≥'} ${fmt(t.min_value)} → ${value == null ? 'cannot test' : over ? 'AT OR OVER threshold' : 'under threshold'}. ${t.note}`,
      inputs: field ? [field, ...cls.inputs] : cls.inputs,
    })
  }
  if (verbose && !candidates.length)
    checks.push({ id: 'threshold:none', label: 'Applicable threshold', passed: null, detail: 'no threshold in the policy applies to this property type', inputs: [] })

  // Near a threshold, or near a rate-band edge — both matter, because the rate applies to the
  // whole value, so crossing an edge re-rates everything rather than just the increment.
  const pct = policy.near_threshold_pct
  const edges = [
    ...candidates.map((t) => t.min_value),
    ...policy.tax_model.surcharge.bands.filter((b) => b.applies_to.includes(cls.type)).map((b) => b.min),
  ]
  const near_cutoff = value != null && edges.some((e) => Math.abs(value - e) <= e * pct)
  if (near_cutoff) review.push('near_cutoff')

  const occ = occupancyEvidence(rec, policy)
  if (verbose) checks.push({
    id: 'occupancy', label: 'Non-primary residence (the deciding fact)',
    passed: occ.occupancy === 'non_primary_signal' ? true : null,
    detail: occ.detail, inputs: occ.inputs,
  })
  if (occ.occupancy === 'unknown') review.push('no_occupancy_evidence')

  const listed = normBool(rec.listed_by_source) === true
  if (verbose) checks.push({
    id: 'listed', label: 'On the published city list', passed: listed,
    detail: listed
      ? `record appears in the city-published roll (${rec.source_file ?? 'source file'})`
      : 'not present on a published city roll in the loaded data, so inclusion here is this tool’s inference',
    inputs: ['listed_by_source'],
  })

  const affected = listed || overAny
  if (listed && !overAny && value != null) review.push('listed_but_below')
  if (rec.geocode_source && !['point', 'geosearch', 'block'].includes(rec.geocode_source)) review.push('weak_geocode')

  /** @type {PolicyFlags['confidence']} */
  let confidence = 'ambiguous'
  if (listed) confidence = 'direct'
  else if (overAny && cls.certain && value != null) confidence = 'inferred'


  return {
    affected,
    status: listed ? 'listed' : overAny ? 'inferred' : 'not_flagged',
    confidence,
    rule_id: matched?.id ?? null,
    rule_label: matched?.label ?? null,
    threshold: matched?.min_value ?? null,
    bucket: matched?.id ?? (value == null || cls.type === 'unknown' ? 'unknown' : 'below_threshold'),
    value_used: value,
    value_field: field,
    near_cutoff,
    occupancy: occ.occupancy,
    review,
    checks,
    explain: verbose ? explain({ listed, overAny, affected, cls, value, field, matched, near_cutoff, occ, policy, candidates }) : '',
  }
}

/**
 * Plain-English "why this record is flagged". Deliberately hedged — the engine's job is to
 * describe a lead, not to assert a tax liability.
 * @param {any} ctx
 * @returns {string}
 */
function explain(ctx) {
  const { affected, listed, overAny, cls, value, field, matched, near_cutoff, occ, policy, candidates } = ctx
  const t = policy.type_labels[cls.type]
  /** @type {string[]} */ const s = []

  if (!affected) {
    s.push(`This property does NOT appear affected under the loaded rule set. It reads as ${t.toLowerCase()}`)
    if (value == null) s.push('but it carries no usable valuation, so no threshold could be tested. Treat this as "not assessed", not "cleared".')
    else if (candidates.length) s.push(`and its ${field} of ${fmt(value)} is below the ${fmt(candidates[0].min_value)} threshold for that type.`)
    else s.push('but no threshold in the loaded policy applies to that type.')
    return s.join(' ')
  }

  if (listed) {
    s.push('This property is on the city-published list, so it is flagged directly rather than inferred.')
    if (overAny && matched) s.push(`Its ${field} of ${fmt(value)} is also at or over the ${fmt(matched.min_value)} threshold for ${matched.label.toLowerCase()}, which corroborates the listing.`)
    else if (value != null) s.push(`Its ${field} of ${fmt(value)} is BELOW every published threshold. DOF's roll deliberately includes properties beyond those that may be subject to the surcharge, so this is expected rather than an anomaly.`)
    else s.push('No valuation is available on this record, so the listing could not be corroborated.')
  } else {
    s.push('This property is not on a published list in the loaded data. It is flagged by inference:')
    s.push(`it reads as ${t.toLowerCase()} (${cls.basis}), and its ${field} of ${fmt(value)} is at or over the ${fmt(matched.min_value)} threshold for ${matched.label.toLowerCase()}.`)
  }

  if (cls.type === 'unknown') s.push('Property type could not be determined, so it was tested against every threshold, and it clears at least one reading, but not necessarily the correct one.')
  else if (!cls.certain) s.push(`The type was inferred, not stated (${cls.basis}), so the threshold chosen for it may be the wrong one.`)

  if (near_cutoff) s.push(`It sits within ${Math.round(policy.near_threshold_pct * 100)}% of a threshold or a rate-band edge. Because the rate applies to the whole value rather than the amount above the edge, a small revaluation moves the bill a long way.`)

  if (occ.occupancy === 'unknown') s.push(`Occupancy is unknown (${occ.detail}). The surcharge applies only where the property is not a primary residence of the owner, a tenant, an immediate family member, a majority-interest holder or a sole trust beneficiary, none of which appears in public data.`)
  else s.push(`Non-primary signal: ${occ.detail}.`)

  return s.join(' ')
}

/**
 * @typedef {Object} TaxEstimate
 * @property {number|null} current      existing annual NYC property tax
 * @property {number|null} assessed     assessed value the current bill is computed from
 * @property {'source'|'estimated'|null} assessed_source
 * @property {string|null} tax_class
 * @property {number|null} class_rate
 * @property {string} current_formula
 * @property {number|null} surcharge    annual non-primary residence surcharge at DOF's rate
 * @property {string|null} band         which published rate band applies
 * @property {number|null} rate         that band's rate
 * @property {number|null} next_edge    market value at which the next band starts
 * @property {number|null} cliff        extra annual cost of crossing into that band
 * @property {number|null} floor_edge   the band edge this property is sitting just above
 * @property {number|null} appeal_drop  reduction in DOF value needed to fall below that edge
 * @property {number|null} appeal_saving annual surcharge removed by falling below it
 * @property {string} surcharge_formula
 * @property {number|null} total        current + surcharge
 * @property {number|null} increase_pct surcharge / current
 * @property {string[]} caveats
 */

/**
 * DOF's published schedule: a flat percentage of the FULL market value, chosen by the band the
 * value falls into. Deliberately not marginal — crossing a band edge re-rates the whole value.
 * @param {number} value
 * @param {string} type
 * @param {typeof POLICY} policy
 */
function surchargeBand(value, type, policy) {
  return policy.tax_model.surcharge.bands.find(
    (b) => b.applies_to.includes(type) && value >= b.min && (b.max == null || value < b.max),
  ) ?? null
}

/**
 * How far this value sits from the next band edge — the cliff a revaluation could push it over.
 * @param {number} value
 * @param {string} type
 * @param {typeof POLICY} policy
 */
function nextBandEdge(value, type, policy) {
  const edges = policy.tax_model.surcharge.bands
    .filter((b) => b.applies_to.includes(type))
    .map((b) => b.min)
    .filter((m) => m > value)
  return edges.length ? Math.min(...edges) : null
}

/**
 * What the owner pays now, what the reported policy would add, and the ratio between them.
 *
 * The existing-tax half is real arithmetic on NYC's published formula. The surcharge half is a
 * MODEL — no rate schedule was reported — and everything it returns is labelled as such.
 *
 * @param {Record<string, any>} rec
 * @param {PolicyFlags} flags
 * @param {typeof POLICY} [policy]
 * @returns {TaxEstimate}
 */
export const estimateTax = (rec, flags, policy = POLICY) => runTax(rec, flags, policy, false)

/**
 * The same estimate with its arithmetic written out. One record at a time.
 * @param {Record<string, any>} rec
 * @param {PolicyFlags} flags
 * @param {typeof POLICY} [policy]
 * @returns {TaxEstimate}
 */
export const explainTax = (rec, flags, policy = POLICY) => runTax(rec, flags, policy, true)

/**
 * @param {Record<string, any>} rec
 * @param {PolicyFlags} flags
 * @param {typeof POLICY} policy
 * @param {boolean} verbose build the formula strings and caveats
 * @returns {TaxEstimate}
 */
function runTax(rec, flags, policy, verbose) {
  const model = policy.tax_model
  /** @type {string[]} */ const caveats = []

  // ---- what they pay now
  const cls = classify(rec, policy)
  const stated = String(rec.tax_class ?? '').trim()[0]
  const tax_class = ['1', '2', '3', '4'].includes(stated)
    ? stated
    : cls.type === 'home_1_3' ? '1' : cls.type === 'unknown' ? null : '2'
  if (verbose && !stated && tax_class) caveats.push(`tax class not stated, so assumed class ${tax_class} from the property type`)

  const rates = model.existing.class_tax_rates
  const class_rate = tax_class ? rates[/** @type {keyof typeof rates} */ (tax_class)] ?? null : null

  const ratios = model.existing.assessment_ratio
  const ratio = tax_class ? ratios[/** @type {keyof typeof ratios} */ (tax_class)] ?? null : null
  const market = normMoney(rec.market_value)

  let assessed = normMoney(rec.assessed_value)
  /** @type {'source'|'estimated'|null} */ let assessed_source = assessed != null ? 'source' : null
  if (assessed == null && market != null && ratio != null) {
    assessed = market * ratio
    assessed_source = 'estimated'
    if (verbose) caveats.push(`no assessed value in the source, so estimated as ${Math.round(ratio * 100)}% of market value, which ignores assessment caps and abatements`)
  }

  const current = assessed != null && class_rate != null ? assessed * class_rate : null
  const current_formula = !verbose ? '' : current == null || class_rate == null
    ? `cannot estimate: ${assessed == null ? 'no assessed value and no market value to derive one from' : 'no usable tax class, so no rate applies'}`
    : `${fmt(assessed)} assessed ${assessed_source === 'source' ? '(from source)' : `(estimated at ${Math.round((ratio ?? 0) * 100)}% of ${fmt(market)} market value)`} × ${(class_rate * 100).toFixed(3)}% class ${tax_class} rate (${model.existing.fiscal_year}) = ${fmt(current)}/yr`

  // ---- what the surcharge adds, on DOF's published schedule
  const value = flags.value_used
  // A property under its own threshold is never charged, whatever the band table says. The two
  // are not redundant: the home threshold is "more than $5,000,000" (`gt`) while the first home
  // band starts AT $5,000,000, so a home valued at exactly $5M would otherwise be handed a band
  // and a bill while its own bucket read `below_threshold`. No record on the current roll is
  // valued at exactly $5M — the fetch filter excludes it — so this guards a latent disagreement
  // rather than fixing a live one, and it keeps the two halves of the engine from drifting apart.
  const overOwnThreshold = flags.bucket !== 'below_threshold'
  const band = value != null && flags.affected && overOwnThreshold ? surchargeBand(value, cls.type, policy) : null
  const surcharge = band != null && value != null ? value * band.rate : null
  const chargeable = surcharge != null

  const edge = value != null ? nextBandEdge(value, cls.type, policy) : null
  const nextBand = edge != null ? surchargeBand(edge, cls.type, policy) : null
  const cliff = nextBand != null && value != null ? value * nextBand.rate - (surcharge ?? 0) : null

  // The rate applies to the FULL value, so the edge BELOW a property is a cliff too — and that one
  // is worth money. A property just over a band edge (or just over the entry threshold) can cut its
  // whole bill by getting DOF's value reduced by a rounding error. This is arithmetic on the
  // published table, not advice about whether a reduction is achievable.
  const floor_edge = band ? band.min : null
  const appeal_drop = value != null && floor_edge != null ? value - floor_edge + 1 : null
  const below = floor_edge != null
    ? policy.tax_model.surcharge.bands.find(
        (b) => b.applies_to.includes(cls.type) && floor_edge - 1 >= b.min && (b.max == null || floor_edge - 1 < b.max))
    : null
  const appeal_saving = surcharge != null && floor_edge != null
    ? surcharge - (below ? (floor_edge - 1) * below.rate : 0)
    : null

  const surcharge_formula = !verbose ? '' : !flags.affected
    ? 'not on the roll and below every threshold, so no surcharge'
    : value == null
      ? 'on the roll, but with no DOF market value on this record the surcharge cannot be computed'
      : !band
        ? `on the roll at ${fmt(value)}, but no published rate band covers a ${policy.type_labels[cls.type].toLowerCase()} at that value. DOF's roll includes properties beyond those subject to the surcharge`
        : `${fmt(value)} DOF market value falls in "${band.label}" → ${(band.rate * 100).toFixed(2)}% of the FULL value = ${fmt(surcharge)}/yr. ` +
          (edge != null && nextBand != null && value != null
            ? `A revaluation of ${fmt(edge - value)} more would cross into "${nextBand.label}" and re-rate the whole value at ${(nextBand.rate * 100).toFixed(2)}%, adding about ${fmt(cliff)} a year.`
            : 'This is the top band, so there is no further band edge above it.')

  if (verbose && chargeable) caveats.push('the rate is DOF’s published schedule; whether the surcharge is actually owed turns on primary residence, which this data cannot show')

  const total = current != null ? current + (chargeable ? surcharge : 0) : null

  return {
    current,
    assessed,
    assessed_source,
    tax_class,
    class_rate,
    current_formula,
    surcharge,
    band: band?.label ?? null,
    rate: band?.rate ?? null,
    next_edge: edge,
    cliff,
    floor_edge,
    appeal_drop,
    appeal_saving,
    surcharge_formula,
    total,
    increase_pct: current != null && current > 0 && chargeable ? surcharge / current : null,
    caveats,
  }
}

/**
 * Roll a set of records up to buildings. Shared by the buildings table and its CSV export.
 * @param {{building_key: string, address: string, borough: string|null, bbl: string|null, property_type?: string, flags: PolicyFlags, tax?: TaxEstimate}[]} records
 */
/**
 * Which clock a property is on. The exemption window closes in October 2026, but the Tax Commission
 * window runs to March 2027 — so this tool has a second, longer life in which the question changes
 * from "claim your exemption" to "challenge the value". Dates differ by tax class, so they are read
 * from the policy rather than hardcoded, and `now` is injectable so the phase boundaries are testable.
 *
 * @param {any} rec
 * @param {number} [now] epoch ms
 * @param {typeof POLICY} [policy]
 */
export function deadlines(rec, now = Date.now(), policy = POLICY) {
  const days = (/** @type {string} */ iso) => Math.ceil((new Date(iso + 'T12:00:00').getTime() - now) / 86_400_000)
  const isCoop = classify(rec, policy).type === 'coop'
  const ex = policy.deadlines.find((d) => (isCoop ? d.id === 'coops' : d.id === 'homes_condos')) ?? policy.deadlines[0]
  // Class 1 files by 15 March, Class 2 by 1 March. Default to Class 2, the larger population here.
  const cls = String(rec.tax_class ?? '').startsWith('1') ? '1' : '2'
  const ap = policy.appeals.deadlines.find((d) => d.tax_class === cls) ?? policy.appeals.deadlines[0]

  const exDays = days(ex.date)
  const apDays = days(ap.date)
  return {
    exemption: { ...ex, days: exDays, open: exDays > 0 },
    appeal: { ...ap, days: apDays, open: apDays > 0 },
    phase: exDays > 0 ? 'exemption' : apDays > 0 ? 'appeal' : 'closed',
  }
}

/**
 * True when the reduction needed to drop a band is small relative to the value — the population
 * with a real reason to look at a Tax Commission appeal.
 * @param {TaxEstimate} tax
 * @param {number|null} value
 * @param {number} [within] fraction of value, default 10%
 */
export function onCliff(tax, value, within = 0.1) {
  if (!tax.appeal_saving || tax.appeal_drop == null || !value) return false
  return tax.appeal_drop / value <= within
}

/**
 * Roll a set of records up to buildings. Shared by the buildings table and its CSV export.
 * @param {{building_key: string, address: string, borough: string|null, bbl: string|null, property_type?: string, flags: PolicyFlags, tax?: TaxEstimate}[]} records
 */
export function aggregateBuildings(records) {
  /** @type {Map<string, any>} */ const m = new Map()
  for (const r of records) {
    let b = m.get(r.building_key)
    if (!b) {
      b = {
        building_key: r.building_key, address: r.address, borough: r.borough, bbl: r.bbl,
        units: 0, listed: 0, inferred: 0, needs_review: 0,
        total_value: 0, valued_units: 0, total_current_tax: 0, total_surcharge: 0,
        types: /** @type {Record<string, number>} */ ({}),
      }
      m.set(r.building_key, b)
    }
    b.units++
    b.total_current_tax += r.tax?.current ?? 0
    b.total_surcharge += r.tax?.surcharge ?? 0
    if (r.flags.status === 'listed') b.listed++
    if (r.flags.status === 'inferred') b.inferred++
    if (r.flags.review.length) b.needs_review++
    if (r.flags.value_used != null) { b.total_value += r.flags.value_used; b.valued_units++ }
    const t = r.property_type ?? 'unknown'
    b.types[t] = (b.types[t] ?? 0) + 1
  }
  return [...m.values()].map((b) => ({
    ...b,
    avg_value: b.valued_units ? Math.round(b.total_value / b.valued_units) : null,
    surcharge_pct: b.total_current_tax > 0 ? b.total_surcharge / b.total_current_tax : null,
    dominant_type: Object.entries(b.types).sort((x, y) => /** @type {number} */ (y[1]) - /** @type {number} */ (x[1]))[0]?.[0] ?? 'unknown',
  }))
}
