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
import {
  ensureAoiLayers, setAoiData, clearDraft, DRAFT_SOURCE,
  circleToPolygon, ringAreaMeters, formatArea, lineLengthMeters,
} from '../hooks/aoiLayer.js'
import {
  ensureAirLayers, setAirData, setAirVisibility, AIR_CLICKABLE_LAYERS,
} from '../hooks/airLayer.js'
import styles from './MapView.module.css'

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
  onCopyCoords,         // (lat, lng) => void — copy cursor coords
  aois,                 // AOI rows [{id, geometry, color, ...}]
  selectedAoiId,        // currently selected AOI id
  onAoiClick,           // (id) => void
  drawMode,             // 'polygon' | 'route' | 'circle' | null
  onAoiComplete,        // (geometry, { kind, metric }) => void
  onDrawCancel,         // () => void
  aircraft,             // [] — Stage 5 air layer data
  airVisible,           // bool
  onAircraftClick,      // (props) => void
}) {
  const containerRef   = useRef(null)
  const gridCanvasRef  = useRef(null)
  const mapRef         = useRef(null)
  const mlMarkersRef   = useRef({})
  const searchPinRef   = useRef(null)
  const gridCleanupRef = useRef(null)
  const coordsRef      = useRef(null)
  const zoomRef        = useRef(null)
  const lastLngLatRef  = useRef(null)
  const onCopyCoordsRef = useRef(onCopyCoords)
  onCopyCoordsRef.current = onCopyCoords

  // AOI draw state (refs to avoid re-renders on each vertex)
  const drawRef = useRef({ points: [], circleCenter: null })
  const drawModeRef     = useRef(drawMode)
  const onAoiCompleteRef = useRef(onAoiComplete)
  const onAoiClickRef    = useRef(onAoiClick)
  const aoisRef          = useRef(aois)
  const selectedAoiIdRef = useRef(selectedAoiId ?? null)
  drawModeRef.current      = drawMode
  onAoiCompleteRef.current = onAoiComplete
  onAoiClickRef.current    = onAoiClick
  aoisRef.current          = aois
  selectedAoiIdRef.current = selectedAoiId ?? null

  // Measure state (lives in refs to avoid re-render on every mousemove)
  const measureRef = useRef({ active: false, pointA: null, line: null, popup: null })

  // Stage 5 — Air layer refs
  const aircraftRef        = useRef(aircraft || [])
  const airVisibleRef      = useRef(airVisible ?? true)
  const onAircraftClickRef = useRef(onAircraftClick)

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
  aircraftRef.current        = aircraft || []
  airVisibleRef.current      = airVisible ?? true
  onAircraftClickRef.current = onAircraftClick

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

  // ── AOI draw helpers ───────────────────────────────────────────────────────
  function renderDraft(map) {
    const src = map.getSource(DRAFT_SOURCE)
    if (!src) return
    const mode = drawModeRef.current
    const pts  = drawRef.current.points
    const features = []

    // vertices
    pts.forEach((p) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))

    if (mode === 'circle' && drawRef.current.circleCenter && pts.length === 1) {
      // center placed, waiting for radius — nothing extra
    } else if (mode === 'route' && pts.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} })
    } else if (mode === 'polygon' && pts.length >= 2) {
      const coords = pts.length >= 3 ? [...pts, pts[0]] : pts
      features.push({
        type: 'Feature',
        geometry: pts.length >= 3 ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords },
        properties: {},
      })
    }
    src.setData({ type: 'FeatureCollection', features })
  }

  function resetDraft(map) {
    drawRef.current = { points: [], circleCenter: null }
    if (map) clearDraft(map)
  }

  function finishDraw(map) {
    const mode = drawModeRef.current
    const pts  = drawRef.current.points
    if (!mode) return

    if (mode === 'polygon' && pts.length >= 3) {
      const ring = [...pts, pts[0]]
      const geometry = { type: 'Polygon', coordinates: [ring] }
      onAoiCompleteRef.current?.(geometry, { kind: 'zone', metric: `Area ${formatArea(ringAreaMeters(pts))}` })
      resetDraft(map)
    } else if (mode === 'route' && pts.length >= 2) {
      const geometry = { type: 'LineString', coordinates: pts }
      onAoiCompleteRef.current?.(geometry, { kind: 'route', metric: `Length ${formatDistance(lineLengthMeters(pts))}` })
      resetDraft(map)
    }
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
      lastLngLatRef.current = e.lngLat
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

    // Map click: draw AOI / measure / place marker
    map.on('click', (e) => {
      const { lat, lng } = e.lngLat

      // ── AOI draw mode takes priority ──
      const mode = drawModeRef.current
      if (mode) {
        if (mode === 'circle') {
          const d = drawRef.current
          if (!d.circleCenter) {
            d.circleCenter = [lng, lat]
            d.points = [[lng, lat]]
            renderDraft(map)
          } else {
            const radius = haversineMeters(
              { lat: d.circleCenter[1], lng: d.circleCenter[0] }, { lat, lng })
            const geometry = circleToPolygon(d.circleCenter, radius)
            onAoiCompleteRef.current?.(geometry, {
              kind: 'aoi', metric: `Radius ${formatDistance(radius)}`,
            })
            resetDraft(map)
          }
        } else {
          drawRef.current.points.push([lng, lat])
          renderDraft(map)
        }
        return
      }

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

      // Don't drop a marker when the click lands on an existing AOI feature —
      // the per-layer handler will select it instead.
      const aoiLayers = ['aoi-fill', 'aoi-line', 'aoi-point'].filter((l) => map.getLayer(l))
      if (aoiLayers.length && map.queryRenderedFeatures(e.point, { layers: aoiLayers }).length) return

      onMapClickRef.current({ lat, lng })
    })

    // Double-click finishes polygon/route (suppress default zoom while drawing)
    map.on('dblclick', (e) => {
      if (drawModeRef.current === 'polygon' || drawModeRef.current === 'route') {
        e.preventDefault()
        finishDraw(map)
      }
    })

    map.once('load', () => {
      // Container can mount at zero/partial size before layout settles, which
      // makes MapLibre paint a single degenerate world tile (the "giant centered
      // image with black margins"). Force a resize once tiles can load.
      map.resize()
      // Apply correct initial basemap (effect may have run before load)
      applyBasemap(map, DEFAULT_BASEMAP)
      // Apply initial overlay visibility
      const ov = overlayRef.current || {}
      Object.entries(OVERLAY_GROUPS).forEach(([key]) => {
        applyOverlay(map, key, ov[key] ?? (key === 'countries'))
      })

      // AOI layers + initial data
      ensureAoiLayers(map)
      setAoiData(map, aoisRef.current, selectedAoiIdRef.current)

      // Click an AOI to select it (only when not drawing/measuring)
      const aoiSelect = (e) => {
        if (drawModeRef.current || measureActiveRef.current) return
        const id = e.features?.[0]?.properties?.id
        if (id != null) { e.originalEvent?.stopPropagation?.(); onAoiClickRef.current?.(id) }
      }
      ;['aoi-fill', 'aoi-line', 'aoi-point'].forEach((lid) => {
        map.on('click', lid, aoiSelect)
        map.on('mouseenter', lid, () => { if (!drawModeRef.current) map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = '' })
      })

      drawMarkers(map)

      // Stage 5 — Air layer
      ensureAirLayers(map)
      setAirData(map, aircraftRef.current)
      if (!airVisibleRef.current) setAirVisibility(map, false)
      AIR_CLICKABLE_LAYERS.forEach((lid) => {
        map.on('click', lid, (e) => {
          const props = e.features?.[0]?.properties
          if (props) onAircraftClickRef.current?.(props)
        })
        map.on('mouseenter', lid, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = '' })
      })

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

    // Keep the GL canvas matched to its container after any layout change
    // (panel/sidebar toggles, window resize). Without this the map can be left
    // at a stale size and render the degenerate world-image-with-black-margins.
    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => map.resize())
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect()
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
  // Scoped to marker-relevant props so a basemap/overlay toggle never clears and
  // re-adds every marker (which caused flicker on switch).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    drawMarkers(map)
  }, [markers, markersVisible, selectedMarker?.id])

  // ── AOI data sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => { ensureAoiLayers(map); setAoiData(map, aois, selectedAoiId ?? null) }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [aois, selectedAoiId])

  // ── Stage 5: aircraft data update ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => { ensureAirLayers(map); setAirData(map, aircraft) }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [aircraft])

  // ── Stage 5: aircraft visibility toggle ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    setAirVisibility(map, airVisible ?? true)
  }, [airVisible])

  // ── Draw mode: cursor + cancel cleanup ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()
    if (drawMode) {
      canvas.style.cursor = 'crosshair'
      map.doubleClickZoom.disable()
    } else {
      canvas.style.cursor = ''
      map.doubleClickZoom.enable()
      resetDraft(map)
    }

    const onKey = (ev) => {
      if (!drawModeRef.current) return
      if (ev.key === 'Escape') { resetDraft(map); onDrawCancel?.() }
      else if (ev.key === 'Enter') { finishDraw(map) }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (map.doubleClickZoom) map.doubleClickZoom.enable()
    }
  }, [drawMode, onDrawCancel])

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
        <span
          ref={coordsRef}
          className={styles.coords}
          title="Click to copy cursor coordinates"
          onClick={() => {
            const ll = lastLngLatRef.current || mapRef.current?.getCenter()
            if (ll && onCopyCoordsRef.current) onCopyCoordsRef.current(ll.lat, ll.lng)
          }}
        />
        <span ref={zoomRef}   className={styles.zoom} />
      </div>

      <div className={styles.hint}>◈ CLICK MAP TO PLACE MARKER · CLICK COORDS TO COPY</div>

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
