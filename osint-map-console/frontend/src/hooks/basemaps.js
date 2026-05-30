// v1.4 FINAL
//
// Basemap switching: layout.visibility ('visible'/'none') на raster layers.
// Никакого setStyle() после init. Немедленное переключение без артефактов.
//
// Overlay vector source: demotiles.maplibre.org (публичный, без ключа).
// Верные source-layer имена проверены по схеме тайлсета:
//   countries  → ne_10m_admin_0_countries
//   regions    → ne_10m_admin_1_states_provinces
//   cities     → ne_10m_populated_places
//   water      → ne_10m_lakes + ne_10m_rivers_lake_centerlines

export const BASEMAP_IDS     = ['street', 'satellite', 'hybrid']
export const DEFAULT_BASEMAP  = 'street'

export const BASEMAP_LABELS = {
  street:    'STREET',
  satellite: 'SATELLITE',
  hybrid:    'HYBRID',
}

export const BASEMAP_LAYER_SETS = {
  street:    ['bl-street'],
  satellite: ['bl-satellite'],
  hybrid:    ['bl-satellite', 'bl-hybrid-lines'],
}

const ALL_BASEMAP_LAYERS = ['bl-street', 'bl-satellite', 'bl-hybrid-lines']

// Grid managed by canvas overlay in MapView — no vector layers needed.
// All other overlays map to real vector source-layers below.
export const OVERLAY_GROUPS = {
  countries: ['ov-cnt-fill', 'ov-cnt-line', 'ov-cnt-label'],
  regions:   ['ov-reg-line', 'ov-reg-label'],
  cities:    ['ov-city-dot', 'ov-city-label'],
  // grid is canvas-based, no vector layers — applyOverlay skips it gracefully
}

export function applyBasemap(map, basemapId) {
  if (!map || !map.isStyleLoaded()) return
  const active = new Set(BASEMAP_LAYER_SETS[basemapId] || [])
  ALL_BASEMAP_LAYERS.forEach((id) => {
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', active.has(id) ? 'visible' : 'none')
  })
  if (map.getLayer('bl-hybrid-lines'))
    map.setPaintProperty('bl-hybrid-lines', 'raster-opacity', basemapId === 'hybrid' ? 0.65 : 1)
}

export function applyOverlay(map, key, visible) {
  if (!map || !map.isStyleLoaded()) return
  const ids = OVERLAY_GROUPS[key]
  if (!ids) return  // grid etc — handled externally
  const v = visible ? 'visible' : 'none'
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export function buildInitialStyle(initBasemap = DEFAULT_BASEMAP) {
  const activeSet = new Set(BASEMAP_LAYER_SETS[initBasemap] || [])
  const bv = (id) => ({ visibility: activeSet.has(id) ? 'visible' : 'none' })

  return {
    version: 8,
    glyphs:  'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sprite:  '',

    sources: {
      'src-street': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
      'src-satellite': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
      'src-hybrid-lines': {
        type: 'raster',
        tiles: ['https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 20,
      },
      // Natural Earth vector tiles — публичный demo сервер MapLibre.
      // Проверенные source-layer: ne_10m_admin_0_countries,
      //   ne_10m_admin_1_states_provinces, ne_10m_populated_places
      'src-ne': {
        type: 'vector',
        tiles: ['https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf'],
        maxzoom: 6,
        attribution: '© Natural Earth',
      },
    },

    layers: [
      // ── Basemap rasters ───────────────────────────────────────────────────
      {
        id: 'bl-street',
        type: 'raster',
        source: 'src-street',
        layout: bv('bl-street'),
        paint: { 'raster-brightness-max': 0.68, 'raster-saturation': -0.18, 'raster-contrast': 0.04 },
      },
      {
        id: 'bl-satellite',
        type: 'raster',
        source: 'src-satellite',
        layout: bv('bl-satellite'),
        paint: {},
      },
      {
        id: 'bl-hybrid-lines',
        type: 'raster',
        source: 'src-hybrid-lines',
        layout: bv('bl-hybrid-lines'),
        paint: { 'raster-opacity': 0.65 },
      },

      // ── Countries ─────────────────────────────────────────────────────────
      {
        id: 'ov-cnt-fill',
        type: 'fill',
        source: 'src-ne',
        'source-layer': 'ne_10m_admin_0_countries',
        layout: { visibility: 'visible' },
        paint: { 'fill-color': 'rgba(0,229,255,0.03)', 'fill-outline-color': 'transparent' },
      },
      {
        id: 'ov-cnt-line',
        type: 'line',
        source: 'src-ne',
        'source-layer': 'ne_10m_admin_0_countries',
        layout: { visibility: 'visible' },
        paint: {
          'line-color': ['interpolate', ['linear'], ['zoom'],
            0, 'rgba(0,200,230,0.45)', 4, 'rgba(0,229,255,0.65)', 6, 'rgba(0,229,255,0.8)'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 0.9, 6, 1.5],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'ov-cnt-label',
        type: 'symbol',
        source: 'src-ne',
        'source-layer': 'ne_10m_admin_0_countries',
        minzoom: 1,
        maxzoom: 6,
        layout: {
          visibility: 'visible',
          'text-field': ['coalesce', ['get', 'NAME_EN'], ['get', 'NAME']],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 8, 3, 10, 5, 12],
          'text-max-width': 7,
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': 'rgba(190,220,240,0.9)',
          'text-halo-color': 'rgba(4,8,14,0.95)',
          'text-halo-width': 1.8,
        },
      },

      // ── Regions / Admin-1 ─────────────────────────────────────────────────
      {
        id: 'ov-reg-line',
        type: 'line',
        source: 'src-ne',
        'source-layer': 'ne_10m_admin_1_states_provinces',
        minzoom: 3,
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(0,180,210,0.32)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 6, 0.9],
          'line-dasharray': [2, 4],
        },
      },
      {
        id: 'ov-reg-label',
        type: 'symbol',
        source: 'src-ne',
        'source-layer': 'ne_10m_admin_1_states_provinces',
        minzoom: 4,
        maxzoom: 7,
        layout: {
          visibility: 'none',
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 6, 10],
          'text-max-width': 6,
          'text-anchor': 'center',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': 'rgba(150,195,215,0.75)',
          'text-halo-color': 'rgba(4,8,14,0.92)',
          'text-halo-width': 1.4,
        },
      },

      // ── Cities ────────────────────────────────────────────────────────────
      {
        id: 'ov-city-dot',
        type: 'circle',
        source: 'src-ne',
        'source-layer': 'ne_10m_populated_places',
        minzoom: 3,
        layout: { visibility: 'none' },
        filter: ['any',
          ['==', ['get', 'FEATURECLA'], 'Admin-0 capital'],
          ['==', ['get', 'FEATURECLA'], 'Admin-1 capital'],
          ['>=', ['coalesce', ['get', 'POP_MAX'], 0], 500000],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 5, 3, 6, 4],
          'circle-color': 'rgba(0,229,255,0.75)',
          'circle-stroke-color': 'rgba(4,8,14,0.7)',
          'circle-stroke-width': 0.8,
        },
      },
      {
        id: 'ov-city-label',
        type: 'symbol',
        source: 'src-ne',
        'source-layer': 'ne_10m_populated_places',
        minzoom: 3,
        maxzoom: 7,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8, 5, 10, 6, 11],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-allow-overlap': false,
        },
        filter: ['any',
          ['==', ['get', 'FEATURECLA'], 'Admin-0 capital'],
          ['==', ['get', 'FEATURECLA'], 'Admin-1 capital'],
          ['>=', ['coalesce', ['get', 'POP_MAX'], 0], 500000],
        ],
        paint: {
          'text-color': 'rgba(180,215,235,0.85)',
          'text-halo-color': 'rgba(4,8,14,0.93)',
          'text-halo-width': 1.5,
        },
      },
      // Grid is rendered via canvas overlay in MapView — no vector layers here.
    ],
  }
}
