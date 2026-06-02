import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import MapView from './components/MapView.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import MarkerPanel from './components/MarkerPanel.jsx'
import AoiPanel from './components/AoiPanel.jsx'
import AircraftPanel from './components/AircraftPanel.jsx'
import OrbitalPanel from './components/OrbitalPanel.jsx'
import MarkerModal from './components/MarkerModal.jsx'
import Toast from './components/Toast.jsx'
import {
  fetchMarkers, createMarker, updateMarker,
  deleteMarker, exportGeoJSON, importGeoJSON, checkHealth,
  fetchAois, createAoi, deleteAoi,
  setAoiMonitored, fetchAlerts, reviewAlert, triggerMonitoringCheck,
  refreshAirTraffic, fetchAirLatest, fetchAirNearAois,
  fetchOrbitalLatest, refreshOrbital, fetchOrbitalNearAois,
} from './hooks/useApi.js'
import { DEFAULT_BASEMAP } from './hooks/basemaps.js'
import styles from './styles/App.module.css'

const INIT_OVERLAY = {
  countries: true,
  cities:    false,
  grid:      false,
}

// Air layer visibility is separate (handled via airVisible state, not overlayVisibility)

// Rough centroid of an AOI geometry for fly-to.
function aoiCentroid(geom) {
  if (!geom) return null
  let coords = []
  if (geom.type === 'Point') return { lng: geom.coordinates[0], lat: geom.coordinates[1] }
  if (geom.type === 'LineString') coords = geom.coordinates
  else if (geom.type === 'Polygon') coords = geom.coordinates[0] || []
  else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0]?.[0] || []
  if (!coords.length) return null
  const sum = coords.reduce((s, c) => [s[0] + c[0], s[1] + c[1]], [0, 0])
  return { lng: sum[0] / coords.length, lat: sum[1] / coords.length }
}

export default function App() {
  const [markers,           setMarkers]           = useState([])
  const [selectedMarker,    setSelectedMarker]    = useState(null)
  const [basemap,           setBasemap]           = useState(DEFAULT_BASEMAP)
  const [markersVisible,    setMarkersVisible]    = useState(true)
  const [overlayVisibility, setOverlayVisibility] = useState(INIT_OVERLAY)
  const [pendingCoords,     setPendingCoords]     = useState(null)
  const [editingMarker,     setEditingMarker]     = useState(null)
  const [backendOk,         setBackendOk]         = useState(null)
  const [flyTo,             setFlyTo]             = useState(null)
  const [fitAllTrigger,     setFitAllTrigger]     = useState(0)
  const [searchPin,         setSearchPin]         = useState(null)
  const [measureActive,     setMeasureActive]     = useState(false)
  const [measureResult,     setMeasureResult]     = useState(null)
  const [coordFormat,       setCoordFormat]       = useState('decimal') // 'decimal'|'dms'
  const [aois,              setAois]              = useState([])
  const [selectedAoiId,     setSelectedAoiId]     = useState(null)
  const [drawMode,          setDrawMode]          = useState(null) // 'polygon'|'route'|'circle'|null
  const [alerts,            setAlerts]            = useState([])
  // Stage 5 / 5.1 — Air traffic
  const [airSnapshot,       setAirSnapshot]       = useState(null)    // {ts, count, aircraft, trails}
  const [airNearAois,       setAirNearAois]       = useState([])
  const [airVisible,        setAirVisible]        = useState(true)
  const [selectedAircraft,  setSelectedAircraft]  = useState(null)
  // Stage 5.2 — Extra controls
  const DEFAULT_AIR_FILTERS = { altMin: '', altMax: '', speedMin: '', speedMax: '', callsign: '', search: '', category: '', nearAoiOnly: false }
  const [airFilters,        setAirFilters]         = useState(DEFAULT_AIR_FILTERS)
  const [refreshInterval,   setRefreshInterval]    = useState('manual') // 'manual' | ms string
  const [showTrails,        setShowTrails]         = useState(true)
  // Stage 6 — Orbital
  const [orbitalData,         setOrbitalData]         = useState(null)
  const [orbitalVisible,      setOrbitalVisible]      = useState(true)
  const [selectedOrbital,     setSelectedOrbital]     = useState(null)
  const [orbitalNearAois,     setOrbitalNearAois]     = useState([])
  const [showOrbTrails,       setShowOrbTrails]       = useState(true)
  const DEFAULT_ORBITAL_FILTERS = { search: '', category: '', nearAoiOnly: false, country: '', operator: '' }
  const [orbitalFilters,      setOrbitalFilters]       = useState(DEFAULT_ORBITAL_FILTERS)
  const [orbitalRefreshInterval, setOrbitalRefreshInterval] = useState('manual')
  const [toasts,            setToasts]             = useState([])
  const toastIdRef   = useRef(0)
  const searchTimerRef = useRef(null)

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'error') => {
    setToasts((prev) => {
      if (prev.length && prev[prev.length - 1].msg === msg) return prev
      const id = ++toastIdRef.current
      return [...prev, { id, msg, type }]
    })
  }, [])
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    checkHealth().then((ok) => {
      setBackendOk(ok)
      if (ok) {
        fetchMarkers().then(setMarkers).catch(() => showToast('Failed to load markers'))
        fetchAois().then(setAois).catch(() => showToast('Failed to load AOIs'))
        fetchAlerts().then(setAlerts).catch(() => showToast('Failed to load alerts'))
        fetchOrbitalLatest().then((r) => { if (r?.ok) setOrbitalData(r) }).catch(() => {})
      } else {
        showToast('Backend offline — start uvicorn on port 8000')
      }
    })
  }, []) // eslint-disable-line

  const handleToggleOverlay = useCallback((key) => {
    setOverlayVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const handleAddMarker = useCallback(async ({ title, note, color }) => {
    if (!pendingCoords) return
    try {
      const m = await createMarker({ lat: pendingCoords.lat, lng: pendingCoords.lng, title, note, color })
      setMarkers((prev) => [m, ...prev])
      setSelectedMarker(m)
      showToast(`"${m.title}" saved`, 'success')
    } catch (e) { showToast(e.message) }
    finally { setPendingCoords(null) }
  }, [pendingCoords, showToast])

  const handleEditMarker = useCallback(async ({ title, note, color }) => {
    if (!editingMarker) return
    try {
      const updated = await updateMarker(editingMarker.id, { title, note, color })
      setMarkers((prev) => prev.map((m) => m.id === updated.id ? updated : m))
      setSelectedMarker(updated)
      showToast(`"${updated.title}" updated`, 'success')
    } catch (e) { showToast(e.message) }
    finally { setEditingMarker(null) }
  }, [editingMarker, showToast])

  const handleDeleteMarker = useCallback(async (id) => {
    const m = markers.find((x) => x.id === id)
    try {
      await deleteMarker(id)
      setMarkers((prev) => prev.filter((x) => x.id !== id))
      setSelectedMarker((prev) => prev?.id === id ? null : prev)
      if (m) showToast(`"${m.title}" deleted`, 'success')
    } catch (e) { showToast(e.message) }
  }, [markers, showToast])

  const handleExport = useCallback(async () => {
    try {
      const blob = await exportGeoJSON()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'markers.geojson'; a.click()
      URL.revokeObjectURL(url)
      showToast(`Exported ${markers.length} markers`, 'success')
    } catch (e) { showToast(e.message) }
  }, [markers.length, showToast])

  const handleImport = useCallback(async (file) => {
    if (!file) return
    let geojson
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error('File is empty')
      geojson = JSON.parse(text)
    } catch (e) { showToast(`Invalid file: ${e.message}`); return }
    try {
      const result = await importGeoJSON(geojson)
      const fresh  = await fetchMarkers()
      setMarkers(fresh)
      showToast(
        `Imported ${result.imported} marker${result.imported !== 1 ? 's' : ''}` +
        (result.skipped ? ` (${result.skipped} skipped)` : ''),
        'success'
      )
    } catch (e) { showToast(e.message || 'Import failed') }
  }, [showToast])

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback((loc) => {
    setFlyTo(loc)
    setSearchPin({ lat: loc.lat, lng: loc.lng })
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setSearchPin(null), 7000)
  }, [])

  const handleLocateMarker = useCallback((marker) => {
    setFlyTo({ lat: marker.lat, lng: marker.lng, zoom: 14 })
    setSelectedMarker(marker)
    setSearchPin(null)
  }, [])

  // ── Measure ────────────────────────────────────────────────────────────────
  const handleMeasureResult = useCallback((distStr) => {
    setMeasureResult(distStr)
    if (distStr) showToast(`Distance: ${distStr}`, 'info')
  }, [showToast])

  // ── AOI / geometry ───────────────────────────────────────────────────────
  const handleSetDrawMode = useCallback((mode) => {
    setMeasureActive(false)
    setDrawMode((prev) => (prev === mode ? null : mode))
  }, [])

  const handleAoiComplete = useCallback(async (geometry, { kind, metric }) => {
    setDrawMode(null)
    const label = kind === 'route' ? 'Route' : kind === 'zone' ? 'Zone' : 'AOI'
    const title = `${label} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    const color = kind === 'route' ? '#ff8c00' : '#00e5ff'
    try {
      const created = await createAoi({ kind, title, color, geometry, note: metric || '' })
      setAois((prev) => [created, ...prev])
      setSelectedAoiId(created.id)
      showToast(`${label} saved — ${metric || ''}`.trim(), 'success')
    } catch (e) { showToast(e.message || 'Failed to save AOI') }
  }, [showToast])

  const handleDeleteAoi = useCallback(async (id) => {
    try {
      await deleteAoi(id)
      setAois((prev) => prev.filter((a) => a.id !== id))
      setSelectedAoiId((prev) => (prev === id ? null : prev))
      showToast('AOI deleted', 'success')
    } catch (e) { showToast(e.message || 'Failed to delete AOI') }
  }, [showToast])

  const handleSelectAoi = useCallback((id) => {
    setSelectedAoiId(id)
    const a = aois.find((x) => x.id === id)
    if (a) {
      const c = aoiCentroid(a.geometry)
      if (c) setFlyTo({ lat: c.lat, lng: c.lng, zoom: 10 })
    }
  }, [aois])

  const refreshAlerts = useCallback(() => {
    fetchAlerts().then(setAlerts).catch(() => {})
  }, [])

  const handleToggleMonitor = useCallback(async (aoi) => {
    try {
      const updated = await setAoiMonitored(aoi.id, !aoi.monitored)
      setAois((prev) => prev.map((a) => a.id === updated.id ? updated : a))
      showToast(updated.monitored ? `Monitoring "${updated.title}"` : `Monitoring off`, 'success')
    } catch (e) { showToast(e.message || 'Failed to update monitoring') }
  }, [showToast])

  const handleReviewAlert = useCallback(async (id, status, note) => {
    try {
      const updated = await reviewAlert(id, status, note)
      setAlerts((prev) => prev.map((a) => a.id === updated.id ? updated : a))
    } catch (e) { showToast(e.message || 'Failed to review alert') }
  }, [showToast])

  const handleCheckNow = useCallback(async () => {
    const result = await triggerMonitoringCheck()
    // Refresh alerts and imagery after a successful check
    if (result.new_alerts > 0) {
      fetchAlerts().then(setAlerts).catch(() => {})
    }
    return result
  }, []) // eslint-disable-line


  // ── Stage 5 / 5.1: Air traffic ───────────────────────────────────────────────
  const handleAirRefresh = useCallback(async (filters = {}, silent = false) => {
    try {
      // Server-side filters (sent to POST /api/air/refresh — reduces OpenSky bandwidth)
      const serverFilters = {}
      if (filters.alt_min   != null)  serverFilters.alt_min   = filters.alt_min
      if (filters.alt_max   != null)  serverFilters.alt_max   = filters.alt_max
      if (filters.speed_min != null)  serverFilters.speed_min = filters.speed_min
      if (filters.callsign)           serverFilters.callsign  = filters.callsign

      const result = await refreshAirTraffic(serverFilters)
      if (!result.ok) {
        showToast(`Air refresh failed: ${result.error}`, 'error')
        return
      }

      // Client-side filters (applied via GET /api/air/latest using the stored snapshot)
      const clientFilters = {}
      if (filters.search)          clientFilters.search        = filters.search
      if (filters.category)        clientFilters.category      = filters.category
      if (filters.alt_min != null) clientFilters.alt_min       = filters.alt_min
      if (filters.alt_max != null) clientFilters.alt_max       = filters.alt_max
      if (filters.speed_min != null) clientFilters.speed_min   = filters.speed_min
      if (filters.speed_max != null) clientFilters.speed_max   = filters.speed_max
      if (filters.near_aoi_only)   clientFilters.near_aoi_only = 'true'

      let acData = result
      if (Object.keys(clientFilters).length) {
        const latestResult = await fetchAirLatest(clientFilters)
        if (latestResult.ok) acData = latestResult
      }

      setAirSnapshot({
        ts:       acData.ts,
        count:    acData.count,
        aircraft: acData.aircraft,
        trails:   acData.trails || {},
      })

      // Near-AOI check
      const near = await fetchAirNearAois()
      if (near.ok) setAirNearAois(near.results || [])

      if (!silent && result.count > 0) {
        const filterNote = Object.values(filters).filter(Boolean).length ? ' (filtered)' : ''
        showToast(`${result.count} aircraft loaded${filterNote}`, 'info')
      }
    } catch (e) { showToast(e.message || 'Air refresh failed') }
  }, [showToast])

  const handleAircraftClick = useCallback((props) => {
    setSelectedAircraft((prev) => prev?.icao24 === props?.icao24 ? null : props)
  }, [])

  // Stage 5.2 — filter state management
  const handleFilterChange = useCallback((key, val) => {
    setAirFilters((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleClearFilters = useCallback(() => {
    setAirFilters(DEFAULT_AIR_FILTERS)
  }, [])

  // Stage 5.2 — safe polling (reads filters via ref to avoid reset on every keystroke)
  const pollingRef = useRef(null)
  const airFiltersRef = useRef(airFilters)
  airFiltersRef.current = airFilters
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (refreshInterval === 'manual') return
    const ms = parseInt(refreshInterval, 10)
    if (isNaN(ms) || ms < 15000) return
    pollingRef.current = setInterval(() => {
      const f = airFiltersRef.current
      const parsed = {
        alt_min:   f.altMin   !== '' ? parseFloat(f.altMin)   : undefined,
        alt_max:   f.altMax   !== '' ? parseFloat(f.altMax)   : undefined,
        speed_min: f.speedMin !== '' ? parseFloat(f.speedMin) : undefined,
        speed_max: f.speedMax !== '' ? parseFloat(f.speedMax) : undefined,
        callsign:  f.callsign || undefined,
        search:    f.search   || undefined,
        category:  f.category || undefined,
        near_aoi_only: f.nearAoiOnly || undefined,
      }
      handleAirRefresh(parsed, true)
    }, ms)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [refreshInterval, handleAirRefresh])


  const nearAircraftIcaos = useMemo(() => {
    const set = new Set()
    airNearAois.forEach((r) => r.aircraft.forEach((a) => set.add(a.icao24)))
    return set
  }, [airNearAois])


  // ── Stage 6 Batch 4: Orbital refresh, filters, polling ───────────────────────
  const handleOrbitalRefresh = useCallback(async (filters = {}, silent = false) => {
    try {
      const result = await refreshOrbital()
      if (!result.ok) {
        showToast(`Orbital refresh failed: ${result.error}`, 'error')
        return
      }

      // Apply client-side filters via GET /api/orbit/latest
      const clientFilters = {}
      if (filters.search)          clientFilters.search        = filters.search
      if (filters.category)        clientFilters.category      = filters.category
      if (filters.country)         clientFilters.country       = filters.country
      if (filters.operator)        clientFilters.operator      = filters.operator
      if (filters.near_aoi_only)   clientFilters.near_aoi_only = 'true'

      let orbData = result
      if (Object.keys(clientFilters).length) {
        const latestResult = await fetchOrbitalLatest(clientFilters)
        if (latestResult.ok) orbData = latestResult
      }

      setOrbitalData({
        ts:       orbData.ts,
        count:    orbData.count,
        objects:  orbData.objects,
        tracks:   orbData.tracks || {},
      })

      const near = await fetchOrbitalNearAois()
      if (near.ok) setOrbitalNearAois(near.results || [])

      if (!silent && result.count > 0) {
        showToast(`${result.count} orbital objects loaded`, 'info')
      }
    } catch (e) { showToast(e.message || 'Orbital refresh failed') }
  }, [showToast])

  const handleOrbitalClick = useCallback((obj) => {
    setSelectedOrbital((prev) => prev?.sat_id === obj?.sat_id ? null : obj)
  }, [])

  const handleOrbitalFilterChange = useCallback((key, val) => {
    setOrbitalFilters((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleClearOrbitalFilters = useCallback(() => {
    setOrbitalFilters(DEFAULT_ORBITAL_FILTERS)
  }, [])

  // Orbital polling
  const orbPollingRef = useRef(null)
  const orbFiltersRef = useRef(orbitalFilters)
  orbFiltersRef.current = orbitalFilters
  useEffect(() => {
    if (orbPollingRef.current) clearInterval(orbPollingRef.current)
    if (orbitalRefreshInterval === 'manual') return
    const ms = parseInt(orbitalRefreshInterval, 10)
    if (isNaN(ms) || ms < 30000) return
    orbPollingRef.current = setInterval(() => {
      const f = orbFiltersRef.current
      const parsed = {
        search:        f.search   || undefined,
        category:      f.category || undefined,
        near_aoi_only: f.nearAoiOnly || undefined,
        country:       f.country  || undefined,
        operator:      f.operator || undefined,
      }
      handleOrbitalRefresh(parsed, true)
    }, ms)
    return () => { if (orbPollingRef.current) clearInterval(orbPollingRef.current) }
  }, [orbitalRefreshInterval, handleOrbitalRefresh])

  const nearOrbitalSatIds = useMemo(() => {
    const set = new Set()
    orbitalNearAois.forEach((r) => r.aircraft.forEach((a) => set.add(a.sat_id || a.icao24)))
    return set
  }, [orbitalNearAois])

  const selectedAoi = aois.find((a) => a.id === selectedAoiId) || null

  // ── Copy center coords ─────────────────────────────────────────────────────
  // Exposed via TopBar; MapView handles its own cursor coords
  // This is a simpler "copy current search/fly coords" feature
  const handleCopyCoords = useCallback((lat, lng) => {
    const txt = coordFormat === 'dms'
      ? `${Math.abs(lat).toFixed(6)}${lat>=0?'N':'S'} ${Math.abs(lng).toFixed(6)}${lng>=0?'E':'W'}`
      : `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    navigator.clipboard.writeText(txt).then(
      () => showToast(`Copied: ${txt}`, 'info'),
      () => showToast('Clipboard access denied')
    )
  }, [coordFormat, showToast])

  return (
    <div className={styles.app}>
      <TopBar
        basemap={basemap}
        onBasemapChange={setBasemap}
        backendOk={backendOk}
        onSearch={handleSearch}
        onExport={handleExport}
        onImport={handleImport}
        onResetView={() => setFlyTo({ lat: 20, lng: 0, zoom: 2.5 })}
        measureActive={measureActive}
        onToggleMeasure={() => { setDrawMode(null); setMeasureActive((v) => !v) }}
        coordFormat={coordFormat}
        onToggleCoordFormat={() => setCoordFormat((f) => f === 'decimal' ? 'dms' : 'decimal')}
        measureResult={measureResult}
        drawMode={drawMode}
        onSetDrawMode={handleSetDrawMode}
      />

      <div className={styles.workspace}>
        <Sidebar
          markers={markers}
          selectedMarker={selectedMarker}
          onSelectMarker={handleLocateMarker}
          onDeleteMarker={handleDeleteMarker}
          markersVisible={markersVisible}
          onToggleMarkers={() => setMarkersVisible((v) => !v)}
          overlayVisibility={overlayVisibility}
          onToggleOverlay={handleToggleOverlay}
          onFitAll={() => setFitAllTrigger((n) => n + 1)}
          aois={aois}
          selectedAoiId={selectedAoiId}
          onSelectAoi={handleSelectAoi}
          onDeleteAoi={handleDeleteAoi}
          alerts={alerts}
          onReviewAlert={handleReviewAlert}
          onCheckNow={handleCheckNow}
          airVisible={airVisible}
          onToggleAir={() => setAirVisible((v) => !v)}
          airSnapshot={airSnapshot}
          airNearAois={airNearAois}
          onAirRefresh={handleAirRefresh}
          onAircraftClick={handleAircraftClick}
          selectedAircraft={selectedAircraft}
          airFilters={airFilters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          showTrails={showTrails}
          onToggleTrails={() => setShowTrails((v) => !v)}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
          orbitalVisible={orbitalVisible}
          onToggleOrbital={() => setOrbitalVisible((v) => !v)}
          orbitalSnapshot={orbitalData}
          orbitalNearAois={orbitalNearAois}
          onOrbitalRefresh={handleOrbitalRefresh}
          selectedOrbital={selectedOrbital}
          onOrbitalClick={handleOrbitalClick}
          orbitalFilters={orbitalFilters}
          onOrbitalFilterChange={handleOrbitalFilterChange}
          onClearOrbitalFilters={handleClearOrbitalFilters}
          showOrbTrails={showOrbTrails}
          onToggleOrbTrails={() => setShowOrbTrails((v) => !v)}
          orbitalRefreshInterval={orbitalRefreshInterval}
          onOrbitalRefreshIntervalChange={setOrbitalRefreshInterval}
        />

        <div className={styles.mapContainer}>
          <MapView
            basemap={basemap}
            markers={markers}
            markersVisible={markersVisible}
            overlayVisibility={overlayVisibility}
            selectedMarker={selectedMarker}
            onMapClick={measureActive ? () => {} : setPendingCoords}
            onMarkerClick={setSelectedMarker}
            flyTo={flyTo}
            onFlyToDone={() => setFlyTo(null)}
            fitAllTrigger={fitAllTrigger}
            searchPin={searchPin}
            measureActive={measureActive}
            onMeasureResult={handleMeasureResult}
            coordFormat={coordFormat}
            onCopyCoords={handleCopyCoords}
            aois={aois}
            selectedAoiId={selectedAoiId}
            onAoiClick={handleSelectAoi}
            drawMode={drawMode}
            onAoiComplete={handleAoiComplete}
            onDrawCancel={() => setDrawMode(null)}
            aircraft={airSnapshot?.aircraft || []}
            airTrails={airSnapshot?.trails || {}}
            airVisible={airVisible}
            onAircraftClick={handleAircraftClick}
            nearAircraftIcaos={nearAircraftIcaos}
            showTrails={showTrails}
            selectedAircraft={selectedAircraft}
            onDeselectAircraft={() => setSelectedAircraft(null)}
            orbital={orbitalData?.objects || []}
            orbitalTracks={orbitalData?.tracks || {}}
            orbitalVisible={orbitalVisible}
            selectedOrbital={selectedOrbital}
            onOrbitalClick={handleOrbitalClick}
            onDeselectOrbital={() => setSelectedOrbital(null)}
            showOrbTrails={showOrbTrails}
          />
        </div>

        {selectedMarker && (
          <MarkerPanel
            marker={selectedMarker}
            onClose={() => setSelectedMarker(null)}
            onDelete={handleDeleteMarker}
            onLocate={handleLocateMarker}
            onEdit={setEditingMarker}
            onCopyCoords={handleCopyCoords}
            coordFormat={coordFormat}
          />
        )}

        {selectedAoi && (
          <AoiPanel
            aoi={selectedAoi}
            onClose={() => setSelectedAoiId(null)}
            onLocate={handleSelectAoi}
            onDelete={handleDeleteAoi}
            onToggleMonitor={handleToggleMonitor}
            onImageryAdded={refreshAlerts}
            showToast={showToast}
          />
        )}
      </div>

      {pendingCoords && !measureActive && !drawMode && (
        <MarkerModal mode="add" coords={pendingCoords}
          onConfirm={handleAddMarker} onCancel={() => setPendingCoords(null)} />
      )}
      {editingMarker && (
        <MarkerModal mode="edit" initial={editingMarker}
          onConfirm={handleEditMarker} onCancel={() => setEditingMarker(null)} />
      )}

      <div className={styles.toastStack}>
        {toasts.map((t) => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  )
}
