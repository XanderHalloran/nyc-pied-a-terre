import { useMemo } from 'react'
import type { Dataset, Row } from '../../types'
import { POLICY, moneyFull, money, pct, taxTotals, homesOnRow, saleRatios, TYPE_LABEL } from '../../lib/data'
import { Modal, Stat } from '../../components/ui'
import Faq from './Faq'

/** The tax model's assumptions, stated plainly, next to what they add up to. */
function TaxModel({ rows }: { rows: Row[] }) {
  const m = POLICY.tax_model
  const t = useMemo(() => taxTotals(rows), [rows])
  const byType = useMemo(
    () =>
      (['condo', 'coop', 'home_1_3'] as const).map((k) => {
        // Same per-apartment scaling as taxTotals, so this table and the stat cards agree.
        const hit = rows.filter((r) => r.type === k && (r.tax.surcharge ?? 0) > 0)
        const cur = hit.reduce((a, r) => a + (r.tax.current ?? 0) * homesOnRow(r), 0)
        const sur = hit.reduce((a, r) => a + (r.tax.surcharge ?? 0) * homesOnRow(r), 0)
        const med = hit.map((r) => r.tax.increase_pct ?? 0).sort((a, b) => a - b)[Math.floor(hit.length / 2)] ?? null
        return { k, n: hit.length, cur, sur, med }
      }),
    [rows],
  )

  return (
    <>
      <h3>Tax impact: how much, in proportion to what is already paid</h3>
      <div className="explain" style={{ marginBottom: 10 }}>
        <strong>{m.status}.</strong> {m.headline_note}
      </div>
      <div className="stats" style={{ marginBottom: 10 }}>
        <Stat label="Pays now, all records" value={money(t.current)} title="DOF taxable assessed value × class rate, summed across every loaded record, with co-op buildings counted per apartment" />
        <Stat label="Pays now, charged only" value={money(t.currentCharged)} title="The same figure for just the records that actually owe a surcharge" />
        <Stat label="Surcharge" value={money(t.surcharge)} title="DOF's published rate applied to DOF's market value, across all charged records" />
        <Stat
          label="Increase where charged"
          value={t.pct != null ? pct(t.pct) : '—'}
          title="Surcharge over what those same properties already pay. Measured against every record instead, including the thousands under the threshold, it dilutes to roughly a third of this."
        />
        <Stat label="Records charged" value={t.charged.toLocaleString()} />
        <Stat label="On a rate cliff" value={t.cliffN.toLocaleString()} title="Within 10% above a rate band edge, where a small revaluation would change the whole bill" />
        <Stat label="At stake on cliffs" value={money(t.cliffAtStake)} title="Annual surcharge that would fall away if each of those properties dropped below its edge" />
        <Stat label="Flagged, unmodellable" value={t.unmodellable.toLocaleString()} title="Flagged but with no threshold or valuation to measure a surcharge against" />
      </div>
      <table className="grid" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>Type</th><th className="num">Charged</th><th className="num">Pays now</th><th className="num">Est. surcharge</th><th className="num">Median increase</th></tr>
        </thead>
        <tbody>
          {byType.map((r) => (
            <tr key={r.k} style={{ cursor: 'default' }}>
              <td>{TYPE_LABEL[r.k]}</td>
              <td className="num">{r.n.toLocaleString()}</td>
              <td className="num">{money(r.cur)}</td>
              <td className="num">{money(r.sur)}</td>
              <td className="num">{r.med ? pct(r.med) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="small muted">
        These totals assume <strong>nobody is exempt</strong>, because public data cannot show who lives where. The city's own
        revenue estimate for the surcharge is around {money(m.expected_revenue)} a year. The gap between that and the figure
        above is the share DOF expects to be exempted. On these numbers, roughly{' '}
        {Math.max(1, Math.round(t.surcharge / m.expected_revenue) - 1)} out of every{' '}
        {Math.max(2, Math.round(t.surcharge / m.expected_revenue))} dollars on the roll.
      </p>
      <p className="small muted">
        Co-op rows are whole buildings. DOF's threshold and rate band apply per unit, so a co-op is tested on its building
        value divided by its apartment count. That is why large moderate-income co-ops, such as Co-op City at about $56,000 per apartment and Roosevelt Island at about $164,000, fall below the $1M line entirely despite nine-figure parcel values.
      </p>

      <p className="small muted">
        Because the rate applies to the full value rather than the amount above a line, every band edge is a cliff.
        {' '}{t.cliffN.toLocaleString()} properties sit within 10% above one, with {money(t.cliffAtStake)} a year between
        them riding on a revaluation. The smallest of them is over its line by a few hundred dollars.
      </p>

      <MarketVsDof rows={rows} />

      <h3>The published rate table</h3>
      <table className="grid" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>Property type</th><th>DOF market value</th><th className="num">Rate on the FULL value</th></tr>
        </thead>
        <tbody>
          {m.surcharge.bands.map((b) => (
            <tr key={b.label} style={{ cursor: 'default' }}>
              <td>{b.applies_to.map((t) => TYPE_LABEL[t]).join(' / ')}</td>
              <td className="muted">
                {moneyFull(b.min)}{b.max ? ` – under ${moneyFull(b.max)}` : ' and over'}
              </td>
              <td className="num"><strong>{(b.rate * 100).toFixed(2)}%</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">{m.surcharge.structure_note}</p>
      <p className="small">
        <strong>Existing bill.</strong> {m.existing.note} Rates used ({m.existing.fiscal_year}):{' '}
        {Object.entries(m.existing.class_tax_rates).map(([c, r]) => `class ${c} ${(r * 100).toFixed(3)}%`).join(', ')}.
        Assessment ratios: {Object.entries(m.existing.assessment_ratio).map(([c, r]) => `class ${c} ${(r * 100).toFixed(0)}%`).join(', ')}.{' '}
        {m.existing.rate_note}
      </p>
      <p className="small muted">{m.existing.assessment_ratio_note}</p>
      <h3>How to get out of it</h3>
      <p className="small">{POLICY.residency_rule.note}</p>
      <table className="grid" style={{ marginBottom: 8 }}>
        <thead><tr><th>Exemption route</th><th>What DOF asks for</th></tr></thead>
        <tbody>
          {POLICY.exemptions.map((e) => (
            <tr key={e.id} style={{ cursor: 'default' }}>
              <td>{e.label}</td>
              <td className="muted small" style={{ whiteSpace: 'normal' }}>{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">{POLICY.exemption_documents_note}</p>
      <p className="small muted">{POLICY.appeal_note}</p>

      <h3>Not modelled in the “tax now” figure</h3>
      <ul className="small">
        {m.existing.unmodelled.map((u) => <li key={u}>{u}</li>)}
        <li>{m.surcharge.exempt_note}</li>
      </ul>
    </>
  )
}

/**
 * What DOF's value is against what the property actually changed hands for. The point is NOT that
 * the city is undervaluing anything — it is that for condos and co-ops the two numbers are not
 * measuring the same thing, and the multiple is big enough that an owner will notice and draw the
 * wrong conclusion unless it is stated.
 */
function MarketVsDof({ rows }: { rows: Row[] }) {
  // saleRatios excludes multi-unit lots, whose ratio compares one apartment to a whole block and
  // would drag every median down. Shared with the drawer so the two can never disagree.
  const ratios = useMemo(() => saleRatios(rows), [rows])
  const by = (['condo', 'coop', 'home_1_3'] as const)
    .filter((k) => ratios[k])
    .map((k) => ({ k, ...ratios[k] }))

  if (!by.length) return null

  return (
    <>
      <h3>DOF’s value against what these properties actually sold for</h3>
      <table className="grid" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>Type</th><th className="num">With a recorded sale</th><th className="num">25th pct</th><th className="num">Median</th><th className="num">75th pct</th></tr>
        </thead>
        <tbody>
          {by.map((r) => (
            <tr key={r.k} style={{ cursor: 'default' }}>
              <td>{TYPE_LABEL[r.k]}</td>
              <td className="num">{r.n.toLocaleString()}</td>
              <td className="num">{r.p25.toFixed(2)}×</td>
              <td className="num"><strong>{r.med.toFixed(2)}×</strong></td>
              <td className="num">{r.p75.toFixed(2)}×</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        Sale price divided by the DOF market value the surcharge is charged on, for every record with a recorded
        sale since 2019. <strong>This is not evidence that the city is undervaluing anything.</strong> State law
        requires DOF to value condominiums and co-operatives from comparable <em>rental</em> income rather than
        sale prices, which is exactly why those multiples sit near 3×. 1–3 family homes are valued toward sale
        value, and their median lands near 1×, the sanity check that the other two are a methodology difference
        rather than a data error.
      </p>
      <p className="small muted">
        Matching is by tax lot where the sale is of the whole property, and by building otherwise: DOF files an
        apartment sale against the building’s base lot, not the condo unit lot the roll uses. A building match is
        the most recent sale of <em>any</em> apartment there, which is why it is labelled that way per property.
        Sales under $100,000 are excluded as nominal transfers, and a deed covering several lots repeats its full
        price on each one.
      </p>
    </>
  )
}

/**
 * The "law vs. data" panel. Everything here is derived from the loaded dataset — nothing is
 * asserted about the real world that the data does not support.
 */
export default function Methodology({ meta, rows, onClose }: { meta: Dataset['meta']; rows: Row[]; onClose: () => void }) {
  const cmp = useMemo(() => {
    const listed = rows.filter((r) => r.flags.status === 'listed')
    const inferred = rows.filter((r) => r.flags.status === 'inferred')
    return {
      listed: listed.length,
      inferred: inferred.length,
      listedBelow: listed.filter((r) => r.flags.review.includes('listed_but_below')).length,
      listedNoValue: listed.filter((r) => r.flags.value_used == null).length,
      noOccupancy: rows.filter((r) => r.flags.affected && r.flags.occupancy === 'unknown').length,
      nearCutoff: rows.filter((r) => r.flags.near_cutoff).length,
      byRule: POLICY.thresholds.map((t) => {
        const inRule = rows.filter((r) => r.flags.rule_id === t.id)
        return {
          ...t,
          total: inRule.length,
          listed: inRule.filter((r) => r.flags.status === 'listed').length,
          inferred: inRule.filter((r) => r.flags.status === 'inferred').length,
        }
      }),
      byType: (['condo', 'coop', 'home_1_3', 'unknown'] as const).map((t) => ({
        type: t,
        total: rows.filter((r) => r.type === t).length,
        affected: rows.filter((r) => r.type === t && r.flags.affected).length,
      })),
    }
  }, [rows])

  const affected = cmp.listed + cmp.inferred
  const reported = POLICY.provenance.reported_total_flagged

  return (
    <Modal title="Methodology, sources and limits" onClose={onClose} wide>
      <div className="explain" style={{ marginBottom: 12 }}>
        <strong>{POLICY.disclaimer}</strong>
      </div>

      {/* Plain language first. The technical document below is what a journalist needs to cite;
          this is what a homeowner needs to read, and they arrive at the same page. */}
      <h3 id="what-this-is">What this is, in plain words</h3>
      <div className="prose">
        <p>
          New York City has added a surcharge on homes that are <strong>not</strong> someone’s main residence. The
          Department of Finance published a roll of properties that may be subject to it, {rows.length.toLocaleString()}{' '} of them, and this site is that roll, mapped and searchable, with the city’s published rate table applied to
          each one.
        </p>
        <p>
          <strong>Being on the roll is not a bill.</strong> It is a list of properties whose ownership pattern or value
          made DOF look. If the home is a main residence, or one of the {POLICY.exemptions.length} exemption routes
          applies, the surcharge is not owed, but the owner has to say so, by{' '}
          {POLICY.deadlines.map((d) => `${new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} (${d.label.toLowerCase()})`).join(' or ')}.
        </p>
        <p>
          Every figure here is computed, not asserted: the rules live in one file, and the detail panel for any property
          shows the exact test that produced its result. Where a fact is missing, above all primary residence, which no public dataset records, it is reported as unknown and never guessed.
        </p>
      </div>

      {/* Straight after the plain-words opener and before any table: the questions people arrive
          with are not the questions the methodology answers, and they get first claim on the page. */}
      <Faq rows={rows} />

      <h3>What the reported policy says</h3>
      <p className="muted">{POLICY.provenance.basis}</p>
      <table className="grid">
        <thead>
          <tr><th>Rule</th><th>Applies to</th><th className="num">Threshold</th><th>Certainty</th></tr>
        </thead>
        <tbody>
          {POLICY.thresholds.map((t) => (
            <tr key={t.id} style={{ cursor: 'default' }}>
              <td>{t.label}</td>
              <td className="muted">{t.applies_to.map((x) => TYPE_LABEL[x] ?? x).join(', ')}</td>
              <td className="num">{t.comparator === 'gt' ? '> ' : '≥ '}{moneyFull(t.min_value)}</td>
              <td><span className="badge review">{t.certainty}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="small muted" style={{ marginTop: 8 }}>
        {POLICY.thresholds.map((t) => <li key={t.id}><strong>{t.label}:</strong> {t.note}</li>)}
        <li><strong>Non-primary residence:</strong> {POLICY.residency_rule.note}</li>
      </ul>

      <h3>What the loaded data actually flags</h3>
      <div className="stats" style={{ marginBottom: 10 }}>
        <Stat label="Potentially affected" value={affected.toLocaleString()} />
        <Stat label="On city list" value={cmp.listed.toLocaleString()} />
        <Stat label="Inferred only" value={cmp.inferred.toLocaleString()} title="Meets a threshold but is not on a published list in the loaded data" />
        <Stat label="Listed but below" value={cmp.listedBelow.toLocaleString()} title="On the city list yet under every threshold in the policy" />
        <Stat label="Occupancy unknown" value={cmp.noOccupancy.toLocaleString()} />
        <Stat label="Near a cutoff" value={cmp.nearCutoff.toLocaleString()} />
        <Stat label="Reported citywide" value={`${POLICY.provenance.reported_total_qualifier} ${reported.toLocaleString()}`} title="Press-reported size of the initial roll" />
      </div>

      <h3>Law vs. data: where they disagree</h3>
      <table className="grid">
        <thead>
          <tr><th>Threshold rule</th><th className="num">Records matched</th><th className="num">On city list</th><th className="num">Inferred only</th></tr>
        </thead>
        <tbody>
          {cmp.byRule.map((r) => (
            <tr key={r.id} style={{ cursor: 'default' }}>
              <td>{r.label}</td>
              <td className="num">{r.total.toLocaleString()}</td>
              <td className="num">{r.listed.toLocaleString()}</td>
              <td className="num">{r.inferred.toLocaleString()}</td>
            </tr>
          ))}
          <tr style={{ cursor: 'default' }}>
            <td className="muted">On the city list, below every threshold</td>
            <td className="num">{cmp.listedBelow.toLocaleString()}</td>
            <td className="num">{cmp.listedBelow.toLocaleString()}</td>
            <td className="num">0</td>
          </tr>
          <tr style={{ cursor: 'default' }}>
            <td className="muted">On the city list, no valuation available</td>
            <td className="num">{cmp.listedNoValue.toLocaleString()}</td>
            <td className="num">{cmp.listedNoValue.toLocaleString()}</td>
            <td className="num">0</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 6 }}>
        Every row in the last two groups is a lead: the city included a property that the reported rule set,
        applied to the loaded valuation field, does not explain. That is either a wrong reported threshold,
        the wrong valuation field, or a listing worth asking about.
      </p>

      <TaxModel rows={rows} />

      <h3>By property type</h3>
      <table className="grid">
        <thead><tr><th>Type</th><th className="num">Records</th><th className="num">Potentially affected</th><th className="num">Share</th></tr></thead>
        <tbody>
          {cmp.byType.map((t) => (
            <tr key={t.type} style={{ cursor: 'default' }}>
              <td>{TYPE_LABEL[t.type]}</td>
              <td className="num">{t.total.toLocaleString()}</td>
              <td className="num">{t.affected.toLocaleString()}</td>
              <td className="num">{t.total ? `${Math.round((t.affected / t.total) * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>How a record gets flagged</h3>
      <ol className="small">
        <li><strong>Classify.</strong> Explicit type if the file states one, otherwise the DOF building class, otherwise tax class (which cannot separate condo from co-op, so the result is marked ambiguous).</li>
        <li><strong>Pick a valuation.</strong> First available of <code>{POLICY.value_field_priority.join(' → ')}</code>. {POLICY.value_field_note}</li>
        <li><strong>Test the threshold</strong> that applies to that type. An unclassifiable property is tested against all of them and reported as ambiguous.</li>
        <li><strong>Check occupancy evidence.</strong> {POLICY.residency_rule.evidence_note} Absence of evidence is reported as unknown, never as non-primary.</li>
        <li><strong>Reconcile with the city list.</strong> A listed record is <em>direct</em>; a threshold-only match is <em>inferred</em>. A listed record below every threshold is surfaced for review rather than silently accepted.</li>
      </ol>
      <p className="small muted">
        Each step is shown per record in the detail drawer, with the source columns that fed it. Nothing is inferred
        behind a black box.
      </p>

      <h3>Known limits</h3>
      <ul className="small">
        {POLICY.provenance.warnings.map((w) => <li key={w}>{w}</li>)}
        <li>
          Primary-residence status is the deciding fact and is not in public property data.{' '}
          {cmp.noOccupancy.toLocaleString()} potentially-affected records here have no occupancy evidence at all.
          Confidential data could settle part of it, since the state already checks primary residence against income tax filings for STAR, but only for the owner. The exemption also covers a tenant, an immediate family member,
          a majority-interest holder in an owning entity and a sole trust beneficiary, and no filing links those
          people to a particular lot. That is why DOF settles it by application rather than by matching records, and
          why this tool reports occupancy as unknown instead of inferring it.
        </li>
        <li>Positions marked approximate sit on a ZIP or borough centroid, not the parcel. They are drawn faded and ringed.</li>
        <li>Building grouping uses BBL where present and a normalised address otherwise, so two entrances of one complex may appear as two buildings.</li>
      </ul>

      <h3>Sources</h3>
      <ul className="small">
        {POLICY.provenance.sources.map((s) => (
          <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>
        ))}
      </ul>

      <h3>Dataset provenance</h3>
      <p className="small muted">
        Generated {meta.generated_at.slice(0, 19).replace('T', ' ')} under policy <code>{meta.policy_version}</code> from{' '}
        {meta.sources.map((s) => s.file).join(', ') || 'no source files'}.
      </p>
      <p className="small muted">
        Rules live in <code>src/lib/policy.json</code>. Edit thresholds, the valuation priority or the building-class
        map, refresh, and every flag, explanation and count above recomputes. No code change, no re-ingest.
      </p>
    </Modal>
  )
}
