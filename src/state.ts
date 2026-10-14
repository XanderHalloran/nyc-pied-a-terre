// Filter state lives in the URL. That makes every view shareable with no extra machinery,
// and the back button works for free.

import { useCallback, useEffect, useState } from 'react'

export interface Filters {
  q: string
  boroughs: string[]
  types: string[]
  status: string[]
  buckets: string[]
  taxClass: string[]
  bands: string[]
  zip: string
  buildingClass: string
  minValue: number | null
  minUnits: number | null
  onlyReview: boolean
  onlyMissing: boolean
  onlyNearCutoff: boolean
  onlyNoOccupancy: boolean
  onlyCliff: boolean
}

export const EMPTY: Filters = {
  q: '', boroughs: [], types: [], status: [], buckets: [], taxClass: [], bands: [],
  zip: '', buildingClass: '', minValue: null, minUnits: null,
  onlyReview: false, onlyMissing: false, onlyNearCutoff: false, onlyNoOccupancy: false, onlyCliff: false,
}

/**
 * Where a new visitor starts: the city's published roll. Everything currently loaded is on it, so
 * this changes nothing about what is shown — it makes visible WHAT you are looking at, and it is
 * the filter that does the work the moment any other source is loaded alongside the roll.
 */
export const DEFAULT: Filters = { ...EMPTY, status: ['listed'] }

/** How many filters the user has applied, for the reset button's badge. */
export function activeFilterCount(f: Filters) {
  let n = 0
  if (f.q) n++
  if (f.zip) n++
  if (f.buildingClass) n++
  for (const k of ARRAY_KEYS) {
    // the default status selection is the baseline, not a user-applied filter
    if (k === 'status' && f.status.length === 1 && f.status[0] === 'listed') continue
    if (f[k].length) n++
  }
  for (const k of BOOL_KEYS) if (f[k]) n++
  for (const k of NUM_KEYS) if (f[k] != null) n++
  return n
}

export const isDefaultFilters = (f: Filters) =>
  filtersToParams(f).toString() === filtersToParams(DEFAULT).toString()

export const BANDS = [
  { id: 'u500', label: 'Under $500k', min: 0, max: 500_000 },
  { id: '500k1m', label: '$500k – $1M', min: 500_000, max: 1_000_000 },
  { id: '1m2m', label: '$1M – $2M', min: 1_000_000, max: 2_000_000 },
  { id: '2m5m', label: '$2M – $5M', min: 2_000_000, max: 5_000_000 },
  { id: '5m10m', label: '$5M – $10M', min: 5_000_000, max: 10_000_000 },
  { id: 'o10m', label: 'Over $10M', min: 10_000_000, max: Infinity },
]

const ARRAY_KEYS = ['boroughs', 'types', 'status', 'buckets', 'taxClass', 'bands'] as const
const BOOL_KEYS = ['onlyReview', 'onlyMissing', 'onlyNearCutoff', 'onlyNoOccupancy', 'onlyCliff'] as const
const NUM_KEYS = ['minValue', 'minUnits'] as const

export function filtersToParams(f: Filters, extra: Record<string, string | null> = {}) {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.zip) p.set('zip', f.zip)
  if (f.buildingClass) p.set('bc', f.buildingClass)
  for (const k of ARRAY_KEYS) if (f[k].length) p.set(k, f[k].join(','))
  for (const k of BOOL_KEYS) if (f[k]) p.set(k, '1')
  for (const k of NUM_KEYS) if (f[k] != null) p.set(k, String(f[k]))
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  return p
}

export function paramsToFilters(p: URLSearchParams): Filters {
  const f: Filters = { ...EMPTY, q: p.get('q') ?? '', zip: p.get('zip') ?? '', buildingClass: p.get('bc') ?? '' }
  for (const k of ARRAY_KEYS) f[k] = p.get(k)?.split(',').filter(Boolean) ?? []
  for (const k of BOOL_KEYS) f[k] = p.get(k) === '1'
  for (const k of NUM_KEYS) { const v = p.get(k); f[k] = v == null || v === '' ? null : Number(v) }
  return f
}

export const isEmptyFilters = (f: Filters) => filtersToParams(f).toString() === ''

/** Params that address something other than the filter set, so they never count as "filtered". */
const NON_FILTER = new Set(['sel', 'cmp', 'view'])

/** Filters + selection + compare set + open document, mirrored into the address bar on every change. */
export function useUrlState() {
  const read = () => new URLSearchParams(location.search)
  // A link that carries any filter is honoured exactly, including one that deliberately clears
  // the status chip. Only an unparameterised visit gets the default.
  const fromUrl = (p: URLSearchParams) =>
    [...p.keys()].some((k) => !NON_FILTER.has(k)) ? paramsToFilters(p) : { ...DEFAULT }
  const [filters, setFilters] = useState<Filters>(() => fromUrl(read()))
  const [selected, setSelected] = useState<string | null>(() => read().get('sel'))
  const [compare, setCompare] = useState<string[]>(() => read().get('cmp')?.split(',').filter(Boolean) ?? [])
  // `view` puts the methodology in the address bar, so a journalist can cite a section of it.
  const [view, setView] = useState<string | null>(() => read().get('view'))
  // Captured once, before the effect below writes the default params back.
  const [bare] = useState(() => [...read().keys()].length === 0)

  // Debounced, because this fires on every keystroke in the search box. Analytics counts a history
  // change as a pageview, so an un-debounced write reported one visitor typing an address as a
  // dozen pageviews — 26,614 against 2,135 visitors on the first big traffic day. It also spared
  // the address bar a write per character.
  useEffect(() => {
    const write = () => {
      const p = filtersToParams(filters, { sel: selected, cmp: compare.join(',') || null, view })
      // Default chips (status=listed) must not land in the address bar — Google soft-404s
      // https://thelist.traqqit.com/?status=listed as an empty SPA shell.
      const onlyDefault =
        !selected &&
        compare.length === 0 &&
        !view &&
        filtersToParams(filters).toString() === filtersToParams(DEFAULT).toString()
      const url = onlyDefault
        ? location.pathname
        : `${location.pathname}${p.toString() ? '?' + p : ''}`
      if (url !== location.pathname + location.search) history.replaceState(null, '', url)
    }
    const t = setTimeout(write, 400)
    return () => clearTimeout(t)
  }, [filters, selected, compare, view])

  // Back/forward should restore the view.
  useEffect(() => {
    const onPop = () => {
      const p = read()
      setFilters(fromUrl(p))
      setSelected(p.get('sel'))
      setCompare(p.get('cmp')?.split(',').filter(Boolean) ?? [])
      setView(p.get('view'))
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const patch = useCallback((d: Partial<Filters>) => setFilters((f) => ({ ...f, ...d })), [])
  const toggleCompare = useCallback((id: string) => {
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 5 ? c : [...c, id]))
  }, [])

  return { filters, setFilters, patch, selected, setSelected, compare, setCompare, toggleCompare, view, setView, bare }
}

/** Narrative starting points — a filter set with a name, nothing more. `simple` ones also show in Simple mode. */
export const BOOKMARKS: { label: string; note: string; simple?: boolean; filters: Partial<Filters> }[] = [
  {
    label: 'The $1M condo/co-op cohort',
    note: 'Condos and co-ops caught by the reported $1M initial-phase threshold, the properties a $5M assumption would have missed.',
    simple: true,
    filters: { types: ['condo', 'coop'], buckets: ['condo_coop_initial'], bands: ['1m2m'] },
  },
  {
    label: 'Lower Manhattan condos over threshold',
    note: 'Manhattan condos at or over the reported threshold.',
    filters: { boroughs: ['Manhattan'], types: ['condo'], buckets: ['condo_coop_initial'] },
  },
  {
    label: 'Brooklyn buildings with many flagged units',
    note: 'Brooklyn properties in buildings of 25+ flagged units. Switch to the Buildings tab.',
    filters: { boroughs: ['Brooklyn'], minUnits: 25, status: ['listed', 'inferred'] },
  },
  {
    label: 'Co-ops and the billing problem',
    note: 'Co-op units, where the charge may land on the corporation rather than the shareholder.',
    simple: true,
    filters: { types: ['coop'], status: ['listed', 'inferred'] },
  },
  {
    label: 'On a rate cliff',
    note: 'A small reduction in DOF’s value would drop the property a whole rate band, or below the threshold entirely. The population with the strongest reason to look at a Tax Commission appeal.',
    simple: true,
    filters: { onlyCliff: true },
  },
  {
    label: 'Right on the cutoff',
    note: 'Within 10% of a threshold: the population whose outcome flips on which valuation the city uses.',
    simple: true,
    filters: { onlyNearCutoff: true },
  },
  {
    label: 'Listed but under threshold',
    note: 'On the published list yet below every threshold in the policy. Either the reported rule is wrong or the listing is.',
    filters: { status: ['listed'], buckets: ['below_threshold', 'unknown'] },
  },
  {
    label: 'No owner-occupancy evidence',
    note: 'The deciding fact, primary residence, is missing from the source data.',
    filters: { onlyNoOccupancy: true, status: ['listed'] },
  },
  {
    label: 'Needs review',
    note: 'Anything with a data-quality problem: missing value, unclassified type, approximated position.',
    filters: { onlyReview: true },
  },
]
