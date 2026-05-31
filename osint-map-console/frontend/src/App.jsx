import { useState, useEffect, useCallback, useRef } from 'react'
import MapView from './components/MapView.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import MarkerPanel from './components/MarkerPanel.jsx'
import AoiPanel from './components/AoiPanel.jsx'
import MarkerModal from './components/MarkerModal.jsx'
import Toast from './components/Toast.jsx'
import {
  fetchMarkers, createMarker, updateMarker,
  deleteMarker, exportGeoJSON, importGeoJSON, checkHealth,
  fetchAois, createAoi, deleteAoi,
} from './hooks/useApi.js'
import { DEFAULT_BASEMAP } from './hooks/basemaps.js'
import styles from './styles/App.module.css'

const INIT_OVERLAY = {
  countries: true,
  cities:    false,
  grid:      false,
}

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
  const [toasts,            setToasts]            = useState([])
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
