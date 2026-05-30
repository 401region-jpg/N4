// AOI rendering + drawing (Stage 2) — native MapLibre, no extra deps.
//
// Rendering: one geojson source `aoi-src` feeds fill (polygons), line
// (polygons + routes) and circle (points) layers. Selected feature is
// highlighted via a feature-state-independent paint match on `sel`.
//
// Drawing: a lightweight controller drives polygon / route / circle modes
// using map clicks. A separate `aoi-draft-src` shows the in-progress shape.

import { haversineMeters, formatDistance } from './gridLayer.js'

export const AOI_SOURCE   = 'aoi-src'
export const DRAFT_SOURCE  = 'aoi-draft-src'

const AOI_LAYERS = ['aoi-fill', 'aoi-line', 'aoi-point']

// ── Geometry helpers ─────────────────────────────────────────────────────────

// Polygon ring area in m² via spherical excess approximation (good enough for AOI).
export function ringAreaMeters(coords) {
  if (!coords || coords.length < 3) return 0
  const R = 6378137
  let total = 0
  for (let i = 0; i < coords.length; i++) {
    const [lng1, lat1] = coords[i]
    const [lng2, lat2] = coords[(i + 1) % coords.length]
    total += (lng2 - lng1) * Math.PI / 180 *
      (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180))
  }
  return Math.abs(total * R * R / 2)
}

export function formatArea(m2) {
  if (m2 < 10000) return `${Math.round(m2)} m²`
  if (m2 < 1e6)   return `${(m2 / 1e6).toFixed(3)} km²`
  if (m2 < 1e8)   return `${(m2 / 1e6).toFixed(2)} km²`
  return `${(m2 / 1e6).toFixed(0)} km²`
}

export function lineLengthMeters(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(
      { lat: coords[i - 1][1], lng: coords[i - 1][0] },
      { lat: coords[i][1],     lng: coords[i][0] },
    )
  }
  return total
}

// Approximate a circle (center + radius in meters) as a 64-gon polygon.
export function circleToPolygon(center, radiusMeters, steps = 64) {
  const [lng, lat] = center
  const coords = []
  const latR = radiusMeters / 111320
  const lngR = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    coords.push([lng + lngR * Math.cos(a), lat + latR * Math.sin(a)])
  }
  return { type: 'Polygon', coordinates: [coords] }
}

// ── AOI feature collection from rows ─────────────────────────────────────────
function toFeatureCollection(aois, selectedId) {
  return {
    type: 'FeatureCollection',
    features: (aois || []).map((a) => ({
      type: 'Feature',
      id: a.id,
      geometry: a.geometry,
      properties: {
        id: a.id,
        kind: a.kind,
        title: a.title,
        color: a.color || '#00e5ff',
        sel: a.id === selectedId ? 1 : 0,
      },
    })),
  }
}

export function ensureAoiLayers(map) {
  if (!map.getSource(AOI_SOURCE)) {
    map.addSource(AOI_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getSource(DRAFT_SOURCE)) {
    map.addSource(DRAFT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }

  if (!map.getLayer('aoi-fill')) {
    map.addLayer({
      id: 'aoi-fill', type: 'fill', source: AOI_SOURCE,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#00e5ff'],
        'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.22, 0.1],
      },
    })
  }
  if (!map.getLayer('aoi-line')) {
    map.addLayer({
      id: 'aoi-line', type: 'line', source: AOI_SOURCE,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#00e5ff'],
        'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 1.6],
        'line-opacity': 0.9,
      },
    })
  }
  if (!map.getLayer('aoi-point')) {
    map.addLayer({
      id: 'aoi-point', type: 'circle', source: AOI_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'sel'], 1], 7, 5],
        'circle-color': ['coalesce', ['get', 'color'], '#00e5ff'],
        'circle-stroke-color': 'rgba(255,255,255,0.85)',
        'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 2.5, 1.2],
      },
    })
  }

  // Draft layers (in-progress shape)
  if (!map.getLayer('aoi-draft-fill')) {
    map.addLayer({
      id: 'aoi-draft-fill', type: 'fill', source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#ffcc00', 'fill-opacity': 0.12 },
    })
  }
  if (!map.getLayer('aoi-draft-line')) {
    map.addLayer({
      id: 'aoi-draft-line', type: 'line', source: DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffcc00', 'line-width': 1.8, 'line-dasharray': [2, 1.5] },
    })
  }
  if (!map.getLayer('aoi-draft-vertex')) {
    map.addLayer({
      id: 'aoi-draft-vertex', type: 'circle', source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 4, 'circle-color': '#ffcc00',
        'circle-stroke-color': '#0d1218', 'circle-stroke-width': 1.5,
      },
    })
  }
}

export function setAoiData(map, aois, selectedId) {
  const src = map.getSource(AOI_SOURCE)
  if (src) src.setData(toFeatureCollection(aois, selectedId))
}

export function clearDraft(map) {
  const src = map.getSource(DRAFT_SOURCE)
  if (src) src.setData({ type: 'FeatureCollection', features: [] })
}

export function removeAoiLayers(map) {
  AOI_LAYERS.concat(['aoi-draft-fill', 'aoi-draft-line', 'aoi-draft-vertex']).forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  if (map.getSource(AOI_SOURCE)) map.removeSource(AOI_SOURCE)
  if (map.getSource(DRAFT_SOURCE)) map.removeSource(DRAFT_SOURCE)
}
