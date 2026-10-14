import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { MAP_LAYERS, type MapLayer } from './features/map/MapView'
import FilterPanel from './features/properties/Filters'
import PropertyTable from './features/properties/PropertyTable'
import BuildingTable from './features/buildings/BuildingTable'
import CoopLeaderboard from './features/buildings/CoopLeaderboard'
import DetailDrawer from './features/properties/DetailDrawer'
import PropertyReport from './features/properties/PropertyReport'
import CompareModal from './features/properties/CompareModal'
import Methodology from './features/methodology/Methodology'
import Macro from './features/macro/Macro'
import Landing, { nextDeadline } from './features/landing/Landing'
import StatusBanner from './components/StatusBanner'
import SignIn from './features/account/SignIn'
import { account, favourites, hydrate, signOut, toggleFavourite } from './lib/account'
import { DEFAULT, activeFilterCount, useUrlState, type Filters } from './state'
import {
  loadDataset, loadBoroughs, applyFilters, buildings, propertiesCsv, buildingsCsv,
  download, stamp, coopLeaderboard, POLICY,
} from './lib/data'
import type { Dataset, Row } from './types'

type Tab = 'properties' | 'buildings' | 'coops'

export default function App() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<Dataset['meta'] | null>(null)
  const [boroughsGeo, setBoroughsGeo] = useState<GeoJSON.FeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Follows the OS on a first visit. A homeowner arriving anxious about a tax notice should not
  // land in a terminal palette; a stored choice always wins afterwards.
  const [theme, setTheme] = useState(
    () => localStorage.getItem('nyc-pat-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  )
  // Simple by default: most people arrive asking one question about one address.
  const [expert, setExpert] = useState(() => localStorage.getItem('nyc-pat-expert') === '1')
  const [tab, setTab] = useState<Tab>('properties')
  const [tableFull, setTableFull] = useState(false)
  const [mapLayer, setMapLayer] = useState<MapLayer>('all')
  const [layersOpen, setLayersOpen] = useState(false)
  const [heat, setHeat] = useState(false)
  const [cluster, setCluster] = useState(true)
  const [showBoroughs, setShowBoroughs] = useState(true)
  const [menu, setMenu] = useState(false)
  // Below ~720px the sidebar becomes a sheet. On desktop this is ignored — CSS keeps it docked.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  // Saved properties work logged out and are never gated. `signedIn` only affects whether they sync.
  const [favs, setFavs] = useState<string[]>(() => favourites())
  const [onlyFavs, setOnlyFavs] = useState(false)
  const [signedIn, setSignedIn] = useState(() => account()?.email ?? null)
  const [askAccount, setAskAccount] = useState(false)
  const [promptDismissed, setPromptDismissed] = useState(() => localStorage.getItem('nyc-pat-save-prompt') === 'off')

  const { filters, setFilters, patch, selected, setSelected, compare, toggleCompare, view, setView, bare } = useUrlState()
  // A bare visit gets the front door; a link that carries any state opens straight into the workspace.
  const [entered, setEntered] = useState(!bare)
  const searchRef = useRef<HTMLInputElement>(null)
  const shotRef = useRef<() => void>(() => {})

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('nyc-pat-theme', theme)
  }, [theme])

  useEffect(() => localStorage.setItem('nyc-pat-expert', expert ? '1' : '0'), [expert])

  useEffect(() => {
    loadDataset().then(({ rows, meta }) => { setRows(rows); setMeta(meta) }).catch((e) => setError(String(e.message ?? e)))
    loadBoroughs().then(setBoroughsGeo)
    // Pulls the account's saved list and unions it with this device's. No-op when logged out.
    hydrate().then(setFavs)
  }, [])

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 2200)
  }, [])

  // Global keys: / focuses search, Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.('input, textarea, select')
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') {
        if (menu) setMenu(false)
        else if (view || showCompare) { setView(null); setShowCompare(false) }
        else if (filtersOpen) setFiltersOpen(false)
        else if (selected) setSelected(null)
        else if (typing) (e.target as HTMLElement).blur()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [menu, view, showCompare, filtersOpen, selected, setSelected, setView])

  // The overflow menu is a native <details>; it still has to close when you click past it.
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('details.menu')) setMenu(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  const onFav = useCallback((id: string) => setFavs(toggleFavourite(id)), [])

  const all = useMemo(() => (rows ? applyFilters(rows, filters) : []), [rows, filters])
  // A view, not a filter: saved properties stay saved whatever else is selected, and this never
  // touches the URL state so a shared link can't accidentally carry someone else's saved list.
  const filtered = useMemo(() => (onlyFavs ? all.filter((r) => favs.includes(r.id)) : all), [all, onlyFavs, favs])
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows])
  const buildingRows = useMemo(() => buildings(filtered), [filtered])
  const coopCount = useMemo(() => coopLeaderboard(filtered).ranked.length, [filtered])
  const boroughNames = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.borough).filter(Boolean) as string[])].sort(),
    [rows],
  )
  const selectedRow = selected ? byId.get(selected) ?? null : null
  const compareRows = compare.map((id) => byId.get(id)).filter(Boolean) as Row[]

  const enter = (f: Partial<Filters>) => { setFilters({ ...DEFAULT, ...f }); setEntered(true) }

  if (error) {
    return (
      <div className="loading">
        <div className="err">
          <strong>Could not load the dataset.</strong>
          <p className="muted small">{error}</p>
          <code>npm run fetch &amp;&amp; npm run ingest</code>
        </div>
      </div>
    )
  }
  if (!rows || !meta) return <div className="loading">Loading properties…</div>

  const { dl, days } = nextDeadline()

  return (
    <>
      <div className="app">
      <StatusBanner />
      <header className="topbar">
        <button className="brand" onClick={() => setEntered(false)} title="Back to the front page">
          The <span>List</span>
          <em>NYC surcharge roll · {rows.length.toLocaleString()} properties</em>
        </button>
        {/* The front door has its own search box; two would just compete. */}
        {entered && (
          <div className="search">
            <input
              ref={searchRef}
              type="search"
              placeholder={expert ? 'Search address, borough, ZIP, BBL, BIN, building class…  ( / )' : 'Search your address…  ( / )'}
              value={filters.q}
              onChange={(e) => patch({ q: e.target.value })}
              aria-label="Search properties"
            />
          </div>
        )}
        <div className="grow" />
        {/* Hidden on a phone, where a fourth top-bar control pushes the ⋯ menu onto a second row.
            It is in that menu too, so nothing is lost. */}
        <button className="hide-sm" onClick={() => setView('macro')} title="The citywide picture: how few properties this is, and how much money">Citywide</button>
        <button onClick={() => setView('method')}>How this works</button>
        <details className="menu" open={menu} onToggle={(e) => setMenu(e.currentTarget.open)}>
          <summary title="More tools" aria-label="More tools">⋯</summary>
          <div className="menu-body" onClick={() => setMenu(false)}>
            {expert && entered && (
              <>
                <button onClick={() => setShowCompare(true)}>Compare{compare.length ? ` (${compare.length})` : ''}</button>
                <button onClick={() => download(`nyc-pied-a-terre-properties-${stamp()}.csv`, propertiesCsv(filtered))}>
                  Download this view (CSV)
                </button>
                <button onClick={() => download(`nyc-pied-a-terre-buildings-${stamp()}.csv`, buildingsCsv(buildingRows))}>
                  Download buildings (CSV)
                </button>
                <hr />
              </>
            )}
            <button onClick={() => setView('macro')}>Citywide picture</button>
            <button onClick={() => { navigator.clipboard.writeText(location.href); toast('View link copied') }}>Copy link to this view</button>
            {signedIn
              ? <button onClick={() => { signOut(); setSignedIn(null); toast('Signed out. Saved properties stay on this device') }}>Sign out ({signedIn})</button>
              : <button onClick={() => setAskAccount(true)}>Sign in to sync saved</button>}
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀ Light theme' : '☾ Dark theme'}
            </button>
            <hr />
            <button
              aria-pressed={expert}
              onClick={() => setExpert((v) => !v)}
              title="Every filter, column, export and per-record rule check"
            >
              {expert ? '✓ Full data' : 'Full data'}
            </button>
          </div>
        </details>
      </header>

      <div className="disclaimer">
        {expert ? (
          <>
            <strong>The roll, not a determination.</strong>
            <span className="grow">
              DOF’s own page says the roll “includes, but is not limited to, those properties that may be subject to the surcharge”.
              Liability turns on primary residence, which no public dataset records.
            </span>
          </>
        ) : (
          <>
            <strong>Being on the list is not a bill.</strong>
            <span className="grow">
              The surcharge is not owed if the home is someone’s main residence, but the city asks owners to apply.
            </span>
          </>
        )}
        {days > 0 ? (
          <span className="due" title={`${dl.label}: ${dl.note}`}>
            {days} day{days === 1 ? '' : 's'} left to apply
          </span>
        ) : (
          // The exemption window is shut but the Tax Commission window runs to March 2027, so the
          // banner shifts rather than going quiet. Dates come from policy.appeals.
          <span className="due" title="NYC Tax Commission surcharge appeal deadline">
            Exemption window closed. Appeals open until{' '}
            {new Date(POLICY.appeals.deadlines[0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
        )}
        <span className="dim" style={{ fontSize: 12 }}>Roll as published 24 July 2026</span>
        <button className="ghost small" onClick={() => setView('method')}>{expert ? 'Read the method' : 'What does that mean?'}</button>
      </div>

      {!entered ? (
        <Landing
          rows={rows}
          onSearch={(q) => enter({ q })}
          onPick={enter}
          onAbout={() => setView('method')}
        />
      ) : (
      <div className="body">
        <FilterPanel
          f={filters} patch={patch} setFilters={setFilters} boroughs={boroughNames}
          total={rows.length} shown={filtered.length} expert={expert}
          open={filtersOpen} onClose={() => setFiltersOpen(false)}
        />
        {filtersOpen && <div className="sheet-scrim" onClick={() => setFiltersOpen(false)} />}

        <main className="main">
          {!tableFull && (
            <div className="map-slot">
              <MapView
                rows={filtered}
                byId={byId}
                selected={selected}
                onSelect={setSelected}
                boroughs={showBoroughs ? boroughsGeo : null}
                layer={mapLayer}
                heat={heat}
                cluster={cluster}
                showBoroughs={showBoroughs}
                fitKey={filters.boroughs.join(',')}
                theme={theme}
                onShot={(fn) => { shotRef.current = fn }}
              />
              <div className="map-tools">
                <div className="row">
                  <span className="count-pill mono">{filtered.length.toLocaleString()} shown</span>
                  {expert && (
                    <>
                      <button className="small" aria-pressed={layersOpen} onClick={() => setLayersOpen((v) => !v)}>Layers</button>
                      <button className="small" aria-pressed={cluster && !heat} onClick={() => { setCluster((v) => !v); setHeat(false) }}>Cluster</button>
                      <button className="small" aria-pressed={heat} onClick={() => setHeat((v) => !v)}>Heatmap</button>
                      <button className="small" aria-pressed={showBoroughs} onClick={() => setShowBoroughs((v) => !v)}>Boroughs</button>
                      <button className="small" onClick={() => shotRef.current()} title="Download the current map extent as PNG">PNG</button>
                    </>
                  )}
                </div>
                {expert && layersOpen && (
                  <div className="row wrap" style={{ maxWidth: 430 }}>
                    {MAP_LAYERS.map((l) => (
                      <button key={l.id} className="small" aria-pressed={mapLayer === l.id} onClick={() => setMapLayer(l.id)}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Result views">
            <button className="tab" role="tab" id="tab-properties" aria-controls="table-pane" aria-selected={tab === 'properties'} onClick={() => setTab('properties')}>
              Properties <span className="mono dim">{filtered.length.toLocaleString()}</span>
            </button>
            <button
              className="tab"
              role="tab"
              id="tab-coops"
              aria-controls="table-pane"
              aria-selected={tab === 'coops'}
              onClick={() => setTab('coops')}
              title="Co-op buildings ranked by the surcharge per apartment"
            >
              Co-ops<span className="hide-sm"> by surcharge</span> <span className="mono dim">{coopCount.toLocaleString()}</span>
            </button>
            {expert && (
              <button className="tab" role="tab" id="tab-buildings" aria-controls="table-pane" aria-selected={tab === 'buildings'} onClick={() => setTab('buildings')}>
                Buildings <span className="mono dim">{buildingRows.length.toLocaleString()}</span>
              </button>
            )}
            {favs.length > 0 && (
              <button className="tab" role="tab" id="tab-saved" aria-controls="table-pane" aria-selected={onlyFavs} onClick={() => setOnlyFavs((v) => !v)}>
                ★ Saved <span className="mono dim">{favs.length}</span>
              </button>
            )}
            <div className="grow" />
            {/* Only exists below 720px, where the sidebar is a sheet rather than a column. */}
            <button className="small mobile-only" onClick={() => setFiltersOpen(true)}>
              Filters{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}
            </button>
            <button className="small ghost" onClick={() => setTableFull((v) => !v)}>
              {tableFull ? <>↕ <span className="hide-sm">Show </span>map</> : <>↕ <span className="hide-sm">Full </span>table</>}
            </button>
          </div>

          {/* The only place an account is mentioned unprompted, and it is dismissible for good. */}
          {favs.length >= 2 && !signedIn && !promptDismissed && (
            <div className="savebar">
              <span className="grow">
                <strong>{favs.length} saved on this device.</strong> An account keeps them if you switch phone or browser.
                That is all it does.
              </span>
              <button className="primary small" onClick={() => setAskAccount(true)}>Create a free account</button>
              <button
                className="ghost small"
                onClick={() => { setPromptDismissed(true); localStorage.setItem('nyc-pat-save-prompt', 'off') }}
              >
                No thanks
              </button>
            </div>
          )}

          <div className={tableFull ? 'table-pane full' : 'table-pane'} id="table-pane" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'properties' ? (
              <PropertyTable rows={filtered} query={filters.q} selected={selected} onSelect={setSelected} compare={compare} onToggleCompare={toggleCompare} expert={expert} favs={favs} onToggleFav={onFav} />
            ) : tab === 'coops' ? (
              <CoopLeaderboard rows={filtered} onOpen={setSelected} />
            ) : (
              <BuildingTable buildings={buildingRows} rows={filtered} onOpen={setSelected} />
            )}
          </div>
        </main>

        {selectedRow && (
          <DetailDrawer
            row={selectedRow}
            all={rows}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            onCompare={toggleCompare}
            inCompare={compare.includes(selectedRow.id)}
            expert={expert}
            toast={toast}
            isFav={favs.includes(selectedRow.id)}
            onToggleFav={onFav}
          />
        )}
      </div>
      )}

      {view === 'method' && <Methodology meta={meta} rows={rows} onClose={() => setView(null)} />}
      {view === 'macro' && <Macro meta={meta} rows={rows} onClose={() => setView(null)} />}
      {showCompare && <CompareModal rows={compareRows} onClose={() => setShowCompare(false)} onRemove={toggleCompare} />}
      {askAccount && (
        <SignIn
          saved={favs.length}
          onClose={() => setAskAccount(false)}
          onDone={() => {
            setAskAccount(false)
            setSignedIn(account()?.email ?? null)
            setFavs(favourites())
            toast('Saved properties will sync to this account')
          }}
        />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>

      {/* Outside .app on purpose: print CSS hides the whole app and reveals this instead. */}
      {selectedRow && <PropertyReport row={selectedRow} />}
    </>
  )
}
