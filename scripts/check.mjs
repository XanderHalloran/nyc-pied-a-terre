// The project's one test file: `npm run check`.
// Covers the logic that would silently produce wrong journalism if it broke — address
// normalisation, source merging, and the policy engine. No framework, no fixtures.

import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import {
  normBorough, addressKey, addressKeyVariants, unitKey, extractUnit, normBBL, splitBBL,
  normMoney, normZip, normBool, parseDelimited, toCsvRow, hash32,
} from '../src/lib/normalize.mjs'
import { buildRecords, finalise } from '../src/lib/canonical.mjs'
import { POLICY, evaluate, explainFlags, classify, estimateTax, explainTax, onCliff, deadlines, typeFromBuildingClass, aggregateBuildings } from '../src/lib/rules.mjs'

let n = 0
const test = (/** @type {string} */ name, /** @type {() => void} */ fn) => {
  try { fn(); n++ }
  catch (e) { console.error(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

// ------------------------------------------------------------------ normalize

test('borough names normalise from every form the city uses', () => {
  assert.equal(normBorough('BK'), 'Brooklyn')
  assert.equal(normBorough(' the bronx '), 'Bronx')
  assert.equal(normBorough('New York'), 'Manhattan')
  assert.equal(normBorough(3), 'Brooklyn')
  assert.equal(normBorough('Hoboken'), null)
})

test('address keys collapse units and abbreviations, but not boroughs', () => {
  assert.equal(addressKey('740 Park Ave, Apt 12B', 'MN'), addressKey('740 PARK AVENUE #12b', 'Manhattan'))
  assert.equal(addressKey('15 Central Park West Unit 20A'), addressKey('15 Central Park W. Apt 3'))
  assert.equal(addressKey('101 Fifth Avenue'), addressKey('101 5th Ave'))
  assert.notEqual(addressKey('740 Park Ave', 'Manhattan'), addressKey('740 Park Ave', 'Brooklyn'))
})

// The StreetEasy crosswalk joins on address alone, so these two decide whether a property gets the
// right listing, the wrong one, or none. A range that swallowed a Queens house number would point
// thousands of Queens rows at a Manhattan listing.
test('house-number ranges fall back to the low end, Queens addresses do not', () => {
  assert.deepEqual(addressKeyVariants('148-152 Reade Street'), ['148-152 reade street', '148 reade street'])
  assert.deepEqual(addressKeyVariants('141-01 73 Terrace'), ['141-01 73 terrace']) // counts up: a real house number
  assert.deepEqual(addressKeyVariants('26 Cliff Street'), ['26 cliff street'])
  assert.equal(addressKeyVariants('24-26 Warren St')[1], addressKey('24 Warren Street'))
})

test('apartment designators compare across the formats each source uses', () => {
  assert.equal(unitKey('#4-B'), unitKey('Apt 4b'))
  assert.equal(unitKey('4B'), '4B')
  assert.equal(unitKey('PH809'), unitKey('#ph809'))
  assert.equal(unitKey(''), '')
  assert.notEqual(unitKey('4B'), unitKey('4C'))
})

test('unit designators are extracted, not invented', () => {
  assert.equal(extractUnit('740 Park Ave, Apt 12B'), '12B')
  assert.equal(extractUnit('15 CPW #PH2'), 'PH2')
  assert.equal(extractUnit('123 Main Street'), null)
})

test('BBL round-trips from parts and back', () => {
  assert.equal(normBBL(1, 1376, 1101), '1013761101')
  assert.equal(normBBL('1013761101'), '1013761101')
  assert.equal(normBBL('nonsense'), null)
  assert.deepEqual(splitBBL('1013761101'), { borough: 'Manhattan', block: '1376', lot: '1101' })
})

test('money parses the formats city files actually ship', () => {
  assert.equal(normMoney('$1,250,000.00'), 1250000)
  assert.equal(normMoney('1.25M'), 1250000)
  assert.equal(normMoney(999), 999)
  assert.equal(normMoney('n/a'), null)
  assert.equal(normMoney(''), null)
})

test('zip / bool / hash primitives', () => {
  assert.equal(normZip('Brooklyn, NY 11215-1234'), '11215')
  assert.equal(normBool('YES'), true)
  assert.equal(normBool('0'), false)
  assert.equal(normBool('maybe'), null)
  assert.equal(hash32('abc'), hash32('abc'))
})

test('CSV parser handles quotes, embedded commas, CRLF and tabs', () => {
  const csv = parseDelimited('a,b,c\r\n1,"two, with comma",3\n4,"say ""hi""",6\n')
  assert.deepEqual(csv.headers, ['a', 'b', 'c'])
  assert.deepEqual(csv.rows, [['1', 'two, with comma', '3'], ['4', 'say "hi"', '6']])
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n').headers, ['a', 'b'])
  assert.equal(toCsvRow(['plain', 'has,comma', null]), 'plain,"has,comma",')
})

// ------------------------------------------------------------------ pipeline

const listFile = {
  file: 'list.csv',
  headers: ['BBL', 'BOROUGH', 'ADDRESS', 'BLDG CLASS', 'EST MARKET VALUE', 'ON PUBLISHED LIST'],
  rows: [['1013760001', 'MANHATTAN', '740 Park Ave, Apt 12B', 'R4', '$4,200,000', 'Y']],
}
const pvadFile = {
  file: 'pvad.csv',
  headers: ['bble', 'boro_code', 'house_number', 'street_name', 'apt_no', 'bldgcl', 'fullval', 'latitude', 'longitude', 'owner_state'],
  rows: [['1013760001', '1', '740', 'Park Avenue', '12B', 'R4', '4200000', '40.7712', '-73.9647', 'FL']],
}

test('two differently-shaped files merge into one record with both provenances', () => {
  const { records, stats } = buildRecords([listFile, pvadFile])
  assert.equal(records.length, 1)
  assert.equal(stats.dupes, 1)
  const r = records[0]
  assert.equal(r.address, '740 Park Ave') // display form from the first file read
  assert.equal(r.unit, '12B')
  assert.equal(r.borough, 'Manhattan')
  assert.equal(r.market_value, 4_200_000)
  assert.equal(r.listed_by_source, true)
  assert.equal(r.owner_mailing_state, 'FL', 'the second file must fill fields the first lacked')
  assert.equal(r.geocode_source, 'point')
  assert.equal(r.sources.length, 2)
  assert.ok(r.raw['list.csv'] && r.raw['pvad.csv'], 'raw columns from both files must be preserved')
})

test('borough is derived from the BBL when no borough column exists', () => {
  const r = buildRecords([{ file: 'x.csv', headers: ['bbl', 'address', 'fullval'], rows: [['3012340056', '100 Court Street', '900000']] }]).records[0]
  assert.equal(r.borough, 'Brooklyn')
  assert.ok(r.notes.some((/** @type {string} */ s) => s.includes('borough derived')))
})

test('coordinates outside NYC are rejected, not mapped into the ocean', () => {
  const r = buildRecords([{ file: 'y.csv', headers: ['address', 'borough', 'lat', 'lon'], rows: [['1 Main St', 'Queens', '0', '0']] }]).records[0]
  assert.equal(r.lat, null)
  assert.ok(r.notes.some((/** @type {string} */ s) => s.includes('rejected')))
})

test('rows with neither address nor BBL are dropped, not half-imported', () => {
  assert.equal(buildRecords([{ file: 'z.csv', headers: ['fullval'], rows: [['500000']] }]).stats.skipped, 1)
})

test('units in one building share a key and a count', () => {
  const b = finalise(buildRecords([{
    file: 'b.csv',
    headers: ['bbl', 'address', 'apt'],
    rows: [['1013761001', '15 CPW', '2A'], ['1013761002', '15 CPW', '2B'], ['4055500012', '9 Other Rd', '']],
  }]).records, '2026-07-28T00:00:00Z')
  assert.equal(b[0].building_key, b[1].building_key)
  assert.equal(b[0].units_in_building, 2)
  assert.equal(b[2].units_in_building, 1)
})

// -------------------------------------------------------------------- rules

const condo = evaluate({ building_class: 'R4', market_value: 1_400_000 })
const coop = evaluate({ building_class: 'D4', market_value: 950_000 })

test('a condo over the reported $1M initial-phase threshold is flagged by inference', () => {
  assert.equal(condo.affected, true)
  assert.equal(condo.status, 'inferred')
  assert.equal(condo.rule_id, 'condo_coop_initial')
  assert.equal(condo.value_field, 'market_value')
})

test('the headline asymmetry: a $2M house is clear while a $1.1M condo is not', () => {
  assert.equal(evaluate({ building_class: 'A1', market_value: 2_000_000 }).affected, false)
  assert.equal(evaluate({ building_class: 'R4', market_value: 1_100_000 }).affected, true)
})

test('the house threshold is strictly above $5M', () => {
  assert.equal(evaluate({ building_class: 'B2', market_value: 5_000_000 }).affected, false)
  assert.equal(evaluate({ building_class: 'B2', market_value: 5_000_001 }).affected, true)
})

test('records within 10% of a threshold are marked near the cutoff', () => {
  assert.equal(coop.affected, false)
  assert.equal(coop.bucket, 'below_threshold')
  assert.equal(coop.near_cutoff, true)
})

test('on the city list but under every threshold is surfaced, not swallowed', () => {
  const odd = evaluate({ building_class: 'R4', market_value: 600_000, listed_by_source: 'Y' })
  assert.equal(odd.status, 'listed')
  assert.equal(odd.confidence, 'direct')
  assert.ok(odd.review.includes('listed_but_below'))
})

test('missing occupancy evidence stays unknown — it is never upgraded to non-primary', () => {
  assert.equal(evaluate({ building_class: 'R4', market_value: 1_400_000, owner_mailing_state: 'FL' }).occupancy, 'non_primary_signal')
  assert.equal(condo.occupancy, 'unknown')
  assert.ok(condo.review.includes('no_occupancy_evidence'))
})

test('an entity owner is a non-primary signal — a company has no home', () => {
  for (const owner of ['740 PARK AVENUE LLC', 'THE MILLER FAMILY TRUST', 'BLEECKER PROPERTIES INC', 'RIVERSIDE PARTNERS LP']) {
    const f = explainFlags({ building_class: 'R4', market_value: 2_000_000, owner_name: owner })
    assert.equal(f.occupancy, 'non_primary_signal', `${owner} should read as an entity`)
    assert.match(f.explain, /entity/)
  }
  assert.equal(evaluate({ building_class: 'R4', market_value: 2_000_000, owner_name: 'SMITH, JOHN' }).occupancy, 'unknown')
})

test('the entity rule is NOT applied to co-ops, where the corporation owns every unit', () => {
  const coopEntity = evaluate({ building_class: 'D4', market_value: 2_000_000, owner_name: '150 WEST END OWNERS CORP' })
  assert.equal(coopEntity.occupancy, 'unknown', 'flagging every co-op shareholder as non-primary would be a citywide false positive')
  // the identical owner shape on a condo does signal
  assert.equal(evaluate({ building_class: 'R4', market_value: 2_000_000, owner_name: '150 WEST END OWNERS CORP' }).occupancy, 'non_primary_signal')
})

test('an unclassifiable property is tested against every threshold and stays ambiguous', () => {
  const un = evaluate({ market_value: 2_000_000 })
  assert.equal(un.affected, true)
  assert.equal(un.confidence, 'ambiguous')
  assert.ok(un.review.includes('unknown_type'))
})

test('no valuation means "cannot test", never a silent pass', () => {
  const nov = explainFlags({ building_class: 'R4' })
  assert.equal(nov.affected, false)
  assert.ok(nov.review.includes('missing_value'))
  assert.equal(nov.checks.find((/** @type {any} */ c) => c.id === 'valuation')?.passed, null)
})

test('the valuation field comes from policy.json, not from code', () => {
  const rec = { building_class: 'R4', market_value: 1_200_000, assessed_value: 500_000 }
  assert.equal(evaluate(rec).value_field, 'market_value')
  const alt = { ...POLICY, value_field_priority: ['assessed_value', 'market_value'] }
  assert.equal(evaluate(rec, alt).affected, false, 'reordering the value priority must change the outcome')
})

test('building classes map to types, and tax class alone is never treated as certain', () => {
  assert.equal(typeFromBuildingClass('R4'), 'condo')
  assert.equal(typeFromBuildingClass('C6'), 'coop')
  assert.equal(typeFromBuildingClass('A5'), 'home_1_3')
  assert.equal(typeFromBuildingClass('Z9'), null)
  assert.equal(classify({ tax_class: '1' }).certain, false)
})

test('every rule check is self-describing', () => {
  for (const c of explainFlags({ building_class: 'R4', market_value: 1_400_000 }).checks)
    assert.ok(c.label && c.detail, `check ${c.id} must carry a label and detail`)
})

test('building aggregation counts units and averages', () => {
  const agg = aggregateBuildings([
    { building_key: 'k', address: '1 A St', borough: 'Manhattan', bbl: null, property_type: 'condo', flags: condo },
    { building_key: 'k', address: '1 A St', borough: 'Manhattan', bbl: null, property_type: 'condo', flags: condo },
    { building_key: 'j', address: '2 B St', borough: 'Queens', bbl: null, property_type: 'coop', flags: coop },
  ])
  const k = agg.find((b) => b.building_key === 'k')
  assert.equal(k.units, 2)
  assert.equal(k.avg_value, 1_400_000)
  assert.equal(k.dominant_type, 'condo')
})

// ---------------------------------------------------------------- tax model
// DOF's published schedule is a FLAT rate on the full market value for the band it falls in,
// not a marginal rate on the excess. Crossing a band edge re-rates the whole value.

const tax = (/** @type {Record<string, any>} */ rec) => explainTax(rec, evaluate(rec))

test('condo bands are a flat rate on the FULL DOF market value', () => {
  const a = tax({ building_class: 'R4', tax_class: '2', market_value: 1_500_000, listed_by_source: 'Y' })
  assert.equal(a.rate, 0.04)
  assert.equal(Math.round(a.surcharge), 60_000, '4% of the whole $1.5M, not of the amount over $1M')

  const b = tax({ building_class: 'R4', tax_class: '2', market_value: 4_000_000, listed_by_source: 'Y' })
  assert.equal(b.rate, 0.0525)
  assert.equal(Math.round(b.surcharge), 210_000)

  const c = tax({ building_class: 'R4', tax_class: '2', market_value: 8_000_000, listed_by_source: 'Y' })
  assert.equal(c.rate, 0.065)
  assert.equal(Math.round(c.surcharge), 520_000)
})

test('home bands use the 1-3 family schedule', () => {
  const a = tax({ building_class: 'A1', tax_class: '1', market_value: 6_000_000, listed_by_source: 'Y' })
  assert.equal(a.rate, 0.008)
  assert.equal(Math.round(a.surcharge), 48_000)
  assert.equal(tax({ building_class: 'A1', tax_class: '1', market_value: 20_000_000, listed_by_source: 'Y' }).rate, 0.0105)
  assert.equal(tax({ building_class: 'A1', tax_class: '1', market_value: 30_000_000, listed_by_source: 'Y' }).rate, 0.013)
})

test('the band edge is a cliff, and the size of it is reported', () => {
  const under = tax({ building_class: 'R4', tax_class: '2', market_value: 2_999_999, listed_by_source: 'Y' })
  const over = tax({ building_class: 'R4', tax_class: '2', market_value: 3_000_001, listed_by_source: 'Y' })
  assert.equal(under.rate, 0.04)
  assert.equal(over.rate, 0.0525)
  assert.ok(over.surcharge - under.surcharge > 37_000, 'one dollar of value should cost tens of thousands')
  assert.equal(under.next_edge, 3_000_000)
  assert.ok(under.cliff > 37_000)
  assert.match(under.surcharge_formula, /would cross into/)
})

test('a property near a band edge is surfaced for review', () => {
  assert.ok(evaluate({ building_class: 'R4', tax_class: '2', market_value: 2_900_000, listed_by_source: 'Y' }).review.includes('near_cutoff'))
})

test('below every threshold there is no surcharge, even if DOF listed it', () => {
  const t = tax({ building_class: 'R4', tax_class: '2', market_value: 400_000, listed_by_source: 'Y' })
  assert.equal(t.surcharge, null)
  assert.equal(t.band, null)
  assert.match(t.surcharge_formula, /beyond those subject to the surcharge/)
})

test('the existing-tax figure is separate and labelled by where assessed value came from', () => {
  const t = tax({ building_class: 'R4', tax_class: '2', market_value: 2_000_000, assessed_value: 230_000, listed_by_source: 'Y' })
  assert.equal(t.assessed_source, 'source')
  assert.equal(Math.round(t.current), Math.round(230_000 * 0.125))
  assert.equal(Math.round(t.total), Math.round(t.current + t.surcharge))
  const est = tax({ building_class: 'A1', tax_class: '1', market_value: 6_000_000, listed_by_source: 'Y' })
  assert.equal(est.assessed_source, 'estimated')
  assert.ok(est.caveats.some((/** @type {string} */ c) => c.includes('assessment caps')))
})

test('no market value means no surcharge computed, not a zero', () => {
  const t = tax({ building_class: 'R4', tax_class: '2', listed_by_source: 'Y' })
  assert.equal(t.surcharge, null)
  assert.match(t.surcharge_formula, /cannot be computed/)
})

test('building rollup totals the surcharge across a co-op', () => {
  const rec = { building_class: 'R4', tax_class: '2', market_value: 1_500_000, assessed_value: 200_000, listed_by_source: 'Y' }
  const row = { building_key: 'k', address: '1 A St', borough: 'Manhattan', bbl: null, property_type: 'condo', flags: evaluate(rec), tax: tax(rec) }
  const b = aggregateBuildings([row, row])[0]
  assert.equal(Math.round(b.total_surcharge), 120_000)
  assert.equal(Math.round(b.total_current_tax), Math.round(2 * 200_000 * 0.125))
})

test('DOF thresholds: $1M or more for units, more than $5M for homes', () => {
  assert.equal(evaluate({ building_class: 'R4', market_value: 1_000_000 }).affected, true)
  assert.equal(evaluate({ building_class: 'R4', market_value: 999_999 }).affected, false)
  assert.equal(evaluate({ building_class: 'A1', market_value: 5_000_000 }).affected, false)
  assert.equal(evaluate({ building_class: 'A1', market_value: 5_000_001 }).affected, true)
})

// ------------------------------------------------------------ co-op ranking

test('co-op per-apartment surcharge divides the building charge by its apartment count', () => {
  // 40-apartment co-op building, DOF value $60M -> top band 6.5% -> $3.9M on the corporation
  const rec = { building_class: 'D4', tax_class: '2', market_value: 60_000_000, listed_by_source: 'Y' }
  const t = estimateTax(rec, evaluate(rec))
  assert.equal(t.rate, 0.065)
  assert.equal(Math.round(t.surcharge), 3_900_000)
  assert.equal(Math.round(t.surcharge / 40), 97_500, 'per apartment is the building charge over the door count')
})

test('a small, very valuable co-op outranks a big cheap one per apartment', () => {
  const per = (/** @type {number} */ v, /** @type {number} */ apts) => {
    const rec = { building_class: 'D4', tax_class: '2', market_value: v, listed_by_source: 'Y' }
    return estimateTax(rec, evaluate(rec)).surcharge / apts
  }
  const boutique = per(60_000_000, 8)     // $7.5M per apartment
  const bigBlock = per(120_000_000, 400)  // $300k per apartment
  assert.ok(boutique > bigBlock, 'the building total hides which shareholders are actually exposed')
  assert.equal(Math.round(boutique), 487_500)
  assert.equal(Math.round(bigBlock), 19_500)
})

test('a co-op is tested per apartment, so a big moderate-income building is not caught', () => {
  // Co-op City style: a $606M parcel across 10,914 apartments is ~$56k each — far under $1M.
  const perApt = Math.round(606_304_000 / 10_914)
  assert.ok(perApt < 1_000_000)
  const f = evaluate({ building_class: 'D4', tax_class: '2', market_value: perApt, listed_by_source: 'Y' })
  assert.equal(estimateTax({ building_class: 'D4', tax_class: '2', market_value: perApt }, f).surcharge, null,
    'testing the building total instead would charge a moderate-income co-op millions a year')
  // ...while a small high-value loft co-op is: $31.7M across 5 apartments is $6.34M each.
  const loft = Math.round(31_700_000 / 5)
  const lf = evaluate({ building_class: 'D4', tax_class: '2', market_value: loft, listed_by_source: 'Y' })
  const lt = estimateTax({ building_class: 'D4', tax_class: '2', market_value: loft }, lf)
  assert.equal(lt.rate, 0.065)
  assert.equal(Math.round(lt.surcharge), Math.round(loft * 0.065))
})

test('the fast path builds no prose — that is what keeps a 31.5k-record load viable', () => {
  const fast = evaluate({ building_class: 'R4', market_value: 1_400_000, listed_by_source: 'Y' })
  assert.equal(fast.checks.length, 0)
  assert.equal(fast.explain, '')
  assert.equal(estimateTax({ building_class: 'R4', market_value: 1_400_000 }, fast).surcharge_formula, '')
  // ...and the verbose path still says everything
  const full = explainFlags({ building_class: 'R4', market_value: 1_400_000, listed_by_source: 'Y' })
  assert.ok(full.checks.length >= 4)
  assert.ok(full.explain.length > 80)
  assert.equal(fast.affected, full.affected, 'the two paths must never disagree on the verdict')
  assert.equal(fast.status, full.status)
  assert.deepEqual(fast.review, full.review)
})

test('the band edge below a property is worth money, and the arithmetic is exact', () => {
  // A condo at $1,000,204 is $205 over the $1M line. Falling below it removes the whole 4% charge.
  const rec = { building_class: 'R4', tax_class: '2', market_value: 1_000_204, listed_by_source: 'Y' }
  const t = estimateTax(rec, evaluate(rec))
  assert.equal(t.floor_edge, 1_000_000)
  assert.equal(t.appeal_drop, 205)
  assert.equal(Math.round(t.appeal_saving), Math.round(t.surcharge), 'below the threshold there is no surcharge at all')
  assert.equal(onCliff(t, 1_000_204), true)

  // Crossing an interior edge drops one band, not the whole charge.
  const mid = { building_class: 'R4', tax_class: '2', market_value: 3_010_000, listed_by_source: 'Y' }
  const mt = estimateTax(mid, evaluate(mid))
  assert.equal(mt.floor_edge, 3_000_000)
  assert.equal(mt.appeal_drop, 10_001)
  assert.equal(Math.round(mt.appeal_saving), Math.round(3_010_000 * 0.0525 - 2_999_999 * 0.04))
  assert.ok(mt.appeal_saving > 38_000)

  // Mid-band properties are not on a cliff — a 10% haircut would not change the band.
  const flat = { building_class: 'R4', tax_class: '2', market_value: 2_500_000, listed_by_source: 'Y' }
  assert.equal(onCliff(estimateTax(flat, evaluate(flat)), 2_500_000), false)
})

/**
 * The tool outlives the exemption deadline: the Tax Commission window runs to March 2027, and the
 * dates differ by tax class. Getting the phase wrong would either shout an expired deadline at
 * people or hide a live one, so the boundaries are pinned with an injected clock.
 */
test('deadline phase switches from exemption to appeal, with the right date per tax class', () => {
  const condo = { building_class: 'R4', tax_class: '2', market_value: 2_000_000, listed_by_source: 'Y' }
  const home = { building_class: 'A1', tax_class: '1', market_value: 9_000_000, listed_by_source: 'Y' }
  const at = (/** @type {string} */ d) => new Date(d + 'T12:00:00').getTime()

  // Class 2 files by 1 March 2027; Class 1 by 15 March 2027.
  assert.equal(deadlines(condo, at('2026-07-29')).appeal.date, '2027-03-01')
  assert.equal(deadlines(home, at('2026-07-29')).appeal.date, '2027-03-15')

  // Before the August exemption deadline, that is what leads.
  assert.equal(deadlines(condo, at('2026-07-29')).phase, 'exemption')
  // A co-op gets the later of the two exemption dates (24 August, not 21).
  const coop = { building_class: 'D4', tax_class: '2', market_value: 1_500_000, apartments: 4, listed_by_source: 'Y' }
  assert.equal(deadlines(coop, at('2026-08-22')).phase, 'exemption', 'co-op exemption closes 24 August')
  assert.equal(deadlines(condo, at('2026-08-22')).phase, 'appeal', 'a condo has already passed 21 August')

  // Between the windows the appeal is the live route; after March both are shut.
  assert.equal(deadlines(condo, at('2027-02-01')).phase, 'appeal')
  assert.equal(deadlines(condo, at('2027-03-05')).phase, 'closed', 'Class 2 shuts 1 March')
  assert.equal(deadlines(home, at('2027-03-05')).phase, 'appeal', 'Class 1 still has until 15 March')
  assert.equal(deadlines(home, at('2027-04-01')).phase, 'closed')
})

/**
 * The threshold test and the rate table must never disagree. The home rule is "more than $5M"
 * (`gt`) while the first home band starts AT $5M, so the boundary case is the one that can slip
 * through and produce a bill for a property its own bucket calls below-threshold.
 */
test('a property under its own threshold is never charged, whatever the band table says', () => {
  const at5m = { building_class: 'A1', tax_class: '1', market_value: 5_000_000, listed_by_source: 'Y' }
  const f = evaluate(at5m)
  const t = estimateTax(at5m, f)
  assert.equal(f.bucket, 'below_threshold', '"more than $5,000,000" excludes exactly $5,000,000')
  assert.equal(t.surcharge, null, 'and so nothing may be charged')
  assert.equal(t.band, null)

  // One dollar more is charged, so the guard has not simply switched the band table off.
  const over = { ...at5m, market_value: 5_000_001 }
  assert.ok(estimateTax(over, evaluate(over)).surcharge > 0)

  // The condo edge is inclusive (`gte`) and must still charge exactly at the line.
  const condo = { building_class: 'R4', tax_class: '2', market_value: 1_000_000, listed_by_source: 'Y' }
  assert.ok(estimateTax(condo, evaluate(condo)).surcharge > 0, '"$1,000,000 or more" includes exactly $1M')
})

/**
 * The existing-tax figure must come from DOF's published taxable value, not the statutory ratio.
 * Estimating from the ratio overstated 1-3 family homes by a median 2.6x because it ignores the
 * Class 1 assessment caps — one Upper East Side house read $547,754 against an actual $111,530.
 */
test('a supplied assessed value is used verbatim and stamped as source', () => {
  const withAv = { building_class: 'A7', tax_class: '1', market_value: 27_437_000, assessed_value: 555_000, listed_by_source: 'Y' }
  const t = explainTax(withAv, evaluate(withAv))
  assert.equal(t.assessed, 555_000, 'DOF’s taxable value must not be re-derived')
  assert.equal(t.assessed_source, 'source')
  assert.match(t.current_formula, /from source/)

  // Without one it still falls back, and says so — a missing join must degrade, not silently lie.
  const noAv = { ...withAv, assessed_value: null }
  const e = explainTax(noAv, evaluate(noAv))
  assert.equal(e.assessed_source, 'estimated')
  assert.ok(e.assessed > t.assessed, 'the ratio overstates a capped Class 1 home, which is the point')
})

/**
 * A co-op building on the roll but under the per-apartment line owes nothing, and every signal
 * has to agree. `flags.affected` is `listed || overAny`, so it is TRUE here — which is why the UI
 * must gate urgency on a computed surcharge instead. Most of the roll's co-op buildings are in
 * this position, and telling them a deadline is running is the failure this pins.
 */
test('a listed co-op under the per-apartment line owes nothing, and says so', () => {
  // 400 apartments, $180M parcel -> $450k each: on the roll, nowhere near the $1M line.
  const rec = {
    building_class: 'D4', tax_class: '2', listed_by_source: 'Y',
    market_value: 450_000, building_market_value: 180_000_000, apartments: 400,
  }
  const flags = evaluate(rec)
  const tax = estimateTax(rec, flags)

  assert.equal(flags.status, 'listed', 'DOF published it, so it is listed')
  assert.equal(flags.bucket, 'below_threshold')
  assert.ok(flags.review.includes('listed_but_below'))
  assert.ok(!tax.surcharge, 'nothing is owed under the published rules')
  assert.equal(flags.affected, true,
    'affected is listed||overAny — this is exactly why the UI must not gate urgency on it')

  // The same record, tested the wrong way round, is the bug that keeps coming back.
  const asParcel = { ...rec, market_value: 180_000_000, apartments: null }
  assert.ok(estimateTax(asParcel, evaluate(asParcel)).surcharge > 0,
    'testing the parcel total instead of the apartment would charge this building')
})

/**
 * The sales join, against the built dataset. Two things can silently break it: DOF files an
 * apartment sale against the building's BASE lot while the roll carries the condo UNIT lot (a
 * BBL-only join matched 12 condos out of 12,375), and a recorded sale must never become a
 * valuation input — the surcharge is charged on DOF's figure and nothing else.
 */
test('last-sale context joins widely and never reaches the valuation', () => {
  assert.ok(!POLICY.value_field_priority.includes('last_sale_price'),
    'a recorded sale must never be a source for the value the surcharge is charged on')

  const file = new URL('../dist/properties.json', import.meta.url)
  if (!existsSync(file)) return
  const { records } = JSON.parse(readFileSync(file, 'utf8'))
  const withSale = records.filter((/** @type {any} */ r) => r.last_sale_price != null)
  assert.ok(withSale.length > records.length * 0.5,
    `only ${withSale.length} of ${records.length} matched a sale — the building fallback is probably broken`)

  // Condos are the population the BBL-only join missed entirely, so they get their own floor.
  const condos = records.filter((/** @type {any} */ r) => classify(r).type === 'condo')
  const condoHits = condos.filter((/** @type {any} */ r) => r.last_sale_price != null)
  assert.ok(condoHits.length > condos.length * 0.5,
    `only ${condoHits.length} of ${condos.length} condos matched — check the address index`)

  // A house is valued toward sale value; a condo/co-op is valued from rental income. If those two
  // medians ever converge, the join has started matching the wrong things to each other.
  const median = (/** @type {string} */ type) => {
    const a = records
      .filter((/** @type {any} */ r) => classify(r).type === type && r.last_sale_price != null)
      .map((/** @type {any} */ r) => r.last_sale_price / evaluate(r).value_used)
      .filter((/** @type {number} */ x) => Number.isFinite(x) && x > 0)
      .sort((/** @type {number} */ a, /** @type {number} */ b) => a - b)
    return a[Math.floor(a.length / 2)]
  }
  assert.ok(median('home_1_3') < 1.5, 'houses should sell near DOF value')
  assert.ok(median('condo') > 1.8, 'condos should sell well above DOF’s rental-income value')
})

/**
 * The revenue sanity check, run against the real roll when one is built. A co-op row is a whole
 * building divided down to one apartment, so any citywide total has to multiply it back — counting
 * it once understated the roll by ~$320M and is the worst bug this app has had. The city's own
 * estimate is ~$500M net; gross with nobody exempt should land near $2.9B, and never above $3.5B.
 */
test('citywide gross scales co-op buildings by their apartment count', () => {
  const file = new URL('../dist/properties.json', import.meta.url)
  if (!existsSync(file)) return // no built dataset in a fresh clone — nothing to check
  const { records } = JSON.parse(readFileSync(file, 'utf8'))
  let gross = 0, perRow = 0
  for (const r of records) {
    const flags = evaluate(r)
    const s = estimateTax(r, flags).surcharge ?? 0
    const homes = classify(r).type === 'coop' && (r.apartments ?? 0) >= 2 ? r.apartments : 1
    gross += s * homes
    perRow += s
  }
  assert.ok(gross > 2.5e9 && gross < 3.5e9, `gross ${(gross / 1e9).toFixed(2)}B is outside the sane band`)
  assert.ok(gross - perRow > 3e8, 'co-op buildings barely moved the total — scaling is probably lost')
})

/**
 * The macro view's denominator. Its whole claim is that numerator and denominator are the same kind
 * of thing — rows on the two DOF files, where a co-op building counts once on both sides — so the
 * failure worth catching is a denominator that has quietly stopped being comparable: counted from a
 * different source, a stale year, or a filtered file. Any of those move the share off ~3%, which is
 * the one number a reader will quote from that page.
 */
test('the citywide denominator stays comparable with the roll it divides', () => {
  const file = new URL('../dist/properties.json', import.meta.url)
  if (!existsSync(file)) return
  const { meta, records } = JSON.parse(readFileSync(file, 'utf8'))
  if (!meta.universe) return // never built — the macro view hides the column rather than guessing

  const { total, by_borough } = meta.universe
  assert.ok(total > records.length, `denominator ${total} is not larger than the roll it contains`)
  const share = records.length / total
  assert.ok(share > 0.01 && share < 0.1,
    `roll is ${(share * 100).toFixed(2)}% of the city — outside the band, so the two are probably not counting the same unit`)

  // Every borough on the roll needs a denominator, or its row silently reads "—" on the page.
  const onRoll = new Set(records.map((/** @type {any} */ r) => r.borough).filter(Boolean))
  for (const b of onRoll) assert.ok(by_borough[b]?.total > 0, `no citywide count for ${b}`)
  assert.equal(
    Object.values(by_borough).reduce((/** @type {number} */ a, /** @type {any} */ v) => a + v.total, 0),
    total,
    'borough counts do not sum to the citywide total',
  )

  // Manhattan is the whole story of this roll; if it ever stops being the densest borough on it,
  // either the join broke or the policy changed, and both are worth failing a build over.
  const rollBy = /** @type {Record<string, number>} */ ({})
  for (const r of records) if (r.borough) rollBy[r.borough] = (rollBy[r.borough] ?? 0) + 1
  const densest = Object.entries(rollBy).sort((a, b) => b[1] / by_borough[b[0]].total - a[1] / by_borough[a[0]].total)[0]
  assert.equal(densest[0], 'Manhattan', `${densest[0]} is now the densest borough on the roll`)
})

console.log(process.exitCode ? `\n${n} passed, some FAILED` : `${n} checks passed`)
