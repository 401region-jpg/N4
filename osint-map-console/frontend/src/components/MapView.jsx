import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS } from '../hooks/basemaps.js'
import styles from '../styles/MapView.module.css'

const DEFAULT_CENTER = [0, 20]
const DEFAULT_ZOOM   = 2.5

export default function MapView({
  basemap,
  markers,
  markersVisible,
  selectedMarker,
  onMapClick,
  onMarkerClick,
  flyTo,
  onFlyToDone,
  onFitAll,          // receives fitAll trigger from App
  fitAllTrigger,
}) {
  const containerRef    = useRef(null)
  const mapRef          = useRef(null)
  const mlMarkersRef    = useRef({})   // id -> maplibregl.Marker instance

  // All "live" data kept in refs so event handlers never go stale
  const markersRef      = useRef(markers)
  const visibleRef      = useRef(markersVisible)
  const selectedIdRef   = useRef(selectedMarker?.id ?? null)
  const onMapClickRef   = useRef(onMapClick)
  const onMarkerClickRef = useRef(onMarkerClick)
  const basemapRef      = useRef(basemap)

  // Sync refs on every render (no re-subscription needed)
  markersRef.current       = markers
  visibleRef.current       = markersVisible
  selectedIdRef.current    = selectedMarker?.id ?? null
  onMapClickRef.current    = onMapClick
  onMarkerClickRef.current = onMarkerClick
  basemapRef.current       = basemap

  // ── Cursor coords display ─────────────────────────────────────────────────
  const coordsRef = useRef(null)

  // ── Core helper: remove all DOM markers ──────────────────────────────────
  function clearMarkers() {
    Object.values(mlMarkersRef.current).forEach((mk) => mk.remove())
    mlMarkersRef.current = {}
  }

  // ── Core helper: add all markers from current refs ────────────────────────
  function drawMarkers(map) {
    clearMarkers()
    if (!visibleRef.current) return

    markersRef.current.forEach((m) => {
      const isSelected = m.id === selectedIdRef.current
      const c = m.color || '#00ff88'

      const el = document.createElement('div')
      el.style.cssText = [
        'width:14px', 'height:14px',
        `background:${c}`,
        'border:2px solid rgba(255,255,255,0.8)',
        'border-radius:50%',
        'cursor:pointer',
        `box-shadow:0 0 8px ${c},0 0 20px ${c}55`,
        'transition:transform 0.15s',
        `transform:scale(${isSelected ? 1.6 : 1})`,
        `z-index:${isSelected ? 10 : 1}`,
      ].join(';')

      if (isSelected) el.dataset.sel = '1'

      el.addEventListener('mouseenter', () => {
        if (el.dataset.sel !== '1') el.style.transform = 'scale(1.4)'
      })
      el.addEventListener('mouseleave', () => {
        if (el.dataset.sel !== '1') el.style.transform = 'scale(1)'
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onMarkerClickRef.current(m)
      })

      const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([m.lng, m.lat])
        .addTo(map)

      mlMarkersRef.current[m.id] = mk
    })
  }

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     BASEMAPS[basemapRef.current].style,
      center:    DEFAULT_CENTER,
      zoom:      DEFAULT_ZOOM,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('click', (e) => {
      onMapClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    // Cursor coordinates
    map.on('mousemove', (e) => {
      if (coordsRef.current) {
        coordsRef.current.textContent =
          `${e.lngLat.lat.toFixed(5)},  ${e.lngLat.lng.toFixed(5)}`
      }
    })
    map.on('mouseleave', () => {
      if (coordsRef.current) coordsRef.current.textContent = ''
    })

    // Draw markers once initial style loads
    map.once('load', () => drawMarkers(map))

    mapRef.current = map
    return () => {
      clearMarkers()
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Basemap switching ─────────────────────────────────────────────────────
  // Key insight: use map.once('style.load') — fires exactly once after the new
  // style is fully ready. Never use 'styledata' for this: it fires multiple
  // times including mid-transition, causing races and duplicate listeners.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove DOM markers immediately so they don't float over the wrong tiles
    clearMarkers()

    const onStyleLoad = () => {
      drawMarkers(map)
    }

    map.once('style.load', onStyleLoad)
    map.setStyle(BASEMAPS[basemap].style)

    // If setStyle throws or style.load never fires (edge case), clean up
    return () => {
      map.off('style.load', onStyleLoad)
    }
  }, [basemap]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-draw when markers / visibility / selection changes ─────────────────
  // Runs after every relevant prop change. By the time this runs, refs are
  // already updated above, so drawMarkers() reads current data.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Only draw if style is ready; basemap effect will draw after style.load
    if (!map.isStyleLoaded()) return
    drawMarkers(map)
  }) // intentionally no dep array — runs after every render, cheap and correct
     // because drawMarkers() is O(n) DOM ops and n is small

  // ── FlyTo ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || !mapRef.current) return
    mapRef.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom:   flyTo.zoom || 13,
      speed:  1.4,
      curve:  1.4,
    })
    onFlyToDone()
  }, [flyTo, onFlyToDone])

  // ── Fit all markers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!fitAllTrigger || !mapRef.current) return
    const pts = markersRef.current
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

  // ── Reset view ────────────────────────────────────────────────────────────
  // Exposed via data attribute on container so App can call it if needed.
  // Simpler: we pass onResetView via ref from App — here we just use flyTo.

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} />
      <div ref={coordsRef} className={styles.coords} />
      <div className={styles.hint}>◈ CLICK MAP TO PLACE MARKER</div>
    </div>
  )
}
