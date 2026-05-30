import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS } from '../hooks/basemaps.js'
import styles from '../styles/MapView.module.css'

const MARKER_COLORS = {
  '#00ff88': '#00ff88',
  '#00e5ff': '#00e5ff',
  '#ff3b5c': '#ff3b5c',
  '#ffcc00': '#ffcc00',
  '#ff8c00': '#ff8c00',
  '#bf5fff': '#bf5fff',
}

export default function MapView({
  basemap,
  markers,
  selectedMarker,
  onMapClick,
  onMarkerClick,
  flyTo,
  onFlyToDone,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // id -> maplibre Marker

  // Init map
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
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right'
    )

    map.on('click', (e) => {
      onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // Handle basemap changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded) return

    const update = () => {
      map.setStyle(BASEMAPS[basemap].style)
    }

    if (map.loaded()) {
      update()
    } else {
      map.once('load', update)
    }
  }, [basemap])

  // Re-add markers after style change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const addMarkersToMap = () => {
      // Clear existing
      Object.values(markersRef.current).forEach((m) => m.remove())
      markersRef.current = {}
      // Re-add
      markers.forEach((m) => addMarkerToMap(map, m))
    }

    if (map.loaded()) {
      addMarkersToMap()
    }

    map.on('styledata', addMarkersToMap)
    return () => map.off('styledata', addMarkersToMap)
  }, [markers, basemap]) // eslint-disable-line

  const addMarkerToMap = useCallback((map, m) => {
    const el = document.createElement('div')
    el.className = 'osint-marker'
    el.style.cssText = `
      width: 14px;
      height: 14px;
      background: ${m.color || '#00ff88'};
      border: 2px solid rgba(255,255,255,0.8);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 8px ${m.color || '#00ff88'}, 0 0 20px ${m.color || '#00ff88'}55;
      transition: transform 0.15s;
      position: relative;
    `

    el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.4)' })
    el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onMarkerClick(m)
    })

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([m.lng, m.lat])
      .addTo(map)

    markersRef.current[m.id] = marker
  }, [onMarkerClick])

  // FlyTo
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

  // Highlight selected marker
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, m]) => {
      const el = m.getElement()
      if (parseInt(id) === selectedMarker?.id) {
        el.style.transform = 'scale(1.6)'
        el.style.zIndex = '10'
        el.style.boxShadow = `0 0 16px white, 0 0 32px ${selectedMarker.color || '#00ff88'}`
      } else {
        el.style.transform = 'scale(1)'
        el.style.zIndex = '1'
        const marker = markers.find(mk => mk.id === parseInt(id))
        if (marker) {
          el.style.boxShadow = `0 0 8px ${marker.color || '#00ff88'}, 0 0 20px ${marker.color || '#00ff88'}55`
        }
      }
    })
  }, [selectedMarker, markers])

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} />
      <div className={styles.coords} id="coords-display" />
      <div className={styles.hint}>
        <span>◈ CLICK MAP TO PLACE MARKER</span>
      </div>
    </div>
  )
}
