// Stage 5 / 5.1 — Aircraft layer management for MapLibre
// Points (circle + label) + short trail LineStrings per aircraft.

const AIR_SOURCE       = 'src-air'
const AIR_TRAIL_SOURCE = 'src-air-trail'
const AIR_SEL_SOURCE   = 'src-air-selected'
const AIR_LAYER_BASE   = 'air-base'
const AIR_LAYER_LABEL  = 'air-label'
const AIR_TRAIL_LAYER  = 'air-trail'
const AIR_SEL_LAYER    = 'air-selected-highlight'

export const AIR_CLICKABLE_LAYERS = [AIR_LAYER_BASE, AIR_LAYER_LABEL]

export function ensureAirLayers(map) {
  if (map.getSource(AIR_SOURCE)) return  // already added

  // ── Aircraft point source ──────────────────────────────────────────────────
  map.addSource(AIR_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // ── Trail source ───────────────────────────────────────────────────────────
  map.addSource(AIR_TRAIL_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // ── Selection highlight source (single point for the selected aircraft) ─────
  map.addSource(AIR_SEL_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // Trail lines — drawn BELOW the dots
  map.addLayer({
    id:     AIR_TRAIL_LAYER,
    type:   'line',
    source: AIR_TRAIL_SOURCE,
    layout: {
      visibility:  'visible',
      'line-cap':  'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': [
        'case',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 3000], 'rgba(255,204,0,0.45)',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 9000], 'rgba(0,229,255,0.4)',
        'rgba(220,235,255,0.35)',
      ],
      'line-width':   1.5,
      'line-opacity': 0.7,
    },
  })

  // Aircraft dots — altitude-coded color; near-AOI emphasis via near_aoi property.
  map.addLayer({
    id:     AIR_LAYER_BASE,
    type:   'circle',
    source: AIR_SOURCE,
    layout: { visibility: 'visible' },
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'near_aoi'], 1],
        ['interpolate', ['linear'], ['zoom'], 2, 3.5, 5, 5, 8, 7.5, 12, 10],
        ['interpolate', ['linear'], ['zoom'], 2, 2, 5, 3.5, 8, 5.5, 12, 7],
      ],
      'circle-color': [
        'case',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 3000], '#ffcc00',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 9000], '#00e5ff',
        '#e8f0ff',
      ],
      'circle-opacity':      0.88,
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'near_aoi'], 1], '#ffcc00',
        'rgba(8,12,16,0.65)',
      ],
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'near_aoi'], 1], 2.5,
        0.8,
      ],
    },
  })

  // Callsign labels — zoom 6+ to avoid clutter
  map.addLayer({
    id:      AIR_LAYER_LABEL,
    type:    'symbol',
    source:  AIR_SOURCE,
    minzoom: 6,
    layout: {
      visibility:           'visible',
      'text-field':         ['coalesce', ['get', 'callsign'], ['get', 'icao24']],
      'text-font':          ['Open Sans Regular'],
      'text-size':          10,
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

  // Selection highlight — large glowing dot on top of everything
  map.addLayer({
    id:     AIR_SEL_LAYER,
    type:   'circle',
    source: AIR_SEL_SOURCE,
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

export function removeAirLayers(map) {
  [AIR_SEL_LAYER, AIR_LAYER_LABEL, AIR_LAYER_BASE, AIR_TRAIL_LAYER].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  ;[AIR_SEL_SOURCE, AIR_SOURCE, AIR_TRAIL_SOURCE].forEach((id) => {
    if (map.getSource(id)) map.removeSource(id)
  })
}

export function setAirData(map, aircraft, nearIcaos) {
  const src = map.getSource(AIR_SOURCE)
  if (!src) return
  const nearSet = nearIcaos instanceof Set ? nearIcaos : new Set()
  const features = (aircraft || []).map((ac) => ({
    type:     'Feature',
    geometry: { type: 'Point', coordinates: [ac.lng, ac.lat] },
    properties: {
      icao24:   ac.icao24,
      callsign: ac.callsign || ac.icao24,
      alt_m:    ac.alt_m,
      speed_ms: ac.speed_ms,
      heading:  ac.heading,
      country:  ac.country,
      near_aoi: nearSet.has(ac.icao24) ? 1 : 0,
    },
  }))
  src.setData({ type: 'FeatureCollection', features })
}

/**
 * setAirTrails — render short history lines.
 * trails: { icao24: [[lng, lat], ...] } — ordered oldest→newest
 * aircraft: current aircraft array (for alt lookup for color coding)
 */
export function setAirTrails(map, trails, aircraft) {
  const src = map.getSource(AIR_TRAIL_SOURCE)
  if (!src) return

  // Build altitude lookup for color
  const altLookup = {}
  ;(aircraft || []).forEach((ac) => { altLookup[ac.icao24] = ac.alt_m })

  const features = Object.entries(trails || {})
    .filter(([, pts]) => pts && pts.length >= 2)
    .map(([icao24, pts]) => ({
      type:     'Feature',
      geometry: { type: 'LineString', coordinates: pts },
      properties: { icao24, alt_m: altLookup[icao24] ?? null },
    }))

  src.setData({ type: 'FeatureCollection', features })
}

export function setSelectedHighlight(map, ac) {
  const src = map.getSource(AIR_SEL_SOURCE)
  if (!src) return
  if (!ac || !ac.lat || !ac.lng) {
    if (map.getLayer(AIR_SEL_LAYER)) map.setLayoutProperty(AIR_SEL_LAYER, 'visibility', 'none')
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ac.lng, ac.lat] },
      properties: {},
    }],
  })
  if (map.getLayer(AIR_SEL_LAYER)) map.setLayoutProperty(AIR_SEL_LAYER, 'visibility', 'visible')
}

export function setAirVisibility(map, visible) {
  const v = visible ? 'visible' : 'none'
  ;[AIR_LAYER_BASE, AIR_LAYER_LABEL, AIR_TRAIL_LAYER].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export function setTrailVisibility(map, visible) {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer(AIR_TRAIL_LAYER)) map.setLayoutProperty(AIR_TRAIL_LAYER, 'visibility', v)
}