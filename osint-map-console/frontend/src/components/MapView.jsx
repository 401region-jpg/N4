import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS } from '../hooks/basemaps.js'
import styles from '../styles/MapView.module.css'

export default function MapView({
  basemap,
  markers,
  markersVisible,
  selectedMarker,
  onMapClick,
  onMarkerClick,
  flyTo,
  onFlyToDone,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({})       // id -> maplibregl.Marker
  const markersDataRef = useRef([])   // latest markers array
  const selectedIdRef = useRef(null)
  const markersVisibleRef = useRef(markersVisible)
  const onMarkerClickRef = useRef(onMarkerClick)

  // Keep refs in sync without re-running effects
  useEffect(() => { onMarkerClickRef.current = onMarkerClick }, [onMarkerClick])
  useEffect(() => { markersVisibleRef.current = markersVisible }, [markersVisible])

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAPS[basemap].style,
      center: [0, 20],
      zoom: 2.5,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('click', (e) => {
      onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Helper: create one DOM marker ─────────────────────────────────────────
  const buildMarkerEl = useCallback((m, isSelected) => {
    const el = document.createElement('div')
    el.className = 'osint-marker'
    const c = m.color || '#00ff88'
    el.style.cssText = `
      width: 14px; height: 14px;
      background: ${c};
      border: 2px solid rgba(255,255,255,0.8);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 8px ${c}, 0 0 20px ${c}55;
      transition: transform 0.15s;
      transform: ${isSelected ? 'scale(1.6)' : 'scale(1)'};
      z-index: ${isSelected ? 10 : 1};
    `
    el.addEventListener('mouseenter', () => { if (!isSelected) el.style.transform = 'scale(1.4)' })
    el.addEventListener('mouseleave', () => { if (el.dataset.selected !== '1') el.style.transform = 'scale(1)' })
    el.addEventListener('click', (e) => { e.stopPropagation(); onMarkerClickRef.current(m) })
    if (isSelected) el.dataset.selected = '1'
    return el
  }, [])

  // ── Helper: render all markers from markersDataRef ────────────────────────
  const renderMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old
    Object.values(markersRef.current).forEach((mk) => mk.remove())
    markersRef.current = {}

    if (!markersVisibleRef.current) return

    markersDataRef.current.forEach((m) => {
      const isSelected = m.id === selectedIdRef.current
      const el = buildMarkerEl(m, isSelected)
      const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([m.lng, m.lat])
        .addTo(map)
      markersRef.current[m.id] = mk
    })
  }, [buildMarkerEl])

  // ── Basemap switching ──────────────────────────────────────────────────────
  // Strategy: call setStyle, then on 'styledata' re-render markers.
  // We use a flag to avoid multiple re-renders from repeated styledata events.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let styleReady = false

    const onStyleData = () => {
      if (styleReady) return
      // styledata fires multiple times; wait until style is actually loaded
      if (!map.isStyleLoaded()) return
      styleReady = true
      renderMarkers()
    }

    map.on('styledata', onStyleData)

    // setStyle triggers styledata
    try {
      map.setStyle(BASEMAPS[basemap].style)
    } catch (e) {
      console.warn('setStyle error', e)
    }

    return () => map.off('styledata', onStyleData)
  }, [basemap]) // eslint-disable-line

  // ── Markers data / visibility changes ─────────────────────────────────────
  useEffect(() => {
    markersDataRef.current = markers
    selectedIdRef.current = selectedMarker?.id ?? null
    const map = mapRef.current
    if (map && map.isStyleLoaded()) renderMarkers()
  }, [markers, selectedMarker, markersVisible, renderMarkers])

  // ── FlyTo ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || !mapRef.current) return
    mapRef.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom || 13,
      speed: 1.4,
      curve: 1.4,
    })
    onFlyToDone()
  }, [flyTo, onFlyToDone])

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} />
      <div className={styles.hint}>
        <span>◈ CLICK MAP TO PLACE MARKER</span>
      </div>
    </div>
  )
}
