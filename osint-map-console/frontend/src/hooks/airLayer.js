// Stage 5 — Aircraft layer management for MapLibre
// Renders aircraft as a GeoJSON SymbolLayer (chevron icon built from text glyph)
// Falls back to circle layer if symbol fonts unavailable.
// No trail in MVP — just current position + heading indicator.

const AIR_SOURCE = 'src-air'
const AIR_LAYER_BASE   = 'air-base'    // circle base (always visible)
const AIR_LAYER_LABEL  = 'air-label'   // callsign label

export function ensureAirLayers(map) {
  if (map.getSource(AIR_SOURCE)) return  // already added

  map.addSource(AIR_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  // Base dot — colored by altitude band
  map.addLayer({
    id:     AIR_LAYER_BASE,
    type:   'circle',
    source: AIR_SOURCE,
    layout: { visibility: 'visible' },
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        2, 2, 5, 3.5, 8, 5, 12, 6,
      ],
      // Color by altitude: low=yellow, mid=cyan, high=white
      'circle-color': [
        'case',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 3000], '#ffcc00',
        ['<', ['coalesce', ['get', 'alt_m'], 0], 9000], '#00e5ff',
        '#ffffff',
      ],
      'circle-opacity': 0.85,
      'circle-stroke-color': 'rgba(8,12,16,0.7)',
      'circle-stroke-width': 0.8,
    },
  })

  // Callsign label — only shown at zoom >= 6 to avoid clutter
  map.addLayer({
    id:      AIR_LAYER_LABEL,
    type:    'symbol',
    source:  AIR_SOURCE,
    minzoom: 6,
    layout: {
      visibility: 'visible',
      'text-field': ['coalesce', ['get', 'callsign'], ['get', 'icao24']],
      'text-font':  ['Open Sans Regular'],
      'text-size':  10,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#c8dae8',
      'text-halo-color': 'rgba(8,12,16,0.9)',
      'text-halo-width': 1.5,
    },
  })
}

export function removeAirLayers(map) {
  [AIR_LAYER_LABEL, AIR_LAYER_BASE].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  if (map.getSource(AIR_SOURCE)) map.removeSource(AIR_SOURCE)
}

export function setAirData(map, aircraft) {
  const src = map.getSource(AIR_SOURCE)
  if (!src) return
  const features = (aircraft || []).map((ac) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [ac.lng, ac.lat] },
    properties: {
      icao24:   ac.icao24,
      callsign: ac.callsign || ac.icao24,
      alt_m:    ac.alt_m,
      speed_ms: ac.speed_ms,
      heading:  ac.heading,
      country:  ac.country,
    },
  }))
  src.setData({ type: 'FeatureCollection', features })
}

export function setAirVisibility(map, visible) {
  const v = visible ? 'visible' : 'none'
  ;[AIR_LAYER_BASE, AIR_LAYER_LABEL].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export const AIR_CLICKABLE_LAYERS = [AIR_LAYER_BASE]
