// All basemaps use free/open tile sources — no API keys required.
// Satellite: ESRI World Imagery (public, no key needed for reasonable use)
// Street:    OpenFreeMap (based on OpenStreetMap, free for all use)
// Hybrid:    ESRI satellite + OpenStreetMap road labels overlay

export const BASEMAPS = {
  street: {
    id: 'street',
    label: 'STREET',
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm-tiles',
          paint: {
            'raster-opacity': 1,
            'raster-brightness-min': 0,
            'raster-brightness-max': 0.6,
            'raster-saturation': -0.3,
            'raster-contrast': 0.1,
          },
        },
      ],
    },
  },

  satellite: {
    id: 'satellite',
    label: 'SATELLITE',
    style: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'esri-satellite-layer',
          type: 'raster',
          source: 'esri-satellite',
          paint: {
            'raster-opacity': 1,
          },
        },
      ],
    },
  },

  hybrid: {
    id: 'hybrid',
    label: 'HYBRID',
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles © Esri | © OpenStreetMap contributors',
          maxzoom: 19,
        },
        'osm-labels': {
          type: 'raster',
          tiles: [
            'https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          maxzoom: 20,
        },
      },
      layers: [
        {
          id: 'satellite-base',
          type: 'raster',
          source: 'esri-satellite',
          paint: { 'raster-opacity': 1 },
        },
        {
          id: 'osm-labels-layer',
          type: 'raster',
          source: 'osm-labels',
          paint: { 'raster-opacity': 0.7 },
        },
      ],
    },
  },
}

export const DEFAULT_BASEMAP = 'street'
