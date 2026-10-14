import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Row } from '../../types'
import { TYPE_COLOR, TYPE_LABEL, money } from '../../lib/data'

export type MapLayer = 'all' | 'condo_coop' | 'home' | 'review'

export const MAP_LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'all', label: 'All flagged' },
  { id: 'condo_coop', label: 'Likely condos / co-ops' },
  { id: 'home', label: 'Likely 1–3 family' },
  { id: 'review', label: 'Needs review' },
]

const CARTO = (theme: string) => (theme === 'light' ? 'light_all' : 'dark_all')

const style = (theme: string): maplibregl.StyleSpecification => ({
  version: 8,
  // Cluster-count labels only. Single font stack — a comma-joined stack 404s here, and MapLibre
  // then falls back to locally-rendered glyphs, which is also fine if this host ever goes away.
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    base: {
      type: 'raster',
      tiles: [`https://a.basemaps.cartocdn.com/${CARTO(theme)}/{z}/{x}/{y}${devicePixelRatio > 1 ? '@2x' : ''}.png?key=cb1_2vot_1_36d6af59253ddb7eb9908eea`],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }],
})

/** Which rows this map layer shows. Applied to the data, not to the layer, so cluster counts stay honest. */
function subset(rows: Row[], layer: MapLayer) {
  if (layer === 'all') return rows.filter((r) => r.flags.affected)
  if (layer === 'condo_coop') return rows.filter((r) => r.flags.affected && (r.type === 'condo' || r.type === 'coop'))
  if (layer === 'home') return rows.filter((r) => r.flags.affected && r.type === 'home_1_3')
  return rows.filter((r) => r.flags.review.length)
}

function toGeoJSON(rows: Row[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => r.lon != null && r.lat != null)
      .map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lon as number, r.lat as number] },
        properties: {
          id: r.id,
          type: r.type,
          status: r.flags.status,
          weak: ['point', 'geosearch', 'block'].includes(r.geocode_source ?? '') ? 0 : 1,
          review: r.flags.review.length ? 1 : 0,
        },
      })),
  }
}

interface Props {
  rows: Row[]
  byId: Map<string, Row>
  selected: string | null
  onSelect: (id: string | null) => void
  boroughs: GeoJSON.FeatureCollection | null
  layer: MapLayer
  heat: boolean
  cluster: boolean
  showBoroughs: boolean
  /** Changes when the borough filter changes; the camera refits to match. */
  fitKey: string
  theme: string
  onShot: (fn: () => void) => void
}

export default function MapView({ rows, byId, selected, onSelect, boroughs, layer, heat, cluster, showBoroughs, fitKey, theme, onShot }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const fromMap = useRef<string | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; row: Row } | null>(null)

  const shown = useMemo(() => subset(rows, layer), [rows, layer])
  const data = useMemo(() => toGeoJSON(shown), [shown])

  // ---- init (once)
  useEffect(() => {
    if (!holder.current) return
    const m = new maplibregl.Map({
      container: holder.current,
      style: style(theme),
      // Fit the five boroughs rather than a fixed center/zoom, so the framing survives
      // the side panels opening and closing at any window width.
      bounds: [[-74.27, 40.49], [-73.68, 40.92]],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true }, // needed for the PNG export
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')
    m.on('load', () => {
      addLayers(m)
      ready.current = true
      m.getSource('pts') && (m.getSource('pts') as maplibregl.GeoJSONSource).setData(data)
      m.getSource('pts-raw') && (m.getSource('pts-raw') as maplibregl.GeoJSONSource).setData(data)
    })
    return () => {
      ready.current = false
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- restyle on theme change (style swap wipes layers, so re-add them)
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    ready.current = false
    m.setStyle(style(theme))
    m.once('styledata', () => {
      addLayers(m)
      ;(m.getSource('pts') as maplibregl.GeoJSONSource | undefined)?.setData(data)
      ;(m.getSource('pts-raw') as maplibregl.GeoJSONSource | undefined)?.setData(data)
      ready.current = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  function addLayers(m: maplibregl.Map) {
    if (!m.getSource('boro')) m.addSource('boro', { type: 'geojson', data: boroughs ?? { type: 'FeatureCollection', features: [] } })
    // Two copies of the same data: a clustered one and a flat one. Clustering is a source-level
    // option that can't be toggled after creation, and the heatmap needs unclustered points.
    if (!m.getSource('pts')) m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 46, clusterMaxZoom: 15 })
    if (!m.getSource('pts-raw')) m.addSource('pts-raw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

    const line = theme === 'light' ? '#1d6fa5' : '#4ea8de'
    m.addLayer({ id: 'boro-fill', type: 'fill', source: 'boro', paint: { 'fill-color': line, 'fill-opacity': 0.045 } })
    m.addLayer({ id: 'boro-line', type: 'line', source: 'boro', paint: { 'line-color': line, 'line-width': 1.1, 'line-opacity': 0.55 } })

    m.addLayer({
      id: 'heat', type: 'heatmap', source: 'pts-raw', layout: { visibility: 'none' },
      paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 16, 42],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 16, 2.6],
        'heatmap-opacity': 0.75,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 0.2, '#2b4a7d', 0.4, '#4ea8de', 0.6, '#ffd166', 0.8, '#f0782a', 1, '#d81e5b'],
      },
    })

    m.addLayer({
      id: 'clusters', type: 'circle', source: 'pts', filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#4ea8de', 25, '#ffb454', 100, '#f0782a', 400, '#d81e5b'],
        'circle-radius': ['step', ['get', 'point_count'], 13, 25, 17, 100, 22, 400, 29],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.55)',
      },
    })
    m.addLayer({
      id: 'cluster-count', type: 'symbol', source: 'pts', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': ['Open Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': '#0d1117' },
    })
    m.addLayer({
      id: 'pts-clustered', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']],
      paint: pointPaint(),
    })
    m.addLayer({ id: 'pts-flat', type: 'circle', source: 'pts-raw', layout: { visibility: 'none' }, paint: pointPaint() })

    m.addLayer({
      id: 'sel', type: 'circle', source: 'pts-raw', filter: ['==', ['get', 'id'], ' '],
      paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': theme === 'light' ? '#111' : '#fff' },
    })

    for (const id of ['pts-clustered', 'pts-flat', 'clusters']) {
      m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', id, () => {
        m.getCanvas().style.cursor = ''
        setHover(null)
      })
    }
    for (const id of ['pts-clustered', 'pts-flat']) {
      m.on('mousemove', id, (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined
        const row = f && byIdRef.current.get(String(f.properties.id))
        if (row) setHover({ x: e.point.x, y: e.point.y, row })
      })
      m.on('click', id, (e) => {
        const f = e.features?.[0]
        if (!f) return
        const id2 = String(f.properties.id)
        fromMap.current = id2
        onSelectRef.current(id2)
      })
    }
    m.on('click', 'clusters', async (e) => {
      const f = e.features?.[0]
      if (!f) return
      const src = m.getSource('pts') as maplibregl.GeoJSONSource
      const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number)
      m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
    })
  }

  const pointPaint = (): maplibregl.CircleLayerSpecification['paint'] => ({
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.2, 14, 5.5, 17, 9],
    'circle-color': [
      'match', ['get', 'type'],
      'condo', TYPE_COLOR.condo, 'coop', TYPE_COLOR.coop, 'home_1_3', TYPE_COLOR.home_1_3,
      TYPE_COLOR.unknown,
    ],
    'circle-opacity': ['case', ['==', ['get', 'weak'], 1], 0.42, 0.92],
    'circle-stroke-width': ['case', ['==', ['get', 'weak'], 1], 1.4, 0.6],
    'circle-stroke-color': ['case', ['==', ['get', 'weak'], 1], '#ffffff', 'rgba(0,0,0,0.45)'],
  })

  // refs so the map's event handlers (bound once) always see current props
  const byIdRef = useRef(byId)
  const onSelectRef = useRef(onSelect)
  byIdRef.current = byId
  onSelectRef.current = onSelect

  // ---- data
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    ;(m.getSource('pts') as maplibregl.GeoJSONSource | undefined)?.setData(data)
    ;(m.getSource('pts-raw') as maplibregl.GeoJSONSource | undefined)?.setData(data)
  }, [data])

  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    ;(m.getSource('boro') as maplibregl.GeoJSONSource | undefined)?.setData(boroughs ?? { type: 'FeatureCollection', features: [] })
  }, [boroughs])

  // ---- layer visibility
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('heat', heat)
    vis('clusters', cluster && !heat)
    vis('cluster-count', cluster && !heat)
    vis('pts-clustered', cluster && !heat)
    vis('pts-flat', !cluster && !heat)
    vis('boro-fill', showBoroughs)
    vis('boro-line', showBoroughs)
  }, [heat, cluster, showBoroughs, data, theme])

  // ---- selection: outline it, and fly to it when the selection came from outside the map
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    if (m.getLayer('sel')) m.setFilter('sel', ['==', ['get', 'id'], selected ?? ' '])
    if (!selected) return
    const row = byId.get(selected)
    if (!row?.lon || !row.lat) return
    if (fromMap.current === selected) {
      fromMap.current = null
      return
    }
    m.easeTo({ center: [row.lon, row.lat], zoom: Math.max(m.getZoom(), 15), duration: 700 })
  }, [selected, byId, data])

  // ---- follow the borough filter. Picking a borough while zoomed into another one should move
  // the camera there, not leave you staring at an empty street grid.
  const firstFit = useRef(true)
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    if (firstFit.current) { firstFit.current = false; return }
    if (!shown.length) return
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const r of shown) {
      if (r.lon == null || r.lat == null) continue
      if (r.lon < w) w = r.lon
      if (r.lon > e) e = r.lon
      if (r.lat < s) s = r.lat
      if (r.lat > n) n = r.lat
    }
    if (!Number.isFinite(w)) return
    m.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 14, duration: 800 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  // ---- expose the screenshot action upward
  useEffect(() => {
    onShot(() => {
      const m = map.current
      if (!m) return
      m.once('render', () => {
        try {
          const a = document.createElement('a')
          a.href = m.getCanvas().toDataURL('image/png')
          a.download = `nyc-pied-a-terre-map-${new Date().toISOString().slice(0, 10)}.png`
          a.click()
        } catch {
          alert('The browser blocked the canvas export (tainted by basemap tiles). Use an OS screenshot instead.')
        }
      })
      m.triggerRepaint()
    })
  }, [onShot])

  return (
    <div className="map-wrap">
      <div className="map" ref={holder} role="application" aria-label="Map of potentially affected properties" />
      {hover && (
        <div className="map-hover" style={{ left: Math.min(hover.x + 14, (holder.current?.clientWidth ?? 900) - 280), top: hover.y + 14 }}>
          <div>
            <strong>{hover.row.address}</strong>
            {hover.row.unit ? <span className="dim"> · {hover.row.unit}</span> : null}
          </div>
          <div className="muted">
            {TYPE_LABEL[hover.row.type]} · {hover.row.borough} · {money(hover.row.flags.value_used)}
          </div>
          <div className="dim small">{hover.row.flags.rule_label ?? (hover.row.flags.status === 'listed' ? 'On city list' : 'Not flagged')}</div>
        </div>
      )}
      <MapLegend />
    </div>
  )
}

function MapLegend() {
  return (
    <div className="legend">
      <div className="tiny" style={{ marginBottom: 4 }}>Property type</div>
      {(['condo', 'coop', 'home_1_3', 'unknown'] as const).map((t) => (
        <div className="k" key={t}>
          <i className="sw" style={{ background: TYPE_COLOR[t] }} /> {TYPE_LABEL[t]}
        </div>
      ))}
      <div className="k dim" style={{ marginTop: 5 }}>
        <i className="sw hollow" /> faded + ringed = approximate position
      </div>
    </div>
  )
}
