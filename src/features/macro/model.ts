import type { Row } from '../../types'
import { POLICY, homesOnRow } from '../../lib/data'

/**
 * The citywide picture, and the one place where this site models rather than reports.
 *
 * Everything above this file is arithmetic on published figures. This file adds ONE unknown — how
 * much of the roll ends up exempt — because the interesting question about a $2.9B gross figure is
 * what is actually collected, and no public dataset answers it. The unknown is a parameter, not a
 * constant: `exemptShare` is a dial the reader moves, defaulted to the rate implied by the city's
 * own revenue estimate. Every assumption is listed in ASSUMPTIONS and rendered beside the diagram,
 * so nothing here is load-bearing without being stated.
 */

export type BoroughRow = {
  borough: string
  /** Every class 1 + 2 property in the borough — the denominator, or null if never built. */
  universe: number | null
  rows: number
  charged: number
  /** Rows expanded by co-op apartment count: the homes the money is actually spread across. */
  chargedHomes: number
  current: number
  currentCharged: number
  surcharge: number
}

export type Macro = ReturnType<typeof macro>

/**
 * @param rows every loaded record, already evaluated
 * @param universe `meta.universe` from `npm run universe`, or null
 * @param exemptShare 0–1, the share of the gross surcharge assumed to be exempted away
 */
export function macro(
  rows: Row[],
  universe: { total: number; by_borough: Record<string, { total: number }> } | null,
  exemptShare: number,
) {
  const by = new Map<string, BoroughRow>()
  const blank = (borough: string): BoroughRow => ({
    borough,
    universe: universe?.by_borough[borough]?.total ?? null,
    rows: 0, charged: 0, chargedHomes: 0, current: 0, currentCharged: 0, surcharge: 0,
  })

  for (const r of rows) {
    const b = by.get(r.borough ?? 'Unknown') ?? blank(r.borough ?? 'Unknown')
    by.set(b.borough, b)
    // A co-op row is a building. Counts stay in rows, because the citywide denominator is rows on
    // the same DOF files; money is per apartment, because that is who pays it. Mixing the two is
    // the single worst bug this dataset invites, so the two are named differently everywhere.
    const homes = homesOnRow(r)
    b.rows++
    b.current += (r.tax.current ?? 0) * homes
    if ((r.tax.surcharge ?? 0) > 0) {
      b.charged++
      b.chargedHomes += homes
      b.currentCharged += (r.tax.current ?? 0) * homes
      b.surcharge += (r.tax.surcharge as number) * homes
    }
  }

  const boroughs = [...by.values()].sort((a, b) => b.surcharge - a.surcharge)
  const sum = (k: keyof BoroughRow) => boroughs.reduce((a, b) => a + (b[k] as number), 0)

  const gross = sum('surcharge')
  const collected = gross * (1 - exemptShare)
  const rowsTotal = sum('rows')

  return {
    boroughs,
    universe: universe?.total ?? null,
    rows: rowsTotal,
    /** Roll rows as a share of every class 1 + 2 property in the city. */
    share: universe ? rowsTotal / universe.total : null,
    charged: sum('charged'),
    chargedHomes: sum('chargedHomes'),
    underLine: rowsTotal - sum('charged'),
    current: sum('current'),
    currentCharged: sum('currentCharged'),
    gross,
    exemptShare,
    exempt: gross - collected,
    collected,
    /** What the city says it expects to raise, for the dial to be checked against. */
    expected: POLICY.tax_model.expected_revenue,
    /** Surcharge over what the charged properties already pay — the increase a payer would feel. */
    increaseGross: sum('currentCharged') > 0 ? gross / sum('currentCharged') : null,
  }
}

/** The exempt share implied by the city's own revenue estimate, which is the dial's default. */
export function impliedExemptShare(gross: number) {
  const expected = POLICY.tax_model.expected_revenue
  if (!gross || gross <= expected) return 0
  return 1 - expected / gross
}

/**
 * Stated in full, next to the numbers they produce. A model whose assumptions are in a footnote is
 * a model nobody can argue with, and every one of these is arguable.
 */
export const ASSUMPTIONS: { id: string; label: string; note: string; modelled: boolean }[] = [
  {
    id: 'exempt-share',
    label: 'A single exemption rate, applied evenly',
    modelled: true,
    note: 'The one modelled input. Primary residence is the deciding fact and appears in no public '
      + 'dataset, so the share exempted is a dial rather than a measurement. It defaults to the rate '
      + "implied by the city's own revenue estimate. Applying one rate evenly is certainly wrong in "
      + 'detail: a Manhattan pied-à-terre is likelier to stay charged than a Bronx co-op, so the '
      + 'borough split of what is collected is softer than the borough split of the gross.',
  },
  {
    id: 'nobody-exempt',
    label: 'The gross figure assumes nobody is exempt',
    modelled: false,
    note: 'Every property that clears its threshold is charged in full. That is a ceiling, not a '
      + 'forecast, and it is the only figure here computed purely from published data.',
  },
  {
    id: 'rates',
    label: 'Surcharge rates are official; the existing-tax rates are FY2025',
    modelled: false,
    note: "The surcharge rate table is DOF's published schedule, a flat percentage of the full "
      + 'market value for the band. The existing bill uses FY2025 class tax rates against DOF\'s '
      + 'FY2027 taxable values. The City Council sets new rates annually, so the "pays now" side '
      + 'will drift while the surcharge side does not.',
  },
  {
    id: 'coop-units',
    label: 'Co-op rows are buildings, and only the money is divided',
    modelled: false,
    note: 'DOF assesses a co-op as one parcel while the threshold and rate apply per apartment. '
      + 'Property counts stay in roll rows, so they can be compared with the citywide denominator, '
      + 'which is rows on the same files. Dollars are counted per apartment, because that is who '
      + 'pays. The two numbers are deliberately not interchangeable.',
  },
  {
    id: 'denominator',
    label: 'The denominator is rows on the same two DOF files',
    modelled: false,
    note: 'Both supplemental roll files are published as every class 1 and class 2 property, so the '
      + 'share-of-city figure divides like by like. It is not a count of households, and a co-op '
      + 'building counts once on both sides of the fraction.',
  },
  {
    id: 'static',
    label: 'Nobody moves, sells, or appeals',
    modelled: true,
    note: 'A surcharge this size changes behaviour: some owners will make the property a primary '
      + 'residence, some will sell, and some will win a value appeal. None of that is modelled, '
      + 'which biases the collected figure high.',
  },
]
