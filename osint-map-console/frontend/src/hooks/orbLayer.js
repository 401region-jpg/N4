// Stage 6 — Orbital object layer management for MapLibre
// Points (circle + label) + track trails + selection highlight.

const ORB_SOURCE       = 'src-orb'
const ORB_TRAIL_SOURCE = 'src-orb-trail'
const ORB_SEL_SOURCE   = 'src-orb-selected'
const ORB_LAYER_BASE   = 'orb-base'
const ORB_LAYER_LABEL  = 'orb-label'
const ORB_TRAIL_LAYER  = 'orb-trail'
const ORB_SEL_LAYER    = 'orb-selected-highlight'

export const ORB_CLICKABLE_LAYERS = [ORB_LAYER_BASE, ORB_LAYER_LABEL]

export function ensureOrbLayers(map) {
  if (map.getSource(ORB_SOURCE)) return

  // ── Orbital point source ──────────────────────────────────────────────────
  map.addSource(ORB_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // ── Track source ──────────────────────────────────────────────────────────
  map.addSource(ORB_TRAIL_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // ── Selection highlight source ────────────────────────────────────────────
  map.addSource(ORB_SEL_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // Track lines — drawn BELOW the dots
  map.addLayer({
    id:     ORB_TRAIL_LAYER,
    type:   'line',
    source: ORB_TRAIL_SOURCE,
    layout: {
      visibility:  'visible',
      'line-cap':  'round',
      'line-join': 'round',
    },
    paint: {
      'line-color':  '#bf5fff',
      'line-width':  1.5,
      'line-opacity': 0.5,
    },
  })

  // Satellite dots — category-coded color, fixed radius
  map.addLayer({
    id:     ORB_LAYER_BASE,
    type:   'circle',
    source: ORB_SOURCE,
    layout: { visibility: 'visible' },
    paint: {
      'circle-radius':         5,
      'circle-color': [
        'case',
        ['==', ['get', 'cat'], 'space station'],       '#ffcc00',
        ['==', ['get', 'cat'], 'navigation'],           '#00ff88',
        ['==', ['get', 'cat'], 'communication'],        '#00e5ff',
        ['==', ['get', 'cat'], 'earth observation'],    '#8bc34a',
        ['==', ['get', 'cat'], 'weather'],              '#ff8c00',
        ['==', ['get', 'cat'], 'astronomy'],            '#bf5fff',
        '#aaaaaa',
      ],
      'circle-opacity':        0.85,
      'circle-stroke-color':   '#ffffff',
      'circle-stroke-width':   1.2,
    },
  })

  // Satellite names — zoom 8+ to avoid clutter
  map.addLayer({
    id:      ORB_LAYER_LABEL,
    type:    'symbol',
    source:  ORB_SOURCE,
    minzoom: 8,
    layout: {
      visibility:           'visible',
      'text-field':         ['coalesce', ['get', 'name'], ['get', 'sat_id']],
      'text-font':          ['Open Sans Regular'],
      'text-size':          9,
      'text-offset':        [0, 1.5],
      'text-anchor':        'top',
      'text-allow-overlap': false,
      'text-optional':      true,
    },
    paint: {
      'text-color':       '#c8dae8',
      'text-halo-color':  'rgba(8,12,16,0.9)',
      'text-halo-width':  1.5,
    },
  })

  // Selection highlight — large glowing dot on top
  map.addLayer({
    id:     ORB_SEL_LAYER,
    type:   'circle',
    source: ORB_SEL_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius':        ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 14, 8, 20, 12, 28],
      'circle-color':         '#ffffff',
      'circle-opacity':       0.25,
      'circle-stroke-color':  '#ffffff',
      'circle-stroke-width':  4,
    },
  })
}

export function removeOrbLayers(map) {
  [ORB_SEL_LAYER, ORB_LAYER_LABEL, ORB_LAYER_BASE, ORB_TRAIL_LAYER].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  ;[ORB_SEL_SOURCE, ORB_SOURCE, ORB_TRAIL_SOURCE].forEach((id) => {
    if (map.getSource(id)) map.removeSource(id)
  })
}

export function setOrbData(map, objects) {
  const src = map.getSource(ORB_SOURCE)
  if (!src) return
  const features = (objects || []).map((obj) => ({
    type:     'Feature',
    geometry: { type: 'Point', coordinates: [obj.lng, obj.lat] },
    properties: {
      sat_id:    obj.sat_id,
      name:      obj.name || obj.sat_id,
      cat:       obj.category || '',
      altitude_km: obj.altitude_km,
    },
  }))
  src.setData({ type: 'FeatureCollection', features })
}

export function setOrbTrails(map, tracks, objects) {
  const src = map.getSource(ORB_TRAIL_SOURCE)
  if (!src) return

  const features = Object.entries(tracks || {})
    .filter(([, pts]) => pts && pts.length >= 2)
    .map(([sat_id, pts]) => ({
      type:     'Feature',
      geometry: { type: 'LineString', coordinates: pts },
      properties: { sat_id },
    }))

  src.setData({ type: 'FeatureCollection', features })
}

export function setOrbSelectedHighlight(map, obj) {
  const src = map.getSource(ORB_SEL_SOURCE)
  if (!src) return
  if (!obj || !obj.lat || !obj.lng) {
    if (map.getLayer(ORB_SEL_LAYER)) map.setLayoutProperty(ORB_SEL_LAYER, 'visibility', 'none')
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [obj.lng, obj.lat] },
      properties: {},
    }],
  })
  if (map.getLayer(ORB_SEL_LAYER)) map.setLayoutProperty(ORB_SEL_LAYER, 'visibility', 'visible')
}

export function setOrbVisibility(map, visible) {
  const v = visible ? 'visible' : 'none'
  ;[ORB_LAYER_BASE, ORB_LAYER_LABEL, ORB_TRAIL_LAYER].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export function setOrbTrailVisibility(map, visible) {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer(ORB_TRAIL_LAYER)) map.setLayoutProperty(ORB_TRAIL_LAYER, 'visibility', v)
}
