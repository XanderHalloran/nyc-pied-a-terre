import { useMemo, useState } from 'react'
import type { Row } from '../../types'
import { coopLeaderboard, money, moneyFull, download, stamp, type CoopRank } from '../../lib/data'
import { toCsvRow } from '../../lib/normalize.mjs'

type Key = 'perApartmentSurcharge' | 'perApartment' | 'buildingSurcharge' | 'apartments' | 'value'

const COLS: { k: Key; label: string; title?: string }[] = [
  { k: 'perApartmentSurcharge', label: 'Per apartment / yr', title: 'The building surcharge divided by the number of apartments' },
  { k: 'perApartment', label: 'Value per apartment' },
  { k: 'apartments', label: 'Apartments' },
  { k: 'buildingSurcharge', label: 'Whole building / yr' },
  { k: 'value', label: 'DOF value (building)' },
]

const val = (c: CoopRank, k: Key) =>
  k === 'value' ? c.buildingValue ?? 0 : k === 'perApartment' ? c.perApartment : c[k]

export default function CoopLeaderboard({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'perApartmentSurcharge', dir: -1 })
  const [maxApts, setMaxApts] = useState<number | null>(null)

  const { ranked, unranked } = useMemo(() => coopLeaderboard(rows), [rows])
  const list = useMemo(() => {
    const l = maxApts ? ranked.filter((c) => c.apartments <= maxApts) : ranked
    return [...l].sort((a, b) => (val(a, sort.k) - val(b, sort.k)) * sort.dir)
  }, [ranked, sort, maxApts])

  const totals = useMemo(() => {
    const apts = ranked.reduce((a, c) => a + c.apartments, 0)
    const sur = ranked.reduce((a, c) => a + c.buildingSurcharge, 0)
    return { buildings: ranked.length, apts, sur, avg: apts ? sur / apts : 0 }
  }, [ranked])

  function exportCsv() {
    const cols = ['rank', 'address', 'borough', 'bbl', 'apartments', 'dof_building_value', 'value_per_apartment', 'rate', 'building_surcharge', 'surcharge_per_apartment']
    const lines = list.map((c, i) =>
      toCsvRow([
        i + 1, c.row.address, c.row.borough, c.row.bbl, c.apartments,
        c.buildingValue, Math.round(c.perApartment), c.rate,
        Math.round(c.buildingSurcharge), Math.round(c.perApartmentSurcharge),
      ]),
    )
    download(`nyc-coop-surcharge-per-apartment-${stamp()}.csv`, [toCsvRow(cols), ...lines].join('\n'))
  }

  if (!ranked.length)
    return (
      <div className="loading">
        <div style={{ maxWidth: 460, textAlign: 'center' }} className="muted">
          No co-op buildings with a known apartment count match the current filters.
          {unranked > 0 && <> {unranked.toLocaleString()} co-op record{unranked === 1 ? '' : 's'} could not be ranked.</>}
        </div>
      </div>
    )

  return (
    <>
      <div className="row wrap" style={{ padding: '7px 8px', gap: 10, borderBottom: '1px solid var(--line)' }}>
        <span className="mono small muted">
          <strong>{totals.buildings.toLocaleString()}</strong> co-op buildings · {totals.apts.toLocaleString()} apartments ·{' '}
          {money(totals.sur)}/yr total · {moneyFull(totals.avg)} average per apartment
        </span>
        <div className="grow" />
        <label className="row small" style={{ gap: 5 }}>
          <span className="dim">Small buildings only</span>
          <select
            value={maxApts ?? ''}
            onChange={(e) => setMaxApts(e.target.value ? Number(e.target.value) : null)}
            style={{ width: 'auto' }}
          >
            <option value="">any size</option>
            <option value="10">≤ 10 apartments</option>
            <option value="25">≤ 25 apartments</option>
            <option value="60">≤ 60 apartments</option>
          </select>
        </label>
        <button className="small" onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="small muted" style={{ padding: '6px 9px', borderBottom: '1px solid var(--line)', lineHeight: 1.5 }}>
        DOF assesses a co-op as one parcel, so the $1M threshold and the rate band are applied to the building value divided
        by its apartment count, giving the average apartment. Real co-op charges are allocated by <strong>shares</strong>, not per
        door, so a larger apartment carries more than this average and a studio less. {unranked > 0 && <>The other {unranked.toLocaleString()} co-op record{unranked === 1 ? '' : 's'} on the roll are individual units DOF already values one by one. Those sit in the Properties tab, not here.</>}
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th className="num" style={{ width: 40 }}>#</th>
            <th>Building</th>
            <th>Borough</th>
            {COLS.map((c) => (
              <th
                key={c.k}
                className="num"
                title={c.title}
                onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (-s.dir as 1 | -1) : -1 }))}
                aria-sort={sort.k === c.k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              >
                {c.label}
                {sort.k === c.k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.slice(0, 500).map((c, i) => (
            <tr key={c.row.id} tabIndex={0} onClick={() => onOpen(c.row.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.row.id)}>
              <td className="num dim mono">{i + 1}</td>
              <td className="truncate" style={{ maxWidth: 300 }}>
                {c.row.address}
                {c.row.public?.year_built ? <span className="dim small"> · {c.row.public.year_built}</span> : null}
              </td>
              <td className="muted">{c.row.borough ?? '—'}</td>
              <td className="num" style={{ color: 'var(--danger)', fontWeight: 600 }}>{moneyFull(c.perApartmentSurcharge)}</td>
              <td className="num muted">{money(c.perApartment)}</td>
              <td className="num">{c.apartments.toLocaleString()}</td>
              <td className="num muted">{money(c.buildingSurcharge)}</td>
              <td className="num muted">{money(c.buildingValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 500 && (
        <div className="pager small muted">Showing the top 500 by current sort. Export the CSV for all {list.length.toLocaleString()}.</div>
      )}
    </>
  )
}
