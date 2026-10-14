import { useMemo, useState } from 'react'
import type { Dataset, Row } from '../../types'
import { money, moneyFull, pct, share, BOROUGH_COLOR, BOROUGH_ORDER } from '../../lib/data'
import { Modal, Stat } from '../../components/ui'
import Sankey, { type SankeyNode, type SankeyLink } from './Sankey'
import { macro, impliedExemptShare, ASSUMPTIONS } from './model'

const n = (v: number) => v.toLocaleString()

/**
 * The citywide view: how few properties this is, how much money it is, and the gap between the
 * gross figure and what the city says it expects to collect.
 *
 * Two diagrams rather than one, because the unit changes. A Sankey claims that width means the
 * same thing across the whole picture, so properties flowing into dollars in one diagram would be
 * a lie told in the most convincing possible form. Each carries its unit on its face.
 */
export default function Macro({ meta, rows, onClose }: { meta: Dataset['meta']; rows: Row[]; onClose: () => void }) {
  const base = useMemo(() => macro(rows, meta.universe ?? null, 0), [rows, meta.universe])
  const implied = useMemo(() => Math.round(impliedExemptShare(base.gross) * 100), [base.gross])
  const [exemptPct, setExemptPct] = useState(implied)
  const m = useMemo(() => macro(rows, meta.universe ?? null, exemptPct / 100), [rows, meta.universe, exemptPct])

  // Stacked in the canonical borough order, not by size: the CVD check that cleared these five
  // hues only tested ADJACENT pairs in this order, so re-sorting them would silently unvalidate it.
  const ordered = useMemo(
    () => BOROUGH_ORDER.map((b) => m.boroughs.find((x) => x.borough === b)).filter(Boolean) as typeof m.boroughs,
    [m.boroughs],
  )
  const mn = ordered.find((b) => b.borough === 'Manhattan')

  return (
    <Modal title="The whole roll, end to end" onClose={onClose} wide>
      <div className="explain" style={{ marginBottom: 12 }}>
        <strong>Two of these numbers are published and one is a model.</strong> The property counts and the
        gross surcharge are arithmetic on DOF's own files. What the city actually <em>collects</em> depends on
        who claims an exemption, which no public dataset records — so that part is a dial, set by default to
        the rate implied by the city's own revenue estimate. Every assumption is listed at the bottom.
      </div>

      <div className="stats" style={{ marginBottom: 14 }}>
        <Stat label="Class 1 + 2 properties citywide" value={m.universe ? n(m.universe) : '—'} title="Every row on the two DOF supplemental roll files, which are published as all class 1 and class 2 property" />
        <Stat label="On the surcharge roll" value={`${n(m.rows)}${m.share ? ` · ${(m.share * 100).toFixed(2)}%` : ''}`} />
        <Stat label="Charged, after the thresholds" value={n(m.charged)} title="Roll rows where the published rate table produces a surcharge above zero" />
        <Stat label="Surcharge if nobody is exempt" value={money(m.gross)} title="DOF's published rate on DOF's market value, every charged property, co-op buildings counted per apartment" />
        <Stat label="These properties pay now" value={money(m.currentCharged)} title="FY2027 taxable assessed value × FY2025 class rate, charged properties only" />
        <Stat label="Increase, gross" value={m.increaseGross ? pct(m.increaseGross) : '—'} />
      </div>

      <h3>Stage 1 — how much of the city this is</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {m.share ? <>The roll is <strong>{(m.share * 100).toFixed(2)}%</strong> of the city's class 1 and 2 property. </> : null}
        That share is wildly uneven: it is a Manhattan list with a Brooklyn tail, and it barely touches the
        other three boroughs. Each bar is one borough's own stock, with the flagged part drawn to scale.
      </p>
      <ShareBars rows={ordered} />

      <h3>Stage 2 — where the roll lands, in properties</h3>
      <Sankey
        unit="roll rows"
        format={n}
        height={300}
        nodes={[
          ...ordered.map((b): SankeyNode => ({ id: b.borough, label: b.borough, col: 0, color: BOROUGH_COLOR[b.borough] })),
          { id: 'charged', label: 'Charged', col: 1, color: 'var(--danger)' },
          { id: 'under', label: 'Under every threshold', col: 1, color: 'var(--fg-3)' },
        ]}
        links={ordered.flatMap((b): SankeyLink[] => [
          { from: b.borough, to: 'charged', value: b.charged, title: `${b.borough} → charged: ${n(b.charged)} rows` },
          { from: b.borough, to: 'under', value: b.rows - b.charged, title: `${b.borough} → under every threshold: ${n(b.rows - b.charged)} rows` },
        ])}
      />
      <p className="small muted">
        {n(m.underLine)} rows on the roll are charged nothing — almost all of them co-op buildings whose value
        per apartment falls under the $1M line. Being listed and being billed are not the same event, and this
        is the width of the difference.
      </p>

      <h3>Stage 3 — where the money lands, in dollars a year</h3>
      <div className="row wrap" style={{ gap: 10, alignItems: 'center', margin: '4px 0 10px' }}>
        <label className="small" htmlFor="exempt" style={{ fontWeight: 600 }}>Share exempted</label>
        <input
          id="exempt"
          type="range"
          min={0}
          max={95}
          step={1}
          value={exemptPct}
          onChange={(e) => setExemptPct(Number(e.target.value))}
          style={{ flex: '1 1 220px', maxWidth: 340 }}
        />
        <span className="mono" style={{ minWidth: 48 }}>{exemptPct}%</span>
        <button className="small" onClick={() => setExemptPct(implied)} disabled={exemptPct === implied}>
          Reset to the city's estimate ({implied}%)
        </button>
      </div>
      <Sankey
        unit="dollars of surcharge a year"
        format={money}
        height={320}
        padRight={190}
        nodes={[
          ...ordered.map((b): SankeyNode => ({ id: b.borough, label: b.borough, col: 0, color: BOROUGH_COLOR[b.borough] })),
          { id: 'gross', label: 'Gross surcharge', col: 1, color: 'var(--accent)', note: money(m.gross) },
          { id: 'exempt', label: 'Exempted away', col: 2, color: 'var(--fg-3)', note: money(m.exempt) },
          { id: 'collected', label: 'Collected', col: 2, color: 'var(--danger)', note: money(m.collected) },
        ]}
        links={[
          ...ordered.map((b): SankeyLink => ({
            from: b.borough, to: 'gross', value: b.surcharge,
            title: `${b.borough}: ${moneyFull(b.surcharge)} a year gross, ${n(b.charged)} charged rows`,
          })),
          { from: 'gross', to: 'exempt', value: m.exempt, title: `Exempted at ${exemptPct}%: ${moneyFull(m.exempt)}` },
          { from: 'gross', to: 'collected', value: m.collected, title: `Collected at ${100 - exemptPct}%: ${moneyFull(m.collected)}` },
        ]}
      />
      <p className="small muted">
        At the city's own implied rate, <strong>{money(m.collected)}</strong> of a <strong>{money(m.gross)}</strong>{' '}
        gross survives — the city's published estimate is about {money(m.expected)} a year. The gap is not an
        error in either number: it is the exemption, and it is the largest single quantity on this page.
        Manhattan carries {mn && m.gross ? share(mn.surcharge / m.gross) : '—'} of the gross on{' '}
        {mn && m.charged ? share(mn.charged / m.charged) : '—'} of the charged rows, because the rate rises
        with value and the value is there.
      </p>

      <h3>By borough</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        The same figures as a table, which is also where to read exact values rather than compare widths.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Borough</th>
              <th className="num">Class 1+2 properties</th>
              <th className="num">On the roll</th>
              <th className="num">Share of borough</th>
              <th className="num">Charged</th>
              <th className="num">Homes charged</th>
              <th className="num">Pays now</th>
              <th className="num">Surcharge, gross</th>
              <th className="num">Increase</th>
              <th className="num">Collected at {exemptPct}%</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => (
              <tr key={b.borough} style={{ cursor: 'default' }}>
                <td>
                  <i className="dotmark" style={{ '--c': BOROUGH_COLOR[b.borough] } as React.CSSProperties} />{' '}
                  {b.borough}
                </td>
                <td className="num">{b.universe != null ? n(b.universe) : '—'}</td>
                <td className="num">{n(b.rows)}</td>
                <td className="num">{b.universe ? `${((b.rows / b.universe) * 100).toFixed(2)}%` : '—'}</td>
                <td className="num">{n(b.charged)}</td>
                <td className="num">{n(b.chargedHomes)}</td>
                <td className="num">{money(b.currentCharged)}</td>
                <td className="num">{money(b.surcharge)}</td>
                <td className="num">{b.currentCharged ? pct(b.surcharge / b.currentCharged) : '—'}</td>
                <td className="num">{money(b.surcharge * (1 - exemptPct / 100))}</td>
              </tr>
            ))}
            <tr style={{ cursor: 'default', fontWeight: 700 }}>
              <td>Citywide</td>
              <td className="num">{m.universe ? n(m.universe) : '—'}</td>
              <td className="num">{n(m.rows)}</td>
              <td className="num">{m.share ? `${(m.share * 100).toFixed(2)}%` : '—'}</td>
              <td className="num">{n(m.charged)}</td>
              <td className="num">{n(m.chargedHomes)}</td>
              <td className="num">{money(m.currentCharged)}</td>
              <td className="num">{money(m.gross)}</td>
              <td className="num">{m.increaseGross ? pct(m.increaseGross) : '—'}</td>
              <td className="num">{money(m.collected)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        “Homes charged” is the row count expanded by DOF's apartment count, so a charged co-op building counts
        once as a row and once per apartment in the money. {n(m.charged)} charged rows are{' '}
        {n(m.chargedHomes)} homes.
      </p>

      <h3>What is assumed</h3>
      <table className="grid">
        <thead><tr><th>Assumption</th><th>Why it matters</th></tr></thead>
        <tbody>
          {ASSUMPTIONS.map((a) => (
            <tr key={a.id} style={{ cursor: 'default' }}>
              <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                {/* Amber marks the assumptions worth arguing with; a published figure is not an
                    alert, so it gets the neutral badge rather than the red one. */}
                {a.modelled ? <span className="badge inferred">modelled</span> : <span className="badge not_flagged">published</span>}{' '}
                {a.label}
              </td>
              <td className="muted small" style={{ whiteSpace: 'normal' }}>{a.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

/**
 * One bar per borough, each drawn against its OWN stock rather than a shared scale — the question
 * is "what fraction of this borough is on the roll", and a shared scale answers a different one
 * (where the rows are), which the Sankey already answers.
 */
function ShareBars({ rows }: { rows: { borough: string; rows: number; universe: number | null }[] }) {
  return (
    <div className="sharebars">
      {rows.map((b) => {
        const share = b.universe ? b.rows / b.universe : null
        return (
          <div key={b.borough} className="sharebar">
            <div className="sb-label small">{b.borough}</div>
            <div className="sb-track" title={b.universe ? `${n(b.rows)} of ${n(b.universe)} class 1+2 properties` : 'no denominator loaded'}>
              {/* A floor of 0.6% of the track, so Staten Island's 0.04% is a visible mark rather
                  than nothing. The number beside it is the truth; the bar is the gesture. */}
              <div
                className="sb-fill"
                style={{ width: share ? `${Math.max(share * 100, 0.6)}%` : 0, background: BOROUGH_COLOR[b.borough] }}
              />
            </div>
            <div className="sb-value small mono">{share ? `${(share * 100).toFixed(2)}%` : '—'}</div>
            <div className="sb-abs tiny dim">{n(b.rows)} of {b.universe ? n(b.universe) : '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
