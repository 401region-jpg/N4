// v1.3: единый постоянный style, basemap switching = opacity toggle на raster слоях.
// setStyle() больше не вызывается после init — нет style.load гонок.
//
// Tile sources (все без ключей):
//   Street:    OpenStreetMap (tile.openstreetmap.org)
//   Satellite: ESRI World Imagery (arcgisonline.com)
//   Hybrid:    ESRI Satellite + Stadia Toner Lines
//   Overlays:  Natural Earth via публичный Martin tile server (границы/города)

export const BASEMAP_IDS = ['street', 'satellite', 'hybrid']
export const DEFAULT_BASEMAP = 'street'

// Какие raster слои видны при каждом basemap
export const BASEMAP_VISIBILITY = {
  street:    { 'bl-street': 1,    'bl-satellite': 0,    'bl-hybrid-lines': 0 },
  satellite: { 'bl-street': 0,    'bl-satellite': 1,    'bl-hybrid-lines': 0 },
  hybrid:    { 'bl-street': 0,    'bl-satellite': 1,    'bl-hybrid-lines': 0.75 },
}

export const BASEMAP_LABELS = {
  street:    'STREET',
  satellite: 'SATELLITE',
  hybrid:    'HYBRID',
}

// Единый MapLibre style — все sources/layers прописаны сразу.
// Overlay vector layers (границы, города) добавляются поверх basemap raster.
export function buildInitialStyle(basemap = DEFAULT_BASEMAP) {
  const vis = BASEMAP_VISIBILITY[basemap]
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sprite: '',
    sources: {
      // ── Basemap rasters ─────────────────────────────────────────────────
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
        attribution: 'Tiles © Esri',
        maxzoom: 19,
      },
      'src-hybrid-lines': {
        type: 'raster',
        tiles: ['https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 20,
      },
      // ── Overlay: Natural Earth boundaries + cities via public PMTiles ──
      // Используем публичный GeoJSON endpoint через бесплатный tiles.arcgis.com
      // Это надёжнее кастомных Martin серверов которые могут быть недоступны
      'src-countries': {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
      },
    },
    layers: [
      // ── Basemap layers ──────────────────────────────────────────────────
      {
        id: 'bl-street',
        type: 'raster',
        source: 'src-street',
        paint: {
          'raster-opacity': vis['bl-street'],
          'raster-brightness-max': 0.65,
          'raster-saturation': -0.25,
          'raster-contrast': 0.05,
        },
      },
      {
        id: 'bl-satellite',
        type: 'raster',
        source: 'src-satellite',
        paint: { 'raster-opacity': vis['bl-satellite'] },
      },
      {
        id: 'bl-hybrid-lines',
        type: 'raster',
        source: 'src-hybrid-lines',
        paint: { 'raster-opacity': vis['bl-hybrid-lines'] },
      },
      // ── Overlay: country borders ────────────────────────────────────────
      {
        id: 'ov-countries-fill',
        type: 'fill',
        source: 'src-countries',
        paint: {
          'fill-color': 'rgba(0,229,255,0.03)',
          'fill-outline-color': 'rgba(0,0,0,0)',
        },
        layout: { visibility: 'visible' },
      },
      {
        id: 'ov-countries-line',
        type: 'line',
        source: 'src-countries',
        paint: {
          'line-color': 'rgba(0,229,255,0.55)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 4, 0.8, 8, 1.2],
          'line-dasharray': [3, 2],
        },
        layout: { visibility: 'visible' },
      },
      // ── Overlay: country labels ─────────────────────────────────────────
      {
        id: 'ov-country-labels',
        type: 'symbol',
        source: 'src-countries',
        minzoom: 2,
        maxzoom: 7,
        layout: {
          visibility: 'visible',
          'text-field': ['get', 'ADMIN'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 5, 11],
          'text-max-width': 8,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': 'rgba(180,210,230,0.85)',
          'text-halo-color': 'rgba(5,10,16,0.9)',
          'text-halo-width': 1.5,
        },
      },
    ],
  }
}
