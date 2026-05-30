import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  buildInitialStyle,
  applyBasemap,
  applyOverlay,
  OVERLAY_GROUPS,
  DEFAULT_BASEMAP,
} from '../hooks/basemaps.js'
import { attachGridCanvas, haversineMeters, formatDistance } from '../hooks/gridLayer.js'
import styles from '../styles/MapView.module.css'

const DEFAULT_CENTER = [0, 20]
const DEFAULT_ZOOM   = 2.5

// Converts decimal to DMS string
function toDMSStr(deg, isLat) {
  const abs = Math.abs(deg)
  const d   = Math.floor(abs)
  const mAll = (abs - d) * 60
  const m   = Math.floor(mAll)
  const s   = ((mAll - m) * 60).toFixed(1)
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')
  return `${d}°${m}'${s}"${dir}`
}

export default function MapView({
  basemap,
  markers,
  markersVisible,
  selectedMarker,
  overlayVisibility,
  onMapClick,
  onMarkerClick,
  flyTo,
  onFlyToDone,
  fitAllTrigger,
  searchPin,
  measureActive,        // bool — measure mode on/off
  onMeasureResult,      // (distanceStr | null) => void
  coordFormat,          // 'decimal' | 'dms'
}) {
  const containerRef   = useRef(null)
  const gridCanvasRef  = useRef(null)
  const mapRef         = useRef(null)
  const mlMarkersRef   = useRef({})
  const searchPinRef   = useRef(null)
  const gridCleanupRef = useRef(null)
  const coordsRef      = useRef(null)
  const zoomRef        = useRef(null)

  // Measure state (lives in refs to avoid re-render on every mousemove)
  const measureRef = useRef({ active: false, pointA: null, line: null, popup: null })

  // Live refs
  const markersDataRef    = useRef(markers)
  const visibleRef        = useRef(markersVisible)
  const selectedIdRef     = useRef(selectedMarker?.id ?? null)
  const onMapClickRef     = useRef(onMapClick)
  const onMarkerClickRef  = useRef(onMarkerClick)
  const overlayRef        = useRef(overlayVisibility)
  const coordFmtRef       = useRef(coordFormat || 'decimal')
  const gridVisRef        = useRef(overlayVisibility?.grid ?? false)
  const measureActiveRef  = useRef(measureActive)
  const onMeasureResultRef = useRef(onMeasureResult)

  // Sync all refs every render
  markersDataRef.current    = markers
  visibleRef.current        = markersVisible
  selectedIdRef.current     = selectedMarker?.id ?? null
  onMapClickRef.current     = onMapClick
  onMarkerClickRef.current  = onMarkerClick
  overlayRef.current        = overlayVisibility
  coordFmtRef.current       = coordFormat || 'decimal'
  gridVisRef.current        = overlayVisibility?.grid ?? false
  measureActiveRef.current  = measureActive
  onMeasureResultRef.current = onMeasureResult

  // ── Marker helpers ────────────────────────────────────────────────────────
  function clearMarkers() {
    Object.values(mlMarkersRef.current).forEach((mk) => mk.remove())
    mlMarkersRef.current = {}
  }

  function drawMarkers(map) {
    clearMarkers()
    if (!visibleRef.current) return
    markersDataRef.current.forEach((m) => {
      const isSel = m.id === selectedIdRef.current
      const c     = m.color || '#00ff88'
      const size  = isSel ? 18 : 14
      const el    = document.createElement('div')
      el.style.cssText = [
        `width:${size}px`, `height:${size}px`,
        `background:${c}`,
        `border:${isSel ? '2.5px solid rgba(255,255,255,0.95)' : '2px solid rgba(255,255,255,0.75)'}`,
        'border-radius:50%',
        'cursor:pointer',
        `box-shadow:${isSel
          ? `0 0 0 4px rgba(255,255,255,0.25),0 0 14px ${c},0 0 32px ${c}88`
          : `0 0 8px ${c}aa,0 0 20px ${c}44`}`,
        'transition:transform 0.12s',
        `transform:scale(${isSel ? 1 : 1})`,
        `z-index:${isSel ? 20 : 5}`,
        'position:relative',
      ].join(';')

      if (isSel) {
        // Outer ring
        const ring = document.createElement('div')
        ring.style.cssText = [
          'position:absolute',
          'inset:-5px',
          `border:1.5px solid ${c}`,
          'border-radius:50%',
          'opacity:0.5',
          'pointer-events:none',
          'animation:osint-ring-pulse 2s ease-out infinite',
        ].join(';')
        el.appendChild(ring)
        el.dataset.sel = '1'
      }

      el.addEventListener('mouseenter', () => {
        if (!el.dataset.sel) el.style.transform = 'scale(1.4)'
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

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     buildInitialStyle(DEFAULT_BASEMAP),
      center:    DEFAULT_CENTER,
      zoom:      DEFAULT_ZOOM,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    // Coords display + zoom display
    map.on('mousemove', (e) => {
      if (!coordsRef.current) return
      const { lat, lng } = e.lngLat
      if (coordFmtRef.current === 'dms') {
        coordsRef.current.textContent = `${toDMSStr(lat, true)}  ${toDMSStr(lng, false)}`
      } else {
        coordsRef.current.textContent = `${lat.toFixed(5)}  ${lng.toFixed(5)}`
      }
    })
    map.on('mouseleave', () => {
      if (coordsRef.current) coordsRef.current.textContent = ''
    })

    map.on('zoom', () => {
      if (zoomRef.current) {
        zoomRef.current.textContent = `Z${map.getZoom().toFixed(1)}`
      }
    })

    // Map click: measure or place marker
    map.on('click', (e) => {
      const { lat, lng } = e.lngLat

      if (measureActiveRef.current) {
        const ms = measureRef.current
        if (!ms.pointA) {
          // First point
          ms.pointA = { lat, lng }
          // Small dot marker
          const dotEl = document.createElement('div')
          dotEl.style.cssText = 'width:8px;height:8px;background:#ffcc00;border:1px solid #fff;border-radius:50%;'
          ms.dotMarker = new maplibregl.Marker({ element: dotEl, anchor: 'center' })
            .setLngLat([lng, lat]).addTo(map)
        } else {
          // Second point → measure
          const dist = haversineMeters(ms.pointA, { lat, lng })
          const dStr = formatDistance(dist)

          // Draw line source/layer if not exists
          if (!map.getSource('msr-src')) {
            map.addSource('msr-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } })
            map.addLayer({ id: 'msr-line', type: 'line', source: 'msr-src',
              paint: { 'line-color': '#ffcc00', 'line-width': 1.5, 'line-dasharray': [4, 3] } })
          }
          map.getSource('msr-src').setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[ms.pointA.lng, ms.pointA.lat], [lng, lat]] },
          })

          if (ms.popup) ms.popup.remove()
          ms.popup = new maplibregl.Popup({ closeButton: true, className: 'osint-popup' })
            .setLngLat([(ms.pointA.lng + lng) / 2, (ms.pointA.lat + lat) / 2])
            .setHTML(`<div style="font-family:monospace;font-size:12px;color:#ffcc00;background:#0d1218;padding:4px 8px;border:1px solid #ffcc00aa;">${dStr}</div>`)
            .addTo(map)

          onMeasureResultRef.current?.(dStr)

          // Reset for next measurement
          if (ms.dotMarker) ms.dotMarker.remove()
          ms.pointA  = null
          ms.dotMarker = null
        }
        return
      }

      onMapClickRef.current({ lat, lng })
    })

    map.once('load', () => {
      // Apply correct initial basemap (effect may have run before load)
      applyBasemap(map, DEFAULT_BASEMAP)
      // Apply initial overlay visibility
      const ov = overlayRef.current || {}
      Object.entries(OVERLAY_GROUPS).forEach(([key]) => {
        applyOverlay(map, key, ov[key] ?? (key === 'countries'))
      })
      drawMarkers(map)

      // Attach grid canvas
      if (gridCanvasRef.current) {
        gridCleanupRef.current = attachGridCanvas(
          map,
          gridCanvasRef.current,
          () => gridVisRef.current,
          () => coordFmtRef.current,
        )
      }

      // Initial zoom display
      if (zoomRef.current) zoomRef.current.textContent = `Z${map.getZoom().toFixed(1)}`
    })

    mapRef.current = map

    return () => {
      if (gridCleanupRef.current) gridCleanupRef.current()
      clearMarkers()
      if (searchPinRef.current) searchPinRef.current.remove()
      const ms = measureRef.current
      if (ms.dotMarker) ms.dotMarker.remove()
      if (ms.popup) ms.popup.remove()
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Basemap switching — visibility, immediate, no setStyle ───────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) {
      applyBasemap(map, basemap)
    } else {
      const onLoad = () => applyBasemap(map, basemap)
      map.once('load', onLoad)
      return () => map.off('load', onLoad)
    }
  }, [basemap])

  // ── Overlay visibility ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !overlayVisibility) return
    const apply = () => {
      Object.entries(overlayVisibility).forEach(([key, visible]) => {
        if (key === 'grid') return  // grid handled by canvas
        applyOverlay(map, key, visible)
      })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [overlayVisibility])

  // ── Re-draw markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    drawMarkers(map)
  })

  // ── Search pin ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null }
    if (!searchPin) return

    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:relative;width:20px;height:20px;pointer-events:none;'

    const dot = document.createElement('div')
    dot.style.cssText = [
      'width:20px', 'height:20px',
      'background:rgba(255,204,0,0.12)',
      'border:2px solid #ffcc00',
      'border-radius:50%',
      'box-shadow:0 0 12px #ffcc00,0 0 28px #ffcc0044',
    ].join(';')

    const ring = document.createElement('div')
    ring.style.cssText = [
      'position:absolute', 'inset:-7px',
      'border:1.5px solid rgba(255,204,0,0.5)',
      'border-radius:50%',
      'animation:osint-pulse 1.6s ease-out infinite',
    ].join(';')

    wrapper.appendChild(dot)
    wrapper.appendChild(ring)

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
    if (pts.length === 1) { mapRef.current.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 12 }); return }
    const bounds = pts.reduce(
      (b, m) => b.extend([m.lng, m.lat]),
      new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat])
    )
    mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 14 })
  }, [fitAllTrigger])

  // ── Measure cleanup when deactivated ─────────────────────────────────────
  useEffect(() => {
    if (!measureActive) {
      const map = mapRef.current
      const ms  = measureRef.current
      if (ms.dotMarker) { ms.dotMarker.remove(); ms.dotMarker = null }
      if (ms.popup) { ms.popup.remove(); ms.popup = null }
      ms.pointA = null
      if (map?.getLayer('msr-line')) map.removeLayer('msr-line')
      if (map?.getSource('msr-src')) map.removeSource('msr-src')
      onMeasureResultRef.current?.(null)
    }
  }, [measureActive])

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} />

      {/* Grid canvas overlay — sits exactly over map */}
      <canvas ref={gridCanvasRef} className={styles.gridCanvas} />

      {/* Crosshair */}
      <div className={styles.crosshair}>
        <div className={styles.chH} />
        <div className={styles.chV} />
        <div className={styles.chDot} />
      </div>

      {/* HUD bottom-left */}
      <div className={styles.hud}>
        <span ref={coordsRef} className={styles.coords} />
        <span ref={zoomRef}   className={styles.zoom} />
      </div>

      <div className={styles.hint}>◈ CLICK TO PLACE MARKER</div>

      <style>{`
        @keyframes osint-pulse {
          0%   { transform:scale(1);   opacity:0.8; }
          100% { transform:scale(2.4); opacity:0; }
        }
        @keyframes osint-ring-pulse {
          0%,100% { opacity:0.5; transform:scale(1); }
          50%     { opacity:0.2; transform:scale(1.15); }
        }
        .maplibregl-popup-content { background:transparent!important; padding:0!important; box-shadow:none!important; }
        .maplibregl-popup-tip { display:none!important; }
      `}</style>
    </div>
  )
}
