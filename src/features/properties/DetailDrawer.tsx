import { useEffect, useMemo, useRef, useState } from 'react'
import type { Row } from '../../types'
import {
  moneyFull, money, pct, nearby, buildings, POLICY, explainFlags, explainTax,
  plainVerdict, buildingFacts, officialLinks, listingLinks, directListing, marketGap, coopBuilding, onCliff, deadlines,
  TYPE_LABEL, GEOCODE_LABEL, REVIEW_LABEL, REVIEW_NOTE,
} from '../../lib/data'
import { KV, StatusBadge, TypeBadge, Dot } from '../../components/ui'

const NOTES_KEY = 'nyc-pat-notes'

const downloadJson = (row: Row) =>
  import('../../lib/data').then((m) =>
    m.download(`property-${row.id.replace(/W+/g, '_')}.json`, JSON.stringify(row, null, 2), 'application/json'))

function useNote(id: string) {
  const [note, setNote] = useState('')
  useEffect(() => {
    const all = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')
    setNote(all[id] ?? '')
  }, [id])
  const save = (v: string) => {
    setNote(v)
    const all = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')
    if (v) all[id] = v
    else delete all[id]
    localStorage.setItem(NOTES_KEY, JSON.stringify(all))
  }
  return [note, save] as const
}

/** A disclosure for anything that is about the policy rather than about this property. */
function More({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="more">
      <summary>{summary}</summary>
      <div className="more-body">{children}</div>
    </details>
  )
}

/**
 * The answer, in as few numbers as possible. Everything here is specific to this property —
 * no explanation of how the surcharge works in general; that lives behind the disclosures.
 */
function Headline({ row }: { row: Row }) {
  const t = row.tax
  const v = plainVerdict(row)
  const coop = coopBuilding(row)
  const facts = buildingFacts(row)
  const max = (t.current ?? 0) + (t.surcharge ?? 0)
  const bar = (n: number) => `${max > 0 ? Math.max(2, (n / max) * 100) : 0}%`

  return (
    <>
      <div className={`verdict ${v.status}`}>
        <div className="hd">{v.headline}</div>
        {facts && <div className="facts">{facts}</div>}
      </div>

      {t.surcharge != null && t.rate != null ? (
        <div className="figure">
          <div className="big mono">{moneyFull(t.surcharge)}<span className="per">/ year</span></div>
          {coop?.perApartmentSurcharge != null && (
            <div className="sub mono">
              {moneyFull(coop.perApartmentSurcharge)}<span className="per">per apartment · {coop.apartments} in the building</span>
            </div>
          )}
          <div className="how">
            {(t.rate * 100).toFixed(2)}% of {moneyFull(row.flags.value_used)} DOF market value
            {coop ? ' for the whole building' : ''}
          </div>
        </div>
      ) : (
        <div className="figure"><div className="how">{v.why}</div></div>
      )}

      {t.current != null && t.surcharge != null && (
        <div className="taxbars" style={{ marginTop: 10 }}>
          <div className="taxbar">
            <span className="l">Tax now</span>
            <span className="track"><i style={{ width: bar(t.current), background: 'var(--fg-3)' }} /></span>
            <span className="v mono">{money(t.current)}</span>
          </div>
          <div className="taxbar">
            <span className="l">Surcharge</span>
            <span className="track"><i style={{ width: bar(t.surcharge), background: 'var(--danger)' }} /></span>
            <span className="v mono" style={{ color: 'var(--danger)' }}>{money(t.surcharge)}</span>
          </div>
          <div className="taxbar">
            <span className="l"><strong>Total</strong></span>
            <span className="track"><i style={{ width: '100%', background: 'var(--warn)' }} /></span>
            <span className="v mono">
              <strong>{money(t.total)}</strong>
              {t.increase_pct != null && <span style={{ color: 'var(--warn)' }}> {pct(t.increase_pct)}</span>}
            </span>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The rate is a flat percentage of the FULL value, so the band edge just below a property is worth
 * real money. Strictly arithmetic on DOF's published table — it says nothing about whether a
 * reduction is achievable, which is the Tax Commission's call.
 */
function Cliff({ row }: { row: Row }) {
  const t = row.tax
  if (!onCliff(t, row.flags.value_used) || t.appeal_drop == null || !t.appeal_saving) return null
  const v = row.flags.value_used as number
  const pctOff = (t.appeal_drop / v) * 100
  const gone = t.floor_edge === row.flags.threshold

  return (
    <div className="cliff">
      <div className="hd">On a rate cliff</div>
      <p>
        DOF values this at <strong>{moneyFull(v)}</strong>, just {moneyFull(t.appeal_drop)} over the{' '}
        {moneyFull(t.floor_edge)} line ({pctOff < 0.1 ? pctOff.toFixed(3) : pctOff.toFixed(1)}% of the value).
        A reduction below that line would {gone ? 'remove the surcharge entirely' : 'drop it a whole rate band'}:{' '}
        <strong>{moneyFull(t.appeal_saving)} a year</strong>.
      </p>
      <p className="dim">
        That is arithmetic on the published rate table, not a view on whether DOF’s value is wrong or a reduction is
        achievable. The Tax Commission decides that.
      </p>
    </div>
  )
}

/**
 * What the market says, beside what DOF says. The gap is real and large for condos and co-ops —
 * median 2.8x and 2.9x across this roll — but it is a methodology difference, not evidence that
 * the city is undervaluing anything. State law makes DOF value them from comparable rental
 * income. Saying that plainly is the whole reason this block exists rather than a bare number.
 */
function Market({ row }: { row: Row }) {
  const m = marketGap(row)
  if (!m) {
    return (
      <More summary="What might it actually sell for?">
        <p>
          No recorded sale for this {row.type === 'home_1_3' ? 'property' : 'building'} since 2019 in DOF’s sales
          file, which says nothing about its value either way.
        </p>
        <MarketLinks row={row} />
      </More>
    )
  }
  const when = new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="market">
      <div className="hd">
        {m.scope === 'lot' ? 'Last recorded sale' : 'Last recorded sale in this building'}
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span className="big mono">{moneyFull(m.sale)}</span>
        <span className="dim small">
          {when}{m.unit ? ` · apt ${m.unit}` : ''}
          {m.others > 0 ? ` · ${m.others} other sale${m.others === 1 ? '' : 's'} since 2019` : ''}
        </span>
      </div>
      {m.multiUnitLot ? (
        <p>
          Not comparable to DOF’s {moneyFull(m.dof)}: this is a single condominium lot covering{' '}
          {row.public?.units_res} homes, so that value is for the whole block while the sale above is one
          apartment. The surcharge is charged on the lot.
        </p>
      ) : m.ratio != null && (
        <p>
          That is <strong>{m.ratio < 0.1 ? m.ratio.toFixed(2) : m.ratio.toFixed(1)}×</strong> DOF’s {moneyFull(m.dof)}
          {row.type === 'coop' ? ' per-apartment value' : ' market value'}, the figure the surcharge is charged on.
        </p>
      )}
      {m.multiUnitLot ? null : m.statutory ? (
        <p className="dim">
          Expected, and not a sign the city is undervaluing it: state law requires DOF to value condos and co-ops
          from comparable <em>rental</em> income rather than sale prices, which puts typical sales at a large
          multiple of DOF’s figure across the whole roll. The surcharge is charged on DOF’s figure regardless.
        </p>
      ) : (
        <p className="dim">
          For 1–3 family homes DOF values to sale value, so these two are comparable. A sale well under DOF’s figure
          is the kind of thing a Tax Commission appeal is for.
        </p>
      )}
      <MarketLinks row={row} />
    </div>
  )
}

/**
 * DOF's own parcel page first — it shows the assessment history and the comparables behind the
 * value, which is the only place to see how the figure was actually reached. Then the listing
 * sites for the market side.
 */
function MarketLinks({ row }: { row: Row }) {
  const parcel = officialLinks(row).find((l) => l.label === 'City parcel record')
  const links = [
    ...(parcel ? [{ ...parcel, label: 'City parcel record (DOF)', note: 'assessment history and how DOF reached this value' }] : []),
    ...listingLinks(row),
  ]
  if (!links.length) return null
  const direct = directListing(row)
  return (
    <>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {links.map((l) => (
          <a key={l.label} className="small" href={l.url} target="_blank" rel="noreferrer" title={l.note}>
            {l.label} ↗
          </a>
        ))}
      </div>
      <p className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
        {direct
          ? <>The StreetEasy link is {direct.note}, from StreetEasy's own address index rather than a search. Zillow is still a search.{' '}</>
          : <>The listing sites are address searches, not exact matches.{' '}</>}
        What they show may be a <em>rental</em>, and an asking rent is not a sale price. That is worth noticing
        rather than ignoring: if a tenant lives there as their primary residence, that is one of the{' '}
        {POLICY.exemptions.length} exemption routes.
      </p>
    </>
  )
}

/**
 * One line of urgency — and only where there is a charge to be urgent about. Gated on a computed
 * surcharge, NOT on `flags.affected`, which is `listed || overAny` and so is true for the many
 * co-op buildings that sit on the roll below the per-apartment line. Showing them a countdown
 * told people who owe nothing that a clock was running.
 */
function Deadline({ row }: { row: Row }) {
  if (!row.tax.surcharge) return null
  const d = deadlines(row)
  const when = (iso: string, year = false) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })

  // While the exemption window is open it is the only thing worth shouting about. Once it shuts,
  // the Tax Commission window is still open for months and becomes the live route.
  if (d.phase === 'exemption') {
    return (
      <div className={d.exemption.days <= 30 ? 'deadline urgent' : 'deadline'}>
        <strong>{d.exemption.days} day{d.exemption.days === 1 ? '' : 's'}</strong> to apply for an exemption,{' '}
        {d.exemption.label.toLowerCase()} close {when(d.exemption.date)}
      </div>
    )
  }
  if (d.phase === 'appeal') {
    return (
      <div className={d.appeal.days <= 30 ? 'deadline urgent' : 'deadline'}>
        The exemption deadline ({when(d.exemption.date, true)}) has passed.{' '}
        <strong>{d.appeal.days} day{d.appeal.days === 1 ? '' : 's'}</strong> left to challenge the value or the
        residency finding at the Tax Commission. {d.appeal.label} close {when(d.appeal.date, true)}.
      </div>
    )
  }
  return (
    <div className="deadline">
      Both windows for these tax years have closed: the exemption deadline ({when(d.exemption.date, true)}) and the
      Tax Commission deadline ({when(d.appeal.date, true)}).
    </div>
  )
}

/**
 * The appeal route, with this property's own numbers in it. Two grounds are separable — value and
 * residency — and the Tax Commission hears both, which most coverage of this tax misses entirely.
 * Shown for anything charged, and leading with the cliff saving where there is one, because that is
 * the figure that tells an owner whether the filing is worth their afternoon.
 */
function Appeal({ row }: { row: Row }) {
  const t = row.tax
  if (!t.surcharge) return null
  const d = deadlines(row)
  const a = POLICY.appeals
  const cliff = onCliff(t, row.flags.value_used) && t.appeal_saving
  const when = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <More summary={cliff ? `Challenge the value, worth ${moneyFull(t.appeal_saving)} a year here` : 'Challenge the value or the residency finding'}>
      {cliff ? (
        <p>
          DOF values this at <strong>{moneyFull(row.flags.value_used)}</strong>. Getting it below{' '}
          {moneyFull(t.floor_edge)} would cut the surcharge by <strong>{moneyFull(t.appeal_saving)} a year</strong>.
          Whether that reduction is achievable is the Tax Commission’s call. This is only the arithmetic on
          DOF’s published table.
        </p>
      ) : (
        <p>
          The surcharge is a flat percentage of the full DOF market value, so the value decides both whether the
          threshold is met and which rate band applies.
        </p>
      )}
      <ul>
        {a.grounds.map((g) => <li key={g.id}><strong>{g.label}.</strong> {g.note}</li>)}
      </ul>
      <p>
        <strong>Deadline for this property: {when(d.appeal.date)}</strong> ({d.appeal.label}).{' '}
        {d.appeal.open ? `${d.appeal.days} days from today.` : 'That date has passed.'}
      </p>
      <p className="dim">{a.dof_first_note}</p>
      <p className="dim">{a.independent_note}</p>
      <div className="stack" style={{ gap: 5, marginTop: 8 }}>
        <a className="official" href={a.citation} target="_blank" rel="noreferrer">
          <b>Tax Commission surcharge appeal ↗</b><span>forms, instructions and definitions</span>
        </a>
      </div>
      <p className="dim" style={{ marginTop: 8 }}>Questions: {a.contact}. {a.contact_note}</p>
    </More>
  )
}

function Calculation({ row }: { row: Row }) {
  const t = useMemo(() => explainTax(row, row.flags), [row])
  const m = POLICY.tax_model
  return (
    <More summary="How this figure is calculated">
      <p><strong>Surcharge.</strong> {t.surcharge_formula}</p>
      <p><strong>Tax now.</strong> {t.current_formula}</p>
      {t.caveats.length > 0 && (
        <ul>{t.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      )}
      <p className="dim">
        The “tax now” figure is an order of magnitude, not a bill. It leaves out{' '}
        {m.existing.unmodelled.length} adjustments including {m.existing.unmodelled[0].split(',')[0].toLowerCase()}.
      </p>
    </More>
  )
}

/**
 * Never a disclosure. By this project's own methodology roughly five of every six dollars on the
 * roll are expected to be exempted, so for most visitors this block is the answer, not the appendix.
 */
function Exemptions({ row }: { row: Row }) {
  // Same gate as Deadline: there is nothing to remove from a property with no surcharge.
  if (!row.tax.surcharge) return null
  return (
    <div className="exempt-block">
      <h3>How to remove it: {POLICY.exemptions.length} ways to qualify</h3>
      <div className="stack" style={{ gap: 5, marginBottom: 9 }}>
        <a className="official" href="https://www.nyc.gov/site/finance/property/non-primary-residence-surcharge.page" target="_blank" rel="noreferrer">
          <b>Apply for an exemption at DOF ↗</b><span>the official page, forms and affidavits</span>
        </a>
        <a className="official" href="https://www.nyc.gov/site/finance/property/property-surcharge-eligiblity-tool.page" target="_blank" rel="noreferrer">
          <b>DOF eligibility guide ↗</b><span>check whether you may be exempt before you file</span>
        </a>
        <a className="official" href="https://www.nyc.gov/site/taxcommission/forms/surcharge-appeal.page" target="_blank" rel="noreferrer">
          <b>Challenge the value ↗</b><span>NYC Tax Commission surcharge appeal</span>
        </a>
      </div>
      <p className="small muted" style={{ margin: '0 0 6px', lineHeight: 1.55 }}>{POLICY.residency_rule.note}</p>
      <ul>
        {POLICY.exemptions.map((e) => <li key={e.id}><strong>{e.label}.</strong> {e.note}</li>)}
      </ul>
      <p className="small dim" style={{ margin: 0, lineHeight: 1.5 }}>{POLICY.exemption_documents_note}</p>
    </div>
  )
}

function OfficialLinks({ row }: { row: Row }) {
  const links = officialLinks(row)
  return (
    <More summary="Look this property up in the city’s records">
      <div className="stack" style={{ gap: 3 }}>
        {links.map((l) => (
          <a key={l.label} className="bookmark ghost" href={l.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <b>{l.label} ↗</b>
            {l.note && <span>{l.note}</span>}
          </a>
        ))}
      </div>
    </More>
  )
}

interface Props {
  row: Row
  all: Row[]
  onClose: () => void
  onSelect: (id: string) => void
  onCompare: (id: string) => void
  inCompare: boolean
  expert: boolean
  toast: (m: string) => void
  isFav: boolean
  onToggleFav: (id: string) => void
}

export default function DetailDrawer({ row, all, onClose, onSelect, onCompare, inCompare, expert, toast, isFav, onToggleFav }: Props) {
  const [note, setNote] = useNote(row.id)
  const f = row.flags
  const ref = useRef<HTMLElement>(null)

  // Opening the drawer moves focus into it; closing puts it back where it came from.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => from?.focus?.()
  }, [])

  const near = useMemo(() => nearby(all, row), [all, row])
  const full = useMemo(() => explainFlags(row), [row])
  const bldg = useMemo(() => buildings(all.filter((r) => r.building_key === row.building_key))[0], [all, row])

  const copy = (t: string, what: string) => {
    navigator.clipboard.writeText(t).then(() => toast(`${what} copied`))
  }

  const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [row.address, row.borough, 'NY', row.zip].filter(Boolean).join(', '),
  )}`

  return (
    <aside className="drawer" aria-label="Property detail" tabIndex={-1} ref={ref}>
      <div className="drawer-head">
        <div className="row">
          <div className="grow">
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {row.address}
              {row.unit ? <span className="muted"> · {row.unit}</span> : null}
            </div>
            <div className="muted small">
              {row.borough ?? 'Borough unknown'}
              {row.zip ? ` ${row.zip}` : ''}
              {row.neighborhood ? ` · ${row.neighborhood}` : ''}
            </div>
          </div>
          <button
            className={isFav ? 'star on' : 'star'}
            style={{ fontSize: 22 }}
            aria-pressed={isFav}
            title={isFav ? 'Remove from saved' : 'Save this property'}
            aria-label={isFav ? 'Remove from saved' : 'Save this property'}
            onClick={() => onToggleFav(row.id)}
          >
            {isFav ? '★' : '☆'}
          </button>
          <button onClick={onClose} aria-label="Close detail">✕</button>
        </div>
        <div className="row wrap" style={{ marginTop: 7 }}>
          <StatusBadge status={f.status} />
          <TypeBadge type={row.type} />
          {f.near_cutoff && <span className="badge review">Near a rate band edge</span>}
        </div>
      </div>

      <div className="drawer-body">
        <Headline row={row} />
        <Cliff row={row} />
        <Market row={row} />
        <Deadline row={row} />

        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="small" onClick={() => window.print()} title="One page you can hand to an accountant or attach to an application">Save a one-page summary</button>
          <button className="small" onClick={() => copy([row.address, row.unit, row.borough, 'NY', row.zip].filter(Boolean).join(', '), 'Address')}>Copy address</button>
          <button className="small" onClick={() => copy(location.href, 'Link')}>Copy link</button>
          {expert && <button className="small" onClick={() => onCompare(row.id)} aria-pressed={inCompare}>{inCompare ? 'In compare' : 'Compare'}</button>}
          <a className="small" href={gmaps} target="_blank" rel="noreferrer">Map ↗</a>
        </div>

        <Exemptions row={row} />
        <Appeal row={row} />
        <Calculation row={row} />
        <OfficialLinks row={row} />

        {/* Everything below is the working. Expert mode shows it; Simple mode folds it away. */}
        <Technical expert={expert}>
        <section className="section">
          <h3>Identity</h3>
          <dl className="kv">
            <KV k="Address" v={row.address} />
            <KV k="Unit" v={row.unit} />
            <KV k="Borough" v={row.borough} />
            <KV k="ZIP" v={row.zip} />
            <KV k="BBL" v={row.bbl ? <span className="mono">{row.bbl}</span> : null} title="Borough–Block–Lot" />
            <KV k="Block / Lot" v={row.block ? `${row.block} / ${row.lot ?? '—'}` : null} />
            <KV k="BIN" v={row.bin ? <span className="mono">{row.bin}</span> : null} title="Building Identification Number" />
            <KV k="Building class" v={row.building_class} />
            <KV k="Tax class" v={row.tax_class} />
            <KV k="Classified as" v={`${TYPE_LABEL[row.type]}`} />
            <KV k="Units in building" v={row.units_in_building} />
          </dl>
        </section>

        <section className="section">
          <h3>Valuation</h3>
          <dl className="kv">
            <KV k="Used by engine" v={<><strong>{moneyFull(f.value_used)}</strong> <span className="dim">via {f.value_field ?? '—'}</span></>} />
            <KV k="Market value" v={moneyFull(row.market_value)} />
            <KV k="Assessed value" v={moneyFull(row.assessed_value)} />
            <KV k="Sale price" v={moneyFull(row.sale_price)} />
            <KV k="Threshold applied" v={f.threshold != null ? `${moneyFull(f.threshold)}, ${f.rule_label}` : 'none matched'} />
          </dl>
          <div className="small dim" style={{ marginTop: 5 }}>
            Field priority comes from <code>policy.json</code>: {POLICY.value_field_priority.join(' → ')}. {POLICY.value_field_note}
          </div>
        </section>

        <section className="section">
          <h3>Why this record is flagged</h3>
          <div className="explain">{full.explain}</div>
        </section>

        <section className="section">
          <h3>Rule checks</h3>
          {full.checks.map((c) => (
            <div className="checkitem" key={c.id}>
              <div className="hd">
                <strong>{c.label}</strong>
                <span className={`verdict ${c.passed === true ? 'pass' : c.passed === false ? 'fail' : 'na'}`}>
                  {c.passed === true ? 'MET' : c.passed === false ? 'NOT MET' : 'CANNOT TEST'}
                </span>
              </div>
              <div className="why">{c.detail}</div>
              {c.inputs.length > 0 && (
                <div className="inputs tiny">
                  fed by {c.inputs.map((i) => <code key={i}>{i}</code>)}
                </div>
              )}
            </div>
          ))}
        </section>

        {f.review.length > 0 && (
          <section className="section">
            <h3>Needs review</h3>
            {f.review.map((r) => (
              <div key={r} className="small" style={{ marginBottom: 4 }}>
                <span className="badge review">{REVIEW_LABEL[r] ?? r}</span>{' '}
                <span className="muted">{REVIEW_NOTE[r] ?? ''}</span>
              </div>
            ))}
          </section>
        )}

        <section className="section">
          <h3>Exemption &amp; contestability</h3>
          <div className="small muted">{POLICY.residency_rule.note}</div>
          <dl className="kv" style={{ marginTop: 6 }}>
            <KV k="Occupancy signal" v={f.occupancy.replace(/_/g, ' ')} />
            <KV k="Owner-occupied" v={row.owner_occupied == null ? 'unknown' : String(row.owner_occupied)} />
            <KV k="STAR exemption" v={row.star_exemption == null ? 'unknown' : String(row.star_exemption)} />
            <KV k="Owner mailing state" v={row.owner_mailing_state} />
            <KV k="Owner" v={row.owner_name} />
          </dl>
          <div className="small dim" style={{ marginTop: 5 }}>{POLICY.exemptions[0].note}</div>
        </section>

        <section className="section">
          <h3>Position</h3>
          <dl className="kv">
            <KV k="Coordinates" v={row.lat != null ? <span className="mono">{row.lat.toFixed(5)}, {row.lon?.toFixed(5)}</span> : null} />
            <KV k="Source" v={GEOCODE_LABEL[row.geocode_source ?? ''] ?? 'none'} />
          </dl>
        </section>

        <section className="section">
          <h3>Building: {bldg?.units ?? 0} record{bldg?.units === 1 ? '' : 's'}</h3>
          {bldg && (
            <dl className="kv">
              <KV k="On city list" v={bldg.listed} />
              <KV k="Inferred" v={bldg.inferred} />
              <KV k="Total valuation" v={money(bldg.total_value)} />
              <KV k="Average valuation" v={money(bldg.avg_value)} />
              <KV k="Dominant type" v={TYPE_LABEL[bldg.dominant_type]} />
            </dl>
          )}
          {near.length > 0 && (
            <>
              <div className="tiny" style={{ margin: '9px 0 4px' }}>Other records in this building</div>
              <div style={{ maxHeight: 168, overflow: 'auto' }}>
                {near.slice(0, 60).map((r) => (
                  <button key={r.id} className="ghost bookmark" onClick={() => onSelect(r.id)}>
                    <b><Dot type={r.type} />{r.unit ?? r.address}</b>
                    <span>{money(r.flags.value_used)} · {r.flags.status}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="section">
          <h3>Provenance <button className="small ghost" onClick={() => downloadJson(row)}>Export JSON</button></h3>
          <dl className="kv">
            <KV k="Source rows" v={(row.sources ?? []).map((s) => <div key={`${s.file}:${s.row}`} className="mono small">{s.file}:{s.row}</div>)} />
            <KV k="Imported" v={<span className="mono small">{row.imported_at}</span>} />
          </dl>
          {(row.notes?.length ?? 0) > 0 && (
            <>
              <div className="tiny" style={{ margin: '8px 0 3px' }}>Transformation notes</div>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {(row.notes ?? []).map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </>
          )}
          <div className="tiny" style={{ margin: '9px 0 3px' }}>Source datasets</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {POLICY.provenance.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>
            ))}
          </ul>
        </section>

        <section className="section">
          <h3>Your notes <span className="dim small">(local only)</span></h3>
          <textarea
            style={{ width: '100%', minHeight: 66, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, padding: 6 }}
            value={note}
            placeholder="Annotations stay in this browser."
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        </Technical>
      </div>
    </aside>
  )
}

/** In Expert mode this is a pass-through; in Simple mode it is one disclosure. */
function Technical({ expert, children }: { expert: boolean; children: React.ReactNode }) {
  if (expert) return <>{children}</>
  return (
    <details className="technical">
      <summary>Show the full record: every rule check, source column and raw field</summary>
      {children}
    </details>
  )
}
