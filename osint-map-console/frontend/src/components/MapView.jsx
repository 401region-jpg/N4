import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  buildInitialStyle,
  BASEMAP_VISIBILITY,
  DEFAULT_BASEMAP,
} from '../hooks/basemaps.js'
import styles from '../styles/MapView.module.css'

const DEFAULT_CENTER = [0, 20]
const DEFAULT_ZOOM   = 2.5

// Layer IDs that belong to overlays (not basemap), used for toggle
export const OVERLAY_LAYER_GROUPS = {
  countries: ['ov-countries-fill', 'ov-countries-line', 'ov-country-labels'],
}

// ── Basemap switch: only setPaintProperty on opacity, no setStyle() ──────────
function applyBasemap(map, basemapId) {
  const vis = BASEMAP_VISIBILITY[basemapId]
  if (!vis) return
  Object.entries(vis).forEach(([layerId, opacity]) => {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'raster-opacity', opacity)
    }
  })
}

// ── Toggle overlay layer group visibility ────────────────────────────────────
function applyOverlayVisibility(map, layerIds, visible) {
  const v = visible ? 'visible' : 'none'
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })
}

export default function MapView({
  basemap,
  markers,
  markersVisible,
  selectedMarker,
  overlayVisibility,   // { countries: bool, ... }
  onMapClick,
  onMarkerClick,
  flyTo,
  onFlyToDone,
  fitAllTrigger,
  searchPin,           // { lat, lng } | null — temporary, not saved
}) {
  const containerRef     = useRef(null)
  const mapRef           = useRef(null)
  const mlMarkersRef     = useRef({})
  const searchPinRef     = useRef(null)  // maplibregl.Marker for search result
  const coordsRef        = useRef(null)

  // Live refs — synced every render, no stale closures
  const markersDataRef   = useRef(markers)
  const visibleRef       = useRef(markersVisible)
  const selectedIdRef    = useRef(selectedMarker?.id ?? null)
  const onMapClickRef    = useRef(onMapClick)
  const onMarkerClickRef = useRef(onMarkerClick)

  markersDataRef.current   = markers
  visibleRef.current       = markersVisible
  selectedIdRef.current    = selectedMarker?.id ?? null
  onMapClickRef.current    = onMapClick
  onMarkerClickRef.current = onMarkerClick

  // ── DOM marker helpers ────────────────────────────────────────────────────
  function clearMarkers() {
    Object.values(mlMarkersRef.current).forEach((mk) => mk.remove())
    mlMarkersRef.current = {}
  }

  function drawMarkers(map) {
    clearMarkers()
    if (!visibleRef.current) return
    markersDataRef.current.forEach((m) => {
      const isSelected = m.id === selectedIdRef.current
      const c = m.color || '#00ff88'
      const el = document.createElement('div')
      el.style.cssText = [
        'width:14px', 'height:14px',
        `background:${c}`,
        'border:2px solid rgba(255,255,255,0.85)',
        'border-radius:50%',
        'cursor:pointer',
        `box-shadow:0 0 8px ${c},0 0 24px ${c}66`,
        'transition:transform 0.15s,box-shadow 0.15s',
        `transform:scale(${isSelected ? 1.7 : 1})`,
        `z-index:${isSelected ? 10 : 1}`,
        isSelected ? `box-shadow:0 0 0 3px rgba(255,255,255,0.6),0 0 16px ${c}` : '',
      ].join(';')
      if (isSelected) el.dataset.sel = '1'
      el.addEventListener('mouseenter', () => {
        if (!el.dataset.sel) el.style.transform = 'scale(1.45)'
      })
      el.addEventListener('mouseleave', () => {
        if (!el.dataset.sel) el.style.transform = 'scale(1)'
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onMarkerClickRef.current(m)
      })
      mlMarkersRef.current[m.id] = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([m.lng, m.lat])
        .addTo(map)
    })
  }

  // ── Init map — one time, permanent style ──────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     buildInitialStyle(DEFAULT_BASEMAP),
      center:    DEFAULT_CENTER,
      zoom:      DEFAULT_ZOOM,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('click', (e) => onMapClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }))

    map.on('mousemove', (e) => {
      if (coordsRef.current) {
        coordsRef.current.textContent =
          `${e.lngLat.lat.toFixed(5)}   ${e.lngLat.lng.toFixed(5)}`
      }
    })
    map.on('mouseleave', () => {
      if (coordsRef.current) coordsRef.current.textContent = ''
    })

    map.once('load', () => drawMarkers(map))

    mapRef.current = map
    return () => {
      clearMarkers()
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Basemap switching — NO setStyle(), just opacity ───────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    applyBasemap(map, basemap)
  }, [basemap])

  // Also apply after initial load (handles the case where effect runs before load)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => applyBasemap(map, basemap)
    if (map.isStyleLoaded()) { apply(); return }
    map.once('load', apply)
    return () => map.off('load', apply)
  }, []) // eslint-disable-line

  // ── Overlay visibility ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    if (!overlayVisibility) return
    Object.entries(OVERLAY_LAYER_GROUPS).forEach(([key, layerIds]) => {
      if (key in overlayVisibility) {
        applyOverlayVisibility(map, layerIds, overlayVisibility[key])
      }
    })
  }, [overlayVisibility])

  // ── Re-draw markers after every render (cheap, safe) ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    drawMarkers(map)
  })

  // ── Search pin (temporary, not saved) ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Remove old
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null }
    if (!searchPin) return

    const el = document.createElement('div')
    el.style.cssText = [
      'width:18px', 'height:18px',
      'background:rgba(255,204,0,0.15)',
      'border:2px solid #ffcc00',
      'border-radius:50%',
      'box-shadow:0 0 10px #ffcc00,0 0 28px #ffcc0055',
      'pointer-events:none',
    ].join(';')

    // Pulse ring
    const ring = document.createElement('div')
    ring.style.cssText = [
      'position:absolute', 'inset:-6px',
      'border:1px solid rgba(255,204,0,0.4)',
      'border-radius:50%',
      'animation:osint-pulse 1.8s ease-out infinite',
    ].join(';')
    el.appendChild(ring)

    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:relative;width:18px;height:18px;'
    wrapper.appendChild(el)

    searchPinRef.current = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
      .setLngLat([searchPin.lng, searchPin.lat])
      .addTo(map)
  }, [searchPin])

  // ── FlyTo ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom || 13, speed: 1.4, curve: 1.4 })
    onFlyToDone()
  }, [flyTo, onFlyToDone])

  // ── Fit all ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fitAllTrigger || !mapRef.current) return
    const pts = markersDataRef.current
    if (!pts.length) return
    if (pts.length === 1) {
      mapRef.current.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 12 })
      return
    }
    const bounds = pts.reduce(
      (b, m) => b.extend([m.lng, m.lat]),
      new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat])
    )
    mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 14 })
  }, [fitAllTrigger])

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} />
      <div ref={coordsRef} className={styles.coords} />
      <div className={styles.hint}>◈ CLICK MAP TO PLACE MARKER</div>
      <style>{`
        @keyframes osint-pulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
