import type { Row } from '../../types'
import {
  moneyFull, POLICY, explainFlags, explainTax, coopBuilding, marketGap, onCliff, deadlines, TYPE_LABEL,
} from '../../lib/data'

/**
 * The print view: one page an owner can hand to an accountant or attach to an exemption
 * application. Hidden on screen, revealed by `@media print` — no PDF dependency, the browser's
 * own Save-as-PDF does the work.
 */
export default function PropertyReport({ row }: { row: Row }) {
  const t = explainTax(row, row.flags)
  const f = explainFlags(row)
  const coop = coopBuilding(row)
  const mk = marketGap(row)
  const dd = deadlines(row)
  const p = row.public
  const isCoop = row.type === 'coop'
  const dl = POLICY.deadlines.find((d) => (isCoop ? d.id === 'coops' : d.id === 'homes_condos')) ?? POLICY.deadlines[0]
  const due = new Date(dl.date + 'T12:00:00')
  const cliff = onCliff(t, row.flags.value_used)

  const Row_ = ({ k, v }: { k: string; v: React.ReactNode }) =>
    v == null || v === '' ? null : <tr><td>{k}</td><td>{v}</td></tr>

  return (
    <div className="report">
      <h1>{row.address}{row.unit ? ` · ${row.unit}` : ''}</h1>
      <div className="sub">
        {[row.borough, row.zip].filter(Boolean).join(' ')}
        {' · '}NYC Non-Primary Residence Property Surcharge, tax years {POLICY.tax_years}
      </div>

      {row.flags.affected && t.surcharge != null ? (
        <div className="headline">
          {moneyFull(coop ? coop.perApartmentSurcharge : t.surcharge)} / year
          <small>
            {coop
              ? `per apartment · ${moneyFull(t.surcharge * coop.apartments)} across the ${coop.apartments}-apartment building`
              : `${((t.rate ?? 0) * 100).toFixed(2)}% of DOF’s ${moneyFull(row.flags.value_used)} market value`}
          </small>
        </div>
      ) : (
        <div className="headline" style={{ fontSize: '14pt' }}>No surcharge computed<small>{t.surcharge_formula}</small></div>
      )}

      <h2>The property</h2>
      <table><tbody>
        <Row_ k="Borough–Block–Lot (BBL)" v={row.bbl} />
        <Row_ k="Property type" v={TYPE_LABEL[row.type]} />
        <Row_ k="DOF building class" v={row.building_class} />
        <Row_ k="Tax class" v={row.tax_class} />
        <Row_ k="Owner of record" v={row.owner_name} />
        <Row_ k="Year built" v={p?.year_built} />
        <Row_ k="Floors / homes" v={p?.floors ? `${p.floors} / ${p?.units_res ?? '—'}` : null} />
        <Row_ k="Historic district" v={p?.historic_district} />
        <Row_ k="On DOF’s published roll" v={row.flags.status === 'listed' ? 'Yes' : 'No'} />
      </tbody></table>

      {mk && (
        <>
          <h2>What the market recorded</h2>
          <table><tbody>
            <Row_ k={mk.scope === 'lot' ? 'Last recorded sale' : 'Last recorded sale in this building'} v={`${moneyFull(mk.sale)} · ${mk.date}${mk.unit ? ` · apt ${mk.unit}` : ''}`} />
            <Row_ k="Against DOF’s value" v={mk.ratio != null ? `${mk.ratio.toFixed(1)}× ${moneyFull(mk.dof)}` : null} />
          </tbody></table>
          <p style={{ fontSize: '9pt', color: '#555', marginTop: '4pt' }}>
            {mk.statutory
              ? 'State law requires DOF to value condominiums and co-operatives from comparable rental income rather than sale prices, so a sale well above DOF’s figure is expected and is not evidence of undervaluation. The surcharge is charged on DOF’s figure. Source: NYC DOF Citywide Annualized Calendar Sales.'
              : 'DOF values 1–3 family homes toward sale value, so these two figures are comparable. Source: NYC DOF Citywide Annualized Calendar Sales.'}
          </p>
        </>
      )}

      <h2>How the figure is reached</h2>
      <table><tbody>
        <Row_ k="DOF market value" v={moneyFull(coop ? coop.buildingValue : row.flags.value_used)} />
        {coop && <Row_ k="Apartments in the building" v={coop.apartments} />}
        {coop && <Row_ k="Value per apartment" v={moneyFull(coop.perApartment)} />}
        <Row_ k="Threshold that applies" v={moneyFull(row.flags.threshold)} />
        <Row_ k="Rate band" v={t.band} />
        <Row_ k="Rate on the full value" v={t.rate != null ? `${(t.rate * 100).toFixed(2)}%` : null} />
        <Row_ k="Surcharge" v={t.surcharge != null ? `${moneyFull(t.surcharge)} / yr` : null} />
        <Row_ k="Existing property tax (estimated)" v={t.current != null ? `${moneyFull(t.current)} / yr` : null} />
        <Row_ k="Combined" v={t.total != null ? `${moneyFull(t.total)} / yr` : null} />
      </tbody></table>
      <p style={{ fontSize: '9pt', color: '#555', marginTop: '4pt' }}>{t.surcharge_formula}</p>

      {cliff && t.appeal_saving != null && (
        <div className="box">
          <strong>On a rate cliff.</strong> The value sits {moneyFull(t.appeal_drop)} above the {moneyFull(t.floor_edge)} line.
          Because the rate applies to the full value, falling below that line would reduce the surcharge by{' '}
          <strong>{moneyFull(t.appeal_saving)} a year</strong>. Whether a reduction is achievable is a question for the
          NYC Tax Commission.
        </div>
      )}

      {/* A printed page is likelier than the screen to be read out of context — an unconditional
          deadline on a property that owes nothing is the version someone hands to an accountant. */}
      {t.surcharge ? (
        <>
          <h2>Deadlines</h2>
          <table><tbody>
            <Row_
              k={`Exemption application, ${dl.label.toLowerCase()}`}
              v={`${due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${dd.exemption.open ? ` · ${dd.exemption.days} days left` : ' · passed'}`}
            />
            <Row_
              k={`Tax Commission appeal, ${dd.appeal.label}`}
              v={`${new Date(dd.appeal.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${dd.appeal.open ? ` · ${dd.appeal.days} days left` : ' · passed'}`}
            />
          </tbody></table>
          <p style={{ fontSize: '9pt', color: '#555', marginTop: '4pt' }}>
            {dl.note} The Tax Commission hears both grounds: that DOF’s market value is too high, and that the
            property is a primary residence. {POLICY.appeals.dof_first_note} Source: {POLICY.appeals.citation}
          </p>

          <h2>Exemption routes</h2>
          <p style={{ fontSize: '10pt', margin: '0 0 4pt' }}>{POLICY.residency_rule.note}</p>
          <ul>
            {POLICY.exemptions.map((e) => <li key={e.id}><strong>{e.label}.</strong> {e.note}</li>)}
          </ul>
          <p style={{ fontSize: '9.5pt', color: '#444' }}>{POLICY.exemption_documents_note}</p>
        </>
      ) : (
        <div className="box">
          <strong>No surcharge is computed for this property.</strong> It appears on DOF’s published roll, which
          “includes, but is not limited to, those properties that may be subject to the surcharge”. There is no
          deadline to meet and nothing to apply for.
        </div>
      )}

      <h2>Where to go</h2>
      <ul>
        <li>Apply for an exemption: nyc.gov/npsurcharge</li>
        <li>Eligibility guide: nyc.gov/site/finance/property/property-surcharge-eligiblity-tool.page</li>
        <li>Challenge the value: nyc.gov/site/taxcommission/forms/surcharge-appeal.page</li>
        {row.bbl && <li>City parcel record: propertyinformationportal.nyc.gov/parcels/parcel/{row.bbl}</li>}
      </ul>

      <h2>Why this property is on the roll</h2>
      <p style={{ fontSize: '10pt' }}>{f.explain}</p>

      <div className="foot">
        Generated {new Date().toLocaleString('en-US')} from thelist.traqqit.com · Source: NYC Department of Finance
        supplemental market value roll published 24 July 2026, and the rate table at nyc.gov/npsurcharge (policy{' '}
        {POLICY.version}).
        <br />
        <strong>Being on the roll is not a bill and this is not tax advice.</strong> DOF states the roll “includes, but is
        not limited to, those properties that may be subject to the surcharge”. Liability turns on primary residence,
        which no public record establishes. Not affiliated with the City of New York.
      </div>
    </div>
  )
}
