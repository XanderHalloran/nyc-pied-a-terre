import { useMemo, useState } from 'react'
import type { BuildingRow, Row } from '../../types'
import { money, pct, TYPE_LABEL } from '../../lib/data'
import { Dot } from '../../components/ui'

type Key = 'address' | 'borough' | 'units' | 'listed' | 'inferred' | 'total_value'
  | 'avg_value' | 'dominant_type' | 'total_current_tax' | 'total_surcharge' | 'surcharge_pct'

const COLS: { k: Key; label: string; num?: boolean; title?: string }[] = [
  { k: 'address', label: 'Building' },
  { k: 'borough', label: 'Borough' },
  { k: 'dominant_type', label: 'Type' },
  { k: 'units', label: 'Records', num: true },
  { k: 'listed', label: 'On list', num: true },
  { k: 'inferred', label: 'Inferred', num: true },
  { k: 'total_value', label: 'Total valuation', num: true },
  { k: 'avg_value', label: 'Avg valuation', num: true },
  { k: 'total_current_tax', label: 'Tax now', num: true, title: 'Estimated current annual property tax across every record in this building' },
  { k: 'total_surcharge', label: 'Est. surcharge', num: true, title: 'MODELLED annual surcharge across this building. For a co-op this is the figure that could land on the corporation.' },
  { k: 'surcharge_pct', label: 'vs now', num: true },
]

interface Props {
  buildings: BuildingRow[]
  rows: Row[]
  onOpen: (id: string) => void
}

export default function BuildingTable({ buildings, rows, onOpen }: Props) {
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'listed', dir: -1 })
  const [coopOnly, setCoopOnly] = useState(false)

  const list = useMemo(() => {
    let l = buildings
    if (coopOnly) l = l.filter((b) => b.dominant_type === 'coop')
    return [...l].sort((a, b) => {
      const x = a[sort.k] ?? -1, y = b[sort.k] ?? -1
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [buildings, sort, coopOnly])

  const firstIn = (key: string) => rows.find((r) => r.building_key === key)?.id

  return (
    <>
      <div className="row wrap" style={{ padding: '6px 8px', gap: 10, borderBottom: '1px solid var(--line)' }}>
        <span className="mono small muted">{list.length.toLocaleString()} buildings</span>
        <button className="small" aria-pressed={coopOnly} onClick={() => setCoopOnly((v) => !v)}>
          Co-op buildings only
        </button>
        {coopOnly && (
          <span className="small dim">
            Co-ops are billed at the corporation, so the “Est. surcharge” column is the figure that may be recovered from all
            shareholders, not just the flagged units.
          </span>
        )}
      </div>
      <table className="grid">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.k}
                className={c.num ? 'num' : undefined}
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
          {list.slice(0, 400).map((b) => (
            <tr key={b.building_key} tabIndex={0} onClick={() => { const id = firstIn(b.building_key); if (id) onOpen(id) }} onKeyDown={(e) => { if (e.key === 'Enter') { const id = firstIn(b.building_key); if (id) onOpen(id) } }}>
              <td className="truncate" style={{ maxWidth: 320 }}>
                {b.address}
                {b.bbl && <span className="dim mono small"> · {b.bbl.slice(0, 6)}</span>}
              </td>
              <td className="muted">{b.borough ?? '—'}</td>
              <td>
                <Dot type={b.dominant_type} />
                <span className="small">{TYPE_LABEL[b.dominant_type] ?? b.dominant_type}</span>
              </td>
              <td className="num">{b.units}</td>
              <td className="num">{b.listed || <span className="dim">0</span>}</td>
              <td className="num">{b.inferred || <span className="dim">0</span>}</td>
              <td className="num">{money(b.total_value)}</td>
              <td className="num">{money(b.avg_value)}</td>
              <td className="num muted">{money(b.total_current_tax)}</td>
              <td className="num" style={b.total_surcharge ? { color: 'var(--danger)' } : undefined}>
                {b.total_surcharge ? money(b.total_surcharge) : <span className="dim">—</span>}
              </td>
              <td className="num" style={b.surcharge_pct ? { color: 'var(--warn)' } : undefined}>
                {b.surcharge_pct ? pct(b.surcharge_pct) : <span className="dim">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 400 && <div className="pager small muted">Showing the top 400 by current sort. Export the CSV for the full {list.length.toLocaleString()}.</div>}
    </>
  )
}
