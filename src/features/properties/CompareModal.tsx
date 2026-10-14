import type { Row } from '../../types'
import { moneyFull, pct, TYPE_LABEL, GEOCODE_LABEL } from '../../lib/data'
import { Modal, StatusBadge } from '../../components/ui'

const FIELDS: { label: string; get: (r: Row) => React.ReactNode }[] = [
  { label: 'Borough', get: (r) => r.borough ?? '—' },
  { label: 'ZIP', get: (r) => r.zip ?? '—' },
  { label: 'BBL', get: (r) => r.bbl ?? '—' },
  { label: 'Type', get: (r) => TYPE_LABEL[r.type] },
  { label: 'Building class', get: (r) => r.building_class ?? '—' },
  { label: 'Tax class', get: (r) => r.tax_class ?? '—' },
  { label: 'Valuation used', get: (r) => moneyFull(r.flags.value_used) },
  { label: 'Value field', get: (r) => r.flags.value_field ?? '—' },
  { label: 'Market value', get: (r) => moneyFull(r.market_value) },
  { label: 'Assessed value', get: (r) => moneyFull(r.assessed_value) },
  { label: 'Threshold', get: (r) => (r.flags.threshold != null ? moneyFull(r.flags.threshold) : '—') },
  { label: 'Rule', get: (r) => r.flags.rule_label ?? '—' },
  { label: 'Flag status', get: (r) => <StatusBadge status={r.flags.status} /> },
  { label: 'Flag confidence', get: (r) => r.flags.confidence },
  { label: 'Near cutoff', get: (r) => (r.flags.near_cutoff ? 'yes' : 'no') },
  { label: 'Occupancy signal', get: (r) => r.flags.occupancy.replace(/_/g, ' ') },
  { label: 'Tax now', get: (r) => moneyFull(r.tax.current) },
  { label: 'Est. surcharge', get: (r) => (r.tax.surcharge ? moneyFull(r.tax.surcharge) : '—') },
  { label: 'Would pay', get: (r) => moneyFull(r.tax.total) },
  { label: 'Increase', get: (r) => (r.tax.increase_pct != null ? pct(r.tax.increase_pct) : '—') },
  { label: 'Units in building', get: (r) => r.units_in_building },
  { label: 'Position', get: (r) => GEOCODE_LABEL[r.geocode_source ?? ''] ?? '—' },
  { label: 'Review flags', get: (r) => r.flags.review.join(', ') || '—' },
]

export default function CompareModal({ rows, onClose, onRemove }: { rows: Row[]; onClose: () => void; onRemove: (id: string) => void }) {
  return (
    <Modal title={`Compare ${rows.length} propert${rows.length === 1 ? 'y' : 'ies'}`} onClose={onClose} wide>
      {rows.length === 0 ? (
        <p className="muted">Tick the ⇄ column in the table, or use Compare in a property drawer. Up to five.</p>
      ) : (
        <>
          <div className="compare">
            {rows.map((r) => (
              <div className="card" key={r.id}>
                <div className="row">
                  <strong className="grow truncate">{r.address}{r.unit ? ` · ${r.unit}` : ''}</strong>
                  <button className="ghost small" onClick={() => onRemove(r.id)} aria-label={`Remove ${r.address}`}>✕</button>
                </div>
                <dl className="kv" style={{ gridTemplateColumns: '112px 1fr', marginTop: 7 }}>
                  {FIELDS.map((f) => (
                    <div key={f.label} style={{ display: 'contents' }}>
                      <dt>{f.label}</dt>
                      <dd>{f.get(r)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <h3>Plain-English explanations</h3>
          {rows.map((r) => (
            <div key={r.id} className="explain" style={{ marginBottom: 8 }}>
              <div className="tiny" style={{ marginBottom: 3 }}>{r.address}{r.unit ? ` · ${r.unit}` : ''}</div>
              {r.flags.explain}
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}
