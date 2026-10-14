import { useEffect, useMemo, useRef, useState } from 'react'
import type { Row } from '../../types'
import { money, pct, REVIEW_LABEL } from '../../lib/data'
import { Dot, StatusBadge } from '../../components/ui'

const PAGE = 100

type Key = 'address' | 'borough' | 'type' | 'value' | 'status' | 'taxNow' | 'surcharge' | 'increase' | 'units' | 'review'

/**
 * `simple` columns are the five a non-specialist needs; the rest appear in Full data mode.
 * `sm` marks the three that survive a phone — where every row is on the list anyway, so the
 * status badge and type dot are just width. Full data keeps every column and scrolls sideways.
 */
const COLS: { k: Key; label: string; num?: boolean; title?: string; simple?: boolean; sm?: boolean }[] = [
  { k: 'address', label: 'Address', simple: true, sm: true },
  { k: 'borough', label: 'Borough' },
  { k: 'type', label: 'Type', simple: true },
  { k: 'value', label: 'Value', num: true, simple: true, sm: true },
  { k: 'status', label: 'Status', simple: true },
  { k: 'taxNow', label: 'Tax now', num: true, title: 'Current annual NYC property tax: DOF’s taxable assessed value × the class rate' },
  { k: 'surcharge', label: 'Extra per year', num: true, simple: true, sm: true, title: 'DOF’s published rate for this value band, applied to DOF’s own market value. Not a bill: it is not owed if the home is a primary residence.' },
  { k: 'increase', label: 'vs now', num: true, title: 'Estimated surcharge as a share of the current bill' },
  { k: 'units', label: 'Units in bldg', num: true },
  { k: 'review', label: 'Review' },
]

const value = (r: Row, k: Key): string | number => {
  switch (k) {
    case 'address': return `${r.address} ${r.unit ?? ''}`
    case 'borough': return r.borough ?? ''
    case 'type': return r.type
    case 'value': return r.flags.value_used ?? -1
    case 'status': return r.flags.status
    case 'taxNow': return r.tax.current ?? -1
    case 'surcharge': return r.tax.surcharge ?? -1
    case 'increase': return r.tax.increase_pct ?? -1
    case 'units': return r.units_in_building
    case 'review': return r.flags.review.length
  }
}

/**
 * "Not found" is the good outcome for an owner, but it is also what a typo looks like. Say both.
 */
function EmptyState({ query }: { query: string }) {
  if (!query.trim()) return <div className="loading">No properties match these filters.</div>
  return (
    <div className="loading">
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
          Nothing on the roll matches “{query}”
        </div>
        <p className="muted small" style={{ lineHeight: 1.6, margin: 0 }}>
          If that is your address, it is not on the roll DOF published on 24 July 2026, which is the good outcome. Before relying on it, check the obvious: condominium and co-op units are listed
          <strong> individually by apartment</strong>, so try the street address on its own; house numbers
          on the roll can be ranges (“163-15-163-19”); and the roll covers tax years {'2026-27 and 2027-28'} only.
          The city’s own lookup at <strong>nyc.gov/npsurcharge</strong> is the authority.
        </p>
      </div>
    </div>
  )
}

interface Props {
  rows: Row[]
  query: string
  selected: string | null
  onSelect: (id: string) => void
  compare: string[]
  onToggleCompare: (id: string) => void
  expert: boolean
  favs: string[]
  onToggleFav: (id: string) => void
}

export default function PropertyTable({ rows, query, selected, onSelect, compare, onToggleCompare, expert, favs, onToggleFav }: Props) {
  const cols = expert ? COLS : COLS.filter((c) => c.simple)
  const show = (k: Key) => expert || COLS.find((c) => c.k === k)?.simple === true
  /** Dropped by CSS below 720px. Full data keeps everything and scrolls. */
  const sm = (k: Key) => (expert || COLS.find((c) => c.k === k)?.sm ? '' : 'hide-sm')
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'value', dir: -1 })
  const [page, setPage] = useState(0)
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  const sorted = useMemo(() => {
    const s = [...rows]
    s.sort((a, b) => {
      const x = value(a, sort.k), y = value(b, sort.k)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
    return s
  }, [rows, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const p = Math.min(page, pages - 1)
  const slice = sorted.slice(p * PAGE, p * PAGE + PAGE)

  // Keep the selected row in view when it changes (e.g. picked on the map).
  useEffect(() => {
    if (!selected) return
    const i = sorted.findIndex((r) => r.id === selected)
    if (i >= 0) setPage(Math.floor(i / PAGE))
  }, [selected, sorted])

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('tr[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, p])

  const step = (d: number) => {
    const i = sorted.findIndex((r) => r.id === selected)
    const next = sorted[Math.max(0, Math.min(sorted.length - 1, (i < 0 ? -1 : i) + d))]
    if (next) onSelect(next.id)
  }

  if (!rows.length) return <EmptyState query={query} />

  return (
    <>
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 28 }} title="Save a property to come back to">★</th>
            <th style={{ width: 26 }} className={expert ? undefined : 'hide-sm'} title="Add to compare">⇄</th>
            {cols.map((c) => (
              <th
                key={c.k}
                className={[c.num ? 'num' : '', sm(c.k)].filter(Boolean).join(' ') || undefined}
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
        <tbody
          ref={bodyRef}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
            if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
          }}
        >
          {slice.map((r) => (
            <tr
              key={r.id}
              tabIndex={0}
              aria-selected={r.id === selected}
              onClick={() => onSelect(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(r.id)}
            >
              <td onClick={(e) => { e.stopPropagation(); onToggleFav(r.id) }}>
                <button
                  className={favs.includes(r.id) ? 'star on' : 'star'}
                  aria-pressed={favs.includes(r.id)}
                  aria-label={favs.includes(r.id) ? `Remove ${r.address} from saved` : `Save ${r.address}`}
                >
                  {favs.includes(r.id) ? '★' : '☆'}
                </button>
              </td>
              <td className={expert ? undefined : 'hide-sm'} onClick={(e) => { e.stopPropagation(); onToggleCompare(r.id) }}>
                <input
                  type="checkbox"
                  checked={compare.includes(r.id)}
                  onChange={() => {}}
                  aria-label={`Compare ${r.address}`}
                  disabled={!compare.includes(r.id) && compare.length >= 5}
                />
              </td>
              <td className="truncate" style={{ maxWidth: 300 }}>
                {r.address}
                {r.unit ? <span className="dim"> · {r.unit}</span> : null}
              </td>
              {show('borough') && <td className="muted">{r.borough ?? '—'}</td>}
              <td className={sm('type') || undefined}>
                <Dot type={r.type} />
                <span className="small">{r.type === 'home_1_3' ? 'house' : r.type === 'coop' ? 'co-op' : r.type}</span>
              </td>
              <td className="num">{money(r.flags.value_used)}</td>
              <td className={sm('status') || undefined}><StatusBadge status={r.flags.status} plain={!expert} /></td>
              {show('taxNow') && <td className="num muted">{money(r.tax.current)}</td>}
              <td className="num" style={r.tax.surcharge ? { color: 'var(--danger)' } : undefined}>
                {r.tax.surcharge ? money(r.tax.surcharge) : <span className="dim">—</span>}
                {!expert && r.tax.increase_pct ? <span className="dim small hide-sm"> {pct(r.tax.increase_pct)}</span> : null}
              </td>
              {show('increase') && (
                <td className="num" style={r.tax.increase_pct ? { color: 'var(--warn)' } : undefined}>
                  {r.tax.increase_pct ? pct(r.tax.increase_pct) : <span className="dim">—</span>}
                </td>
              )}
              {show('units') && <td className="num">{r.units_in_building}</td>}
              {show('review') && (
                <td>
                  {r.flags.review.length ? (
                    <span className="badge review" title={r.flags.review.map((x) => REVIEW_LABEL[x] ?? x).join(' · ')}>
                      {r.flags.review.length}
                    </span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <button onClick={() => setPage(0)} disabled={p === 0}>« First</button>
          <button onClick={() => setPage(p - 1)} disabled={p === 0}>‹ Prev</button>
          <span className="mono small muted">
            {(p * PAGE + 1).toLocaleString()}–{Math.min(sorted.length, (p + 1) * PAGE).toLocaleString()} of {sorted.length.toLocaleString()}
          </span>
          <button onClick={() => setPage(p + 1)} disabled={p >= pages - 1}>Next ›</button>
          <button onClick={() => setPage(pages - 1)} disabled={p >= pages - 1}>Last »</button>
        </div>
      )}
    </>
  )
}
