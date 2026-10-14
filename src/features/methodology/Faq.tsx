import type { Row } from '../../types'
import { POLICY, money, homesOnRow } from '../../lib/data'

/**
 * Questions people have actually asked, in the words they asked them.
 *
 * Not a rewrite of the methodology — that document answers "how was this computed", which is a
 * different question from "why is my building on here" and "where is my name". Every answer that
 * quotes a number computes it from the loaded rows, so the FAQ cannot drift from the dataset the
 * way hand-written copy does.
 */
export default function Faq({ rows }: { rows: Row[] }) {
  const coopRows = rows.filter((r) => r.type === 'coop')
  const coopBuildings = coopRows.filter((r) => (r.apartments ?? 0) >= 2).length
  const coopUncharged = coopRows.filter((r) => !((r.tax.surcharge ?? 0) > 0)).length
  const charged = rows.filter((r) => (r.tax.surcharge ?? 0) > 0)
  const chargedHomes = charged.reduce((a, r) => a + homesOnRow(r), 0)
  const withOwner = rows.filter((r) => r.owner_name).length
  const withListing = rows.filter((r) => r.listing_id).length
  const deadlines = POLICY.deadlines
    .map((d) => `${new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} (${d.label.toLowerCase()})`)
    .join(' or ')

  const QA: { q: string; a: React.ReactNode }[] = [
    {
      q: 'I found my property. Do I owe this?',
      a: <>
        Not necessarily, and most likely not if you live there. Being on the roll means DOF's value and
        ownership screens flagged the property, not that a bill has been issued. The surcharge is not owed on
        a main residence. What you have to do is <strong>say so</strong>, by {deadlines} — DOF settles this by
        application, not by checking. Doing nothing is the one path that leads to a bill.
      </>,
    },
    {
      q: 'I heard the tax was delayed or paused in court. Is the deadline still real?',
      a: <>
        The <strong>exemption deadline moved</strong>, to 6 October 2026 for homes, condos and co-ops — DOF
        extended it twice after a chaotic notice mailing. A Staten Island judge briefly restrained parts of
        the rollout; the city appealed, which stayed that order, and DOF says it is continuing. The surcharge
        itself has not been cancelled: if you owe it, the first bill is still due 1 January 2027. Confirm the
        current deadline on{' '}
        <a href="https://www.nyc.gov/site/finance/property/non-primary-residence-surcharge.page" target="_blank" rel="noreferrer">
          nyc.gov/npsurcharge
        </a>.
      </>,
    },
    {
      q: 'I see my address but not my name. Does the city’s version show my name?',
      a: <>
        Yes, for most properties, and so does this one — it is folded away rather than missing. Open the
        property, expand <em>“Show the full record”</em>, and <strong>Owner</strong> is the last line under
        “Exemption &amp; contestability”. (Turning on <em>Full data</em> shows it without the extra click, and
        you can type your name straight into the search box.) It is DOF's own owner column, copied verbatim:{' '}
        {withOwner.toLocaleString()} of {rows.length.toLocaleString()} records carry one. If yours is blank
        you are probably in a co-op — DOF assesses the building as one parcel, so the roll names the
        cooperative corporation and never the individual shareholder.
      </>,
    },
    {
      q: 'Why is my co-op building on the list when my apartment is nowhere near $1M?',
      a: <>
        Because DOF assesses a co-op as a single parcel, so the roll carries one row for the whole building —
        a nine-figure number that is the building, not your apartment. The threshold and the rate apply{' '}
        <strong>per apartment</strong>, so this site divides that parcel value by DOF's apartment count before
        testing it. That is why {coopUncharged.toLocaleString()} of the {coopRows.length.toLocaleString()}{' '}
        co-op rows here are charged nothing at all, including very large moderate-income co-ops that look
        alarming at the parcel level. A listed building is not a billed shareholder.
      </>,
    },
    {
      q: 'The “pays now” figure doesn’t match my actual tax bill.',
      a: <>
        It is DOF's own billable taxable value for your lot × the class tax rate, not an estimate — but two
        things move it. The class rates are FY2025 and the City Council resets them every year, and any
        exemption or abatement granted after the FY2027 roll is not in it. For a co-op building row, the
        building's tax is divided by its apartment count so it sits beside a per-apartment surcharge, which
        will not match one shareholder's maintenance statement. If it is off by a large multiple rather than a
        little, that is worth telling us about.
      </>,
    },
    {
      q: 'How can one dollar of value cost $50,000?',
      a: <>
        Because the published rate is a flat percentage of the <strong>full</strong> market value for the band
        the property lands in, not a marginal rate on the amount above a line. A condo valued at $2,999,999
        pays 4% of the whole value; at $3,000,001 it pays 5.25% of the whole value. Every band edge is a cliff,
        and this site flags the properties sitting just above one, because that is where a value appeal is
        worth the most.
      </>,
    },
    {
      q: 'The StreetEasy link shows a rental, or a different apartment.',
      a: <>
        Both happen, and both are worth reading rather than dismissing. {withListing.toLocaleString()} records
        link to a real listing page via StreetEasy's own address index; the rest fall back to a search. Where
        only the street address matched, the link is the most recent listing at that address, which in a condo
        is a neighbour — useful as a comparable, not as your asking price. The wording under each link says
        which kind of match it is. And if the listing is a <em>rental</em>, that is not a problem with the
        link: a tenant using the property as their primary residence is one of the{' '}
        {POLICY.exemptions.length} exemption routes.
      </>,
    },
    {
      q: 'Is the value DOF put on my property even right? It looks low.',
      a: <>
        For a condo or co-op it will look low against what your neighbours sell for, and that is the law
        working as written rather than a mistake: state law makes DOF value them from comparable{' '}
        <em>rental</em> income, not sale prices. The gap is real but it is not evidence of an error — 1–3
        family homes, which are valued toward sale value, sit near 1× on the same comparison. Where the value
        genuinely looks wrong, the value is appealable separately from the residency question, and the
        property page links both routes.
      </>,
    },
    {
      q: 'Where do these numbers come from, and who made this?',
      a: <>
        Every property here is from DOF's published supplemental market value roll, and every rate is from
        DOF's published table. Nothing is scraped and nothing is inferred about who lives anywhere — where a
        fact is missing it says unknown. The whole citywide picture, including what the roll would raise if
        nobody were exempt ({money(charged.reduce((a, r) => a + (r.tax.surcharge ?? 0) * homesOnRow(r), 0))} a
        year across {chargedHomes.toLocaleString()} homes) is in the end-to-end view, with its assumptions
        listed. This is not a city site and not legal advice.
      </>,
    },
  ]

  return (
    <>
      <h3 id="faq">Questions people keep asking</h3>
      <div className="faq">
        {QA.map((x) => (
          // A native disclosure: no state, no library, keyboard and find-in-page work by default.
          <details key={x.q}>
            <summary>{x.q}</summary>
            <div className="prose small">{x.a}</div>
          </details>
        ))}
      </div>
      <p className="small dim" style={{ marginTop: 2 }}>
        {coopBuildings.toLocaleString()} rows on this roll are whole co-op buildings rather than single homes,
        which is behind more of the confusion above than anything else.
      </p>
    </>
  )
}
