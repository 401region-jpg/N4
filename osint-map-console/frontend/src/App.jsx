import { useState, useEffect, useCallback } from 'react'
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
  const [markers, setMarkers] = useState([])
  const [selectedMarker, setSelectedMarker] = useState(null)
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP)
  const [markersVisible, setMarkersVisible] = useState(true)
  const [pendingCoords, setPendingCoords] = useState(null)  // add mode
  const [editingMarker, setEditingMarker] = useState(null)  // edit mode
  const [backendOk, setBackendOk] = useState(null)
  const [flyTo, setFlyTo] = useState(null)
  const [toast, setToast] = useState(null)  // { msg, type }

  const showToast = useCallback((msg, type = 'error') => {
    setToast({ msg, type })
  }, [])

  useEffect(() => {
    checkHealth().then((ok) => {
      setBackendOk(ok)
      if (ok) {
        fetchMarkers().then(setMarkers).catch(() => showToast('Failed to load markers'))
      }
    })
  }, []) // eslint-disable-line

  const handleMapClick = useCallback((coords) => {
    setPendingCoords(coords)
  }, [])

  // ── Add ────────────────────────────────────────────────────────────────────
  const handleAddMarker = useCallback(async ({ title, note, color }) => {
    if (!pendingCoords) return
    try {
      const m = await createMarker({ lat: pendingCoords.lat, lng: pendingCoords.lng, title, note, color })
      setMarkers((prev) => [m, ...prev])
      setSelectedMarker(m)
    } catch (e) {
      showToast(e.message)
    } finally {
      setPendingCoords(null)
    }
  }, [pendingCoords, showToast])

  // ── Edit ───────────────────────────────────────────────────────────────────
  const handleEditMarker = useCallback(async ({ title, note, color }) => {
    if (!editingMarker) return
    try {
      const updated = await updateMarker(editingMarker.id, { title, note, color })
      setMarkers((prev) => prev.map((m) => m.id === updated.id ? updated : m))
      setSelectedMarker(updated)
    } catch (e) {
      showToast(e.message)
    } finally {
      setEditingMarker(null)
    }
  }, [editingMarker, showToast])

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDeleteMarker = useCallback(async (id) => {
    try {
      await deleteMarker(id)
      setMarkers((prev) => prev.filter((m) => m.id !== id))
      setSelectedMarker((prev) => prev?.id === id ? null : prev)
    } catch (e) {
      showToast(e.message)
    }
  }, [showToast])

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
    } catch (e) {
      showToast(e.message)
    }
  }, [showToast])

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = useCallback(async (file) => {
    try {
      const text = await file.text()
      const geojson = JSON.parse(text)
      const result = await importGeoJSON(geojson)
      const fresh = await fetchMarkers()
      setMarkers(fresh)
      showToast(`Imported ${result.imported} markers${result.skipped ? `, skipped ${result.skipped}` : ''}`, 'info')
    } catch (e) {
      showToast(e.message || 'Import failed')
    }
  }, [showToast])

  const handleLocateMarker = useCallback((marker) => {
    setFlyTo({ lat: marker.lat, lng: marker.lng, zoom: 14 })
    setSelectedMarker(marker)
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
      />

      <div className={styles.workspace}>
        <Sidebar
          markers={markers}
          selectedMarker={selectedMarker}
          onSelectMarker={handleLocateMarker}
          onDeleteMarker={handleDeleteMarker}
          markersVisible={markersVisible}
          onToggleMarkers={() => setMarkersVisible((v) => !v)}
        />

        <div className={styles.mapContainer}>
          <MapView
            basemap={basemap}
            markers={markers}
            markersVisible={markersVisible}
            selectedMarker={selectedMarker}
            onMapClick={handleMapClick}
            onMarkerClick={setSelectedMarker}
            flyTo={flyTo}
            onFlyToDone={() => setFlyTo(null)}
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

      {/* Add modal */}
      {pendingCoords && (
        <MarkerModal
          mode="add"
          coords={pendingCoords}
          onConfirm={handleAddMarker}
          onCancel={() => setPendingCoords(null)}
        />
      )}

      {/* Edit modal */}
      {editingMarker && (
        <MarkerModal
          mode="edit"
          initial={editingMarker}
          onConfirm={handleEditMarker}
          onCancel={() => setEditingMarker(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
