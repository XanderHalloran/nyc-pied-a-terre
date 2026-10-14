import { BANDS, BOOKMARKS, DEFAULT, activeFilterCount, isDefaultFilters, type Filters } from '../../state'
import { POLICY, TYPE_COLOR, TYPE_LABEL, STATUS_LABEL, REVIEW_LABEL } from '../../lib/data'
import { Chip, Field, Toggle } from '../../components/ui'

const BUCKETS = [
  ...POLICY.thresholds.map((t) => ({ id: t.id, label: t.label })),
  { id: 'below_threshold', label: 'Below every threshold' },
  { id: 'unknown', label: 'No valuation on record' },
]

/**
 * Borough, type and value stay open — they are what people reach for. Everything else starts
 * folded with its active count in the summary, so a collapsed group can never hide a filter.
 */
function Group({ title, children, open = true, n = 0 }: { title: string; children: React.ReactNode; open?: boolean; n?: number }) {
  return (
    <details className="panel" open={open}>
      <summary>
        <span>{title}{n > 0 && <span className="on-count">{n}</span>}</span>
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  )
}

/** Simple mode says what the categories mean; Expert mode uses the engine's own vocabulary. */
const STATUS_PLAIN: Record<string, string> = {
  listed: 'On the city’s list',
  inferred: 'Fits the criteria',
  not_flagged: 'Looks unaffected',
}

interface Props {
  f: Filters
  patch: (d: Partial<Filters>) => void
  setFilters: (f: Filters) => void
  boroughs: string[]
  total: number
  shown: number
  expert: boolean
  /** Only meaningful below 720px, where this panel slides in over the map. */
  open?: boolean
  onClose?: () => void
}

export default function FilterPanel({ f, patch, setFilters, boroughs, total, shown, expert, open, onClose }: Props) {
  const toggle = (key: keyof Filters, v: string) => {
    const cur = f[key] as string[]
    patch({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<Filters>)
  }

  return (
    <aside className={open ? 'sidebar open' : 'sidebar'} aria-label="Filters">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="grow mono small">
          <strong>{shown.toLocaleString()}</strong> <span className="dim">/ {total.toLocaleString()}</span>
        </div>
        <button
          className={isDefaultFilters(f) ? 'ghost small' : 'primary small'}
          onClick={() => setFilters({ ...DEFAULT })}
          disabled={isDefaultFilters(f)}
          title="Back to the city's published list, with no other filters"
        >
          {isDefaultFilters(f) ? 'Reset' : `Reset (${activeFilterCount(f)})`}
        </button>
        <button className="small mobile-only" onClick={onClose} aria-label="Close filters">✕</button>
      </div>

      <Group title="Borough" n={f.boroughs.length}>
        <div className="chips">
          {boroughs.map((b) => (
            <Chip key={b} on={f.boroughs.includes(b)} onClick={() => toggle('boroughs', b)}>
              {b}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Property type" n={f.types.length}>
        <div className="chips">
          {(['condo', 'coop', 'home_1_3', 'unknown'] as const).map((t) => (
            <Chip key={t} on={f.types.includes(t)} onClick={() => toggle('types', t)} color={TYPE_COLOR[t]}>
              {TYPE_LABEL[t]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title={expert ? 'Flag status' : 'Status'} open={false} n={f.status.length}>
        <div className="chips">
          {(['listed', 'inferred', 'not_flagged'] as const).map((s) => (
            <Chip key={s} on={f.status.includes(s)} onClick={() => toggle('status', s)}>
              {expert ? STATUS_LABEL[s] : STATUS_PLAIN[s]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title={expert ? 'Valuation' : 'Value'} n={f.bands.length + (f.minValue != null ? 1 : 0)}>
        <div className="chips">
          {BANDS.map((b) => (
            <Chip key={b.id} on={f.bands.includes(b.id)} onClick={() => toggle('bands', b.id)}>
              {b.label}
            </Chip>
          ))}
        </div>
        <Field label="Only properties valued above">
          <input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 3000000"
            value={f.minValue ?? ''}
            onChange={(e) => patch({ minValue: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </Field>
      </Group>

      {!expert && (
        <Group title="Worth a look" n={f.onlyCliff ? 1 : 0}>
          <Toggle on={f.onlyCliff} onChange={(v) => patch({ onlyCliff: v })}>
            On a rate cliff <span className="dim">: a small reduction in the city’s value would drop the bill a whole band</span>
          </Toggle>
        </Group>
      )}

      {!expert && (
        <Group title="Start here" open={false}>
          {BOOKMARKS.filter((b) => b.simple).map((b) => (
            <button key={b.label} className="bookmark ghost" onClick={() => setFilters({ ...DEFAULT, ...b.filters })} title={b.note}>
              <b>{b.label}</b>
              <span>{b.note}</span>
            </button>
          ))}
        </Group>
      )}

      {expert && <>
      <Group title="Which rule applies" open={false} n={f.buckets.length}>
        <div className="chips">
          {BUCKETS.map((b) => (
            <Chip key={b.id} on={f.buckets.includes(b.id)} onClick={() => toggle('buckets', b.id)}>
              {b.label}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Classification & place" open={false} n={f.taxClass.length + (f.buildingClass ? 1 : 0) + (f.zip ? 1 : 0)}>
        <div className="tiny">Tax class</div>
        <div className="chips">
          {['1', '2', '4'].map((t) => (
            <Chip key={t} on={f.taxClass.includes(t)} onClick={() => toggle('taxClass', t)}>
              Class {t}
            </Chip>
          ))}
        </div>
        <Field label="Building class starts with">
          <input type="text" placeholder="R4, D, C6…" value={f.buildingClass} onChange={(e) => patch({ buildingClass: e.target.value })} />
        </Field>
        <Field label="ZIP starts with">
          <input type="text" inputMode="numeric" placeholder="112…" value={f.zip} onChange={(e) => patch({ zip: e.target.value })} />
        </Field>
      </Group>

      <Group
        title="Data quality"
        open={false}
        n={[f.onlyReview, f.onlyMissing, f.onlyCliff, f.onlyNearCutoff, f.onlyNoOccupancy].filter(Boolean).length + (f.minUnits != null ? 1 : 0)}
      >
        <Field label="Building has at least N flagged units">
          <input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 25"
            value={f.minUnits ?? ''}
            onChange={(e) => patch({ minUnits: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </Field>
        <div style={{ marginTop: 7 }}>
          <Toggle on={f.onlyReview} onChange={(v) => patch({ onlyReview: v })}>
            Needs review <span className="dim">(any data-quality flag)</span>
          </Toggle>
          <Toggle on={f.onlyMissing} onChange={(v) => patch({ onlyMissing: v })}>
            Missing fields <span className="dim">(value, class, type or position)</span>
          </Toggle>
          <Toggle on={f.onlyCliff} onChange={(v) => patch({ onlyCliff: v })}>
            On a rate cliff <span className="dim">(a small revaluation drops a whole band)</span>
          </Toggle>
          <Toggle on={f.onlyNearCutoff} onChange={(v) => patch({ onlyNearCutoff: v })}>
            {REVIEW_LABEL.near_cutoff}
          </Toggle>
          <Toggle on={f.onlyNoOccupancy} onChange={(v) => patch({ onlyNoOccupancy: v })}>
            {REVIEW_LABEL.no_occupancy_evidence}
          </Toggle>
        </div>
      </Group>

      <Group title="Bookmarks" open={false}>
        {BOOKMARKS.map((b) => (
          <button key={b.label} className="bookmark ghost" onClick={() => setFilters({ ...DEFAULT, ...b.filters })} title={b.note}>
            <b>{b.label}</b>
            <span>{b.note}</span>
          </button>
        ))}
      </Group>
      </>}

      <button className="mobile-only sheet-done primary" onClick={onClose}>
        Show {shown.toLocaleString()} propert{shown === 1 ? 'y' : 'ies'}
      </button>
    </aside>
  )
}
