import { useMemo, useState } from 'react'
import type { Row } from '../../types'
import { POLICY, money, taxTotals } from '../../lib/data'
import { BOOKMARKS, type Filters } from '../../state'

/** Days until the earlier of the two exemption deadlines — the only clock that matters here. */
export function nextDeadline() {
  const dl = [...POLICY.deadlines].sort((a, b) => a.date.localeCompare(b.date))[0]
  const due = new Date(dl.date + 'T12:00:00')
  return { dl, due, days: Math.ceil((due.getTime() - Date.now()) / 86_400_000) }
}

const OFFICIAL = [
  {
    href: 'https://www.nyc.gov/site/finance/property/non-primary-residence-surcharge.page',
    label: 'Apply for an exemption at DOF',
    note: 'the official page, forms and affidavits',
  },
  {
    href: 'https://www.nyc.gov/site/finance/property/property-surcharge-eligiblity-tool.page',
    label: 'DOF eligibility guide',
    note: 'check whether you may be exempt before you file',
  },
  {
    href: 'https://www.nyc.gov/site/taxcommission/forms/surcharge-appeal.page',
    label: 'Challenge the value',
    note: 'NYC Tax Commission surcharge appeal',
  },
]

interface Props {
  rows: Row[]
  onSearch: (q: string) => void
  onPick: (f: Partial<Filters>) => void
  onAbout: () => void
}

/**
 * The front door. A visitor arrives with a question, not a query — so a bare visit gets one
 * search box and two findings, and the 45-control workspace waits until they have asked for it.
 */
export default function Landing({ rows, onSearch, onPick, onAbout }: Props) {
  const [q, setQ] = useState('')
  const t = useMemo(() => taxTotals(rows), [rows])
  const { dl, days } = nextDeadline()
  const entries = BOOKMARKS.filter((b) => b.simple).slice(0, 3)
  // The city's own revenue estimate, against a roll priced as if nobody claims an exemption.
  const expected = POLICY.tax_model.expected_revenue
  const ratio = Math.max(2, Math.round(t.surcharge / expected))

  return (
    <div className="landing">
      <div className="landing-in">
        {/* Deliberately not .mono — tabular figures give the thousands comma a full character
            width, and "31 , 541" at 28px reads as a typo. */}
        <h1 className="display">
          {rows.length.toLocaleString()} New York properties are on the city’s new pied-à-terre roll.
        </h1>
        <p className="lede">
          The Department of Finance published it on 24 July 2026: every home the city may charge a surcharge on for not
          being someone’s main residence, with the value it will be charged against.{' '}
          {days > 0 && <>Owners have <strong>{days} days</strong> left to claim an exemption ({dl.label.toLowerCase()} close first).</>}
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); onSearch(q) }}
        >
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your address, e.g. 205 East 22 Street"
            aria-label="Search the roll by address"
          />
          <button type="submit" className="primary">Check an address</button>
        </form>
        <div className="hint">
          <span>Condominium and co-op apartments are listed individually. Not finding an address is the good outcome.</span>
          {/* The other half of the audience has no address in mind — give them the door, not a hint. */}
          <button onClick={() => onPick({})}>No address in mind? Explore the map →</button>
        </div>

        <h2>Or start from a finding</h2>
        <div className="entries">
          {entries.map((b) => (
            <button key={b.label} onClick={() => onPick(b.filters)}>
              <b>{b.label}</b>
              <span>{b.note}</span>
            </button>
          ))}
        </div>

        <div className="finding">
          <h3>{ratio - 1} of every {ratio} dollars on this roll will never be collected</h3>
          <p>
            Priced as though nobody is exempt, the roll is worth <strong className="mono">{money(t.surcharge)}</strong> a
            year. The city’s own revenue estimate is about <span className="mono">{money(expected)}</span>. The gap is the
            share DOF expects to be exempted, and public data cannot show who lives where, so no one can name which
            dollars they are.
          </p>
          <button className="link" onClick={onAbout}>How that figure is built →</button>
        </div>

        <div className="finding">
          <h3>{t.cliffN.toLocaleString()} properties sit just above a rate cliff</h3>
          <p>
            The rate is a flat percentage of the <em>full</em> value, not of the amount above a line, so every band edge
            is a cliff. These properties are within 10% of one, with <strong className="mono">{money(t.cliffAtStake)}</strong>{' '}
            a year between them riding on a revaluation. The tightest is over its line by a few hundred dollars.
          </p>
          <button className="link" onClick={() => onPick({ onlyCliff: true })}>
            Show those {t.cliffN.toLocaleString()} properties →
          </button>
        </div>

        <div className="landing-foot">
          <h2>If you already know you are listed</h2>
          <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
            {OFFICIAL.map((l) => (
              <a key={l.href} className="official" href={l.href} target="_blank" rel="noreferrer">
                <b>{l.label} ↗</b>
                <span>{l.note}</span>
              </a>
            ))}
          </div>
          <p className="small muted" style={{ lineHeight: 1.6 }}>
            DOF states the roll “includes, but is not limited to, those properties that may be subject to the surcharge”.
            Liability turns on primary residence, which no public record establishes, so nothing here is a
            determination that a surcharge is owed, and none of it is tax advice.{' '}
            <button className="link" onClick={onAbout}>Methodology, sources and limits</button>
          </p>
        </div>
      </div>
    </div>
  )
}
