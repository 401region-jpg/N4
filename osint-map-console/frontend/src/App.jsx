import { useState, useEffect, useCallback, useRef } from 'react'
import MapView from './components/MapView.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import MarkerPanel from './components/MarkerPanel.jsx'
import MarkerModal from './components/MarkerModal.jsx'
import Toast from './components/Toast.jsx'
import {
  fetchMarkers, createMarker, updateMarker,
  deleteMarker, exportGeoJSON, importGeoJSON, checkHealth,
} from './hooks/useApi.js'
import { DEFAULT_BASEMAP } from './hooks/basemaps.js'
import styles from './styles/App.module.css'

export default function App() {
  const [markers,       setMarkers]       = useState([])
  const [selectedMarker, setSelectedMarker] = useState(null)
  const [basemap,       setBasemap]       = useState(DEFAULT_BASEMAP)
  const [markersVisible, setMarkersVisible] = useState(true)
  const [pendingCoords, setPendingCoords] = useState(null)
  const [editingMarker, setEditingMarker] = useState(null)
  const [backendOk,     setBackendOk]     = useState(null)
  const [flyTo,         setFlyTo]         = useState(null)
  const [fitAllTrigger, setFitAllTrigger] = useState(0)
  const [toasts,        setToasts]        = useState([])  // [{id, msg, type}]
  const toastIdRef = useRef(0)

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'error') => {
    setToasts((prev) => {
      // Deduplicate: don't stack identical message
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
        fetchMarkers()
          .then(setMarkers)
          .catch(() => showToast('Failed to load markers'))
      } else {
        showToast('Backend offline — check uvicorn is running')
      }
    })
  }, []) // eslint-disable-line

  // ── Add marker ─────────────────────────────────────────────────────────────
  const handleAddMarker = useCallback(async ({ title, note, color }) => {
    if (!pendingCoords) return
    try {
      const m = await createMarker({
        lat: pendingCoords.lat, lng: pendingCoords.lng, title, note, color,
      })
      setMarkers((prev) => [m, ...prev])
      setSelectedMarker(m)
      showToast(`Marker "${m.title}" saved`, 'success')
    } catch (e) {
      showToast(e.message)
    } finally {
      setPendingCoords(null)
    }
  }, [pendingCoords, showToast])

  // ── Edit marker ────────────────────────────────────────────────────────────
  const handleEditMarker = useCallback(async ({ title, note, color }) => {
    if (!editingMarker) return
    try {
      const updated = await updateMarker(editingMarker.id, { title, note, color })
      setMarkers((prev) => prev.map((m) => m.id === updated.id ? updated : m))
      setSelectedMarker(updated)
      showToast(`"${updated.title}" updated`, 'success')
    } catch (e) {
      showToast(e.message)
    } finally {
      setEditingMarker(null)
    }
  }, [editingMarker, showToast])

  // ── Delete marker ──────────────────────────────────────────────────────────
  const handleDeleteMarker = useCallback(async (id) => {
    const m = markers.find((x) => x.id === id)
    try {
      await deleteMarker(id)
      setMarkers((prev) => prev.filter((x) => x.id !== id))
      setSelectedMarker((prev) => prev?.id === id ? null : prev)
      if (m) showToast(`"${m.title}" deleted`, 'success')
    } catch (e) {
      showToast(e.message)
    }
  }, [markers, showToast])

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    try {
      const blob = await exportGeoJSON()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'markers.geojson'
      a.click()
      URL.revokeObjectURL(url)
      showToast(`Exported ${markers.length} markers`, 'success')
    } catch (e) {
      showToast(e.message)
    }
  }, [markers.length, showToast])

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = useCallback(async (file) => {
    if (!file) return
    let geojson
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error('File is empty')
      geojson = JSON.parse(text)
    } catch (e) {
      showToast(`Invalid file: ${e.message}`)
      return
    }
    try {
      const result = await importGeoJSON(geojson)
      const fresh  = await fetchMarkers()
      setMarkers(fresh)
      showToast(
        `Imported ${result.imported} marker${result.imported !== 1 ? 's' : ''}` +
        (result.skipped ? ` (${result.skipped} skipped)` : ''),
        'success'
      )
    } catch (e) {
      showToast(e.message || 'Import failed')
    }
  }, [showToast])

  const handleLocateMarker = useCallback((marker) => {
    setFlyTo({ lat: marker.lat, lng: marker.lng, zoom: 14 })
    setSelectedMarker(marker)
  }, [])

  const handleFitAll = useCallback(() => {
    setFitAllTrigger((n) => n + 1)
  }, [])

  const handleResetView = useCallback(() => {
    setFlyTo({ lat: 20, lng: 0, zoom: 2.5 })
  }, [])

  return (
    <div className={styles.app}>
      <TopBar
        basemap={basemap}
        onBasemapChange={setBasemap}
        backendOk={backendOk}
        onSearch={setFlyTo}
        onExport={handleExport}
        onImport={handleImport}
        onResetView={handleResetView}
      />

      <div className={styles.workspace}>
        <Sidebar
          markers={markers}
          selectedMarker={selectedMarker}
          onSelectMarker={handleLocateMarker}
          onDeleteMarker={handleDeleteMarker}
          markersVisible={markersVisible}
          onToggleMarkers={() => setMarkersVisible((v) => !v)}
          onFitAll={handleFitAll}
        />

        <div className={styles.mapContainer}>
          <MapView
            basemap={basemap}
            markers={markers}
            markersVisible={markersVisible}
            selectedMarker={selectedMarker}
            onMapClick={setPendingCoords}
            onMarkerClick={setSelectedMarker}
            flyTo={flyTo}
            onFlyToDone={() => setFlyTo(null)}
            fitAllTrigger={fitAllTrigger}
          />
        </div>

        {selectedMarker && (
          <MarkerPanel
            marker={selectedMarker}
            onClose={() => setSelectedMarker(null)}
            onDelete={handleDeleteMarker}
            onLocate={handleLocateMarker}
            onEdit={setEditingMarker}
          />
        )}
      </div>

      {pendingCoords && (
        <MarkerModal
          mode="add"
          coords={pendingCoords}
          onConfirm={handleAddMarker}
          onCancel={() => setPendingCoords(null)}
        />
      )}

      {editingMarker && (
        <MarkerModal
          mode="edit"
          initial={editingMarker}
          onConfirm={handleEditMarker}
          onCancel={() => setEditingMarker(null)}
        />
      )}

      <div className={styles.toastStack}>
        {toasts.map((t) => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  )
}
