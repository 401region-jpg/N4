// v1.5
//
// Basemap switching: layout.visibility ('visible'/'none') on raster layers.
// No setStyle() after init — one persistent style, immediate switch, no artifacts.
//
// Cartographic overlays:
//   Countries — MapLibre demotiles vector source (reliable, keyless).
//               source-layer `countries` (polygon borders) + `centroids`
//               (country label points, field NAME). Capped at z6 (tileset max).
//   Cities    — small bundled GeoJSON (cities.json, ~140 major cities). No
//               network dependency, stays sharp at every zoom.
//   Regions   — demotiles has no admin-1 layer and no reliable keyless global
//               admin-1 vector source is available, so the Regions toggle is
//               disabled in the Sidebar rather than shipped broken.
//
// NOTE: the earlier baseline referenced ne_10m_* source-layers that DO NOT
// EXIST in the demotiles tileset, so Countries/Regions/Cities rendered nothing.
// That is the core Stage-1 bug fixed here.

import citiesData from '../data/cities.json'

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

// True when satellite imagery is the active backdrop — overlays go brighter.
function isImageryBasemap(basemapId) {
  return basemapId === 'satellite' || basemapId === 'hybrid'
}

// Overlay → vector layer ids. Grid is canvas-based (handled in MapView), so it
// is intentionally absent — applyOverlay skips unknown keys gracefully.
export const OVERLAY_GROUPS = {
  countries: ['ov-cnt-line', 'ov-cnt-label'],
  cities:    ['ov-city-dot', 'ov-city-label'],
}

export function applyBasemap(map, basemapId) {
  if (!map || !map.isStyleLoaded()) return
  map.__osintBasemap = basemapId
  const active = new Set(BASEMAP_LAYER_SETS[basemapId] || [])
  ALL_BASEMAP_LAYERS.forEach((id) => {
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', active.has(id) ? 'visible' : 'none')
  })
  if (map.getLayer('bl-hybrid-lines'))
    map.setPaintProperty('bl-hybrid-lines', 'raster-opacity', basemapId === 'hybrid' ? 0.55 : 1)
  applyOverlayTheme(map, basemapId)
}

// Retint overlays per basemap: brighter borders/labels on satellite/hybrid,
// calmer on street. Paint-only — never touches visibility.
export function applyOverlayTheme(map, basemapId) {
  if (!map || !map.isStyleLoaded()) return
  const sat = isImageryBasemap(basemapId)

  const set = (id, prop, val) => {
    if (map.getLayer(id)) { try { map.setPaintProperty(id, prop, val) } catch { /* not ready */ } }
  }

  set('ov-cnt-line', 'line-color', sat ? 'rgba(120,240,255,0.95)' : 'rgba(0,200,230,0.55)')
  set('ov-cnt-line', 'line-width', ['interpolate', ['linear'], ['zoom'],
    0, sat ? 0.9 : 0.6, 4, sat ? 1.6 : 1.1, 6, sat ? 2.2 : 1.6])
  set('ov-cnt-label', 'text-color', sat ? 'rgba(225,250,255,0.98)' : 'rgba(170,210,235,0.9)')
  set('ov-cnt-label', 'text-halo-width', sat ? 2.4 : 1.8)

  set('ov-city-dot', 'circle-color', sat ? 'rgba(140,245,255,0.95)' : 'rgba(0,210,235,0.8)')
  set('ov-city-dot', 'circle-stroke-width', sat ? 1.4 : 0.9)
  set('ov-city-label', 'text-color', sat ? 'rgba(220,248,255,0.95)' : 'rgba(175,210,230,0.85)')
  set('ov-city-label', 'text-halo-width', sat ? 2.0 : 1.5)
}

export function applyOverlay(map, key, visible) {
  if (!map || !map.isStyleLoaded()) return
  const ids = OVERLAY_GROUPS[key]
  if (!ids) return  // grid / regions / etc — handled externally or unavailable
  const v = visible ? 'visible' : 'none'
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export function buildInitialStyle(initBasemap = DEFAULT_BASEMAP) {
  const activeSet = new Set(BASEMAP_LAYER_SETS[initBasemap] || [])
  const bv = (id) => ({ visibility: activeSet.has(id) ? 'visible' : 'none' })
  const sat = isImageryBasemap(initBasemap)

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
      // MapLibre demotiles — keyless, reliable. Layers: countries (polygons),
      // centroids (country label points, NAME field), geolines.
      'src-ne': {
        type: 'vector',
        tiles: ['https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf'],
        maxzoom: 6,
        attribution: '© Natural Earth',
      },
      // Bundled major cities — small, always available.
      'src-cities': {
        type: 'geojson',
        data: citiesData,
      },
    },

    layers: [
      // ── Basemap rasters ───────────────────────────────────────────────────
      {
        id: 'bl-street',
        type: 'raster',
        source: 'src-street',
        layout: bv('bl-street'),
        paint: { 'raster-brightness-max': 0.7, 'raster-saturation': -0.15, 'raster-contrast': 0.05 },
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
        paint: { 'raster-opacity': 0.55 },
      },

      // ── Country borders ───────────────────────────────────────────────────
      {
        id: 'ov-cnt-line',
        type: 'line',
        source: 'src-ne',
        'source-layer': 'countries',
        layout: { visibility: 'visible', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': sat ? 'rgba(120,240,255,0.95)' : 'rgba(0,200,230,0.55)',
          'line-width': ['interpolate', ['linear'], ['zoom'],
            0, sat ? 0.9 : 0.6, 4, sat ? 1.6 : 1.1, 6, sat ? 2.2 : 1.6],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'ov-cnt-label',
        type: 'symbol',
        source: 'src-ne',
        'source-layer': 'centroids',
        minzoom: 1,
        layout: {
          visibility: 'visible',
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 3, 12, 6, 15],
          'text-max-width': 7,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.06,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': sat ? 'rgba(225,250,255,0.98)' : 'rgba(170,210,235,0.9)',
          'text-halo-color': 'rgba(4,8,14,0.95)',
          'text-halo-width': sat ? 2.4 : 1.8,
        },
      },

      // ── Cities (bundled GeoJSON) ──────────────────────────────────────────
      {
        id: 'ov-city-dot',
        type: 'circle',
        source: 'src-cities',
        minzoom: 3,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 6, 3.5, 10, 5],
          'circle-color': sat ? 'rgba(140,245,255,0.95)' : 'rgba(0,210,235,0.8)',
          'circle-stroke-color': 'rgba(4,8,14,0.8)',
          'circle-stroke-width': sat ? 1.4 : 0.9,
        },
      },
      {
        id: 'ov-city-label',
        type: 'symbol',
        source: 'src-cities',
        minzoom: 4,
        layout: {
          visibility: 'none',
          // Zoom-adaptive density: only major (rank 1) labels until z5, then all.
          'text-field': ['step', ['zoom'],
            ['case', ['<=', ['get', 'rank'], 1], ['get', 'name'], ''],
            5, ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 7, 11, 11, 13],
          'text-offset': [0, 1.0],
          'text-anchor': 'top',
          'text-max-width': 8,
        },
        paint: {
          'text-color': sat ? 'rgba(220,248,255,0.95)' : 'rgba(175,210,230,0.85)',
          'text-halo-color': 'rgba(4,8,14,0.93)',
          'text-halo-width': sat ? 2.0 : 1.5,
        },
      },
      // Grid is rendered via canvas overlay in MapView — no vector layers here.
    ],
  }
}
