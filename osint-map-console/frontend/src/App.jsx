import { useState, useEffect, useCallback } from 'react'
import MapView from './components/MapView.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import MarkerPanel from './components/MarkerPanel.jsx'
import AddMarkerModal from './components/AddMarkerModal.jsx'
import { fetchMarkers, createMarker, deleteMarker, checkHealth } from './hooks/useApi.js'
import { DEFAULT_BASEMAP } from './hooks/basemaps.js'
import styles from './styles/App.module.css'

export default function App() {
  const [markers, setMarkers] = useState([])
  const [selectedMarker, setSelectedMarker] = useState(null)
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP)
  const [pendingCoords, setPendingCoords] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [backendOk, setBackendOk] = useState(null)
  const [flyTo, setFlyTo] = useState(null)
  const [activeLayer, setActiveLayer] = useState('markers')

  useEffect(() => {
    checkHealth().then((ok) => {
      setBackendOk(ok)
      if (ok) {
        fetchMarkers().then(setMarkers).catch(console.error)
      }
    })
  }, [])

  const handleMapClick = useCallback((coords) => {
    setPendingCoords(coords)
    setShowAddModal(true)
  }, [])

  const handleAddMarker = useCallback(async ({ title, note, color }) => {
    if (!pendingCoords) return
    try {
      const m = await createMarker({
        lat: pendingCoords.lat,
        lng: pendingCoords.lng,
        title,
        note,
        color,
      })
      setMarkers((prev) => [m, ...prev])
      setSelectedMarker(m)
    } catch (e) {
      console.error(e)
    } finally {
      setShowAddModal(false)
      setPendingCoords(null)
    }
  }, [pendingCoords])

  const handleDeleteMarker = useCallback(async (id) => {
    try {
      await deleteMarker(id)
      setMarkers((prev) => prev.filter((m) => m.id !== id))
      setSelectedMarker((prev) => (prev?.id === id ? null : prev))
    } catch (e) {
      console.error(e)
    }
  }, [])

  const handleMarkerClick = useCallback((marker) => {
    setSelectedMarker(marker)
  }, [])

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
      />

      <div className={styles.workspace}>
        <Sidebar
          markers={markers}
          selectedMarker={selectedMarker}
          onSelectMarker={handleLocateMarker}
          onDeleteMarker={handleDeleteMarker}
          activeLayer={activeLayer}
          onLayerChange={setActiveLayer}
        />

        <div className={styles.mapContainer}>
          <MapView
            basemap={basemap}
            markers={markers}
            selectedMarker={selectedMarker}
            onMapClick={handleMapClick}
            onMarkerClick={handleMarkerClick}
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
          />
        )}
      </div>

      {showAddModal && pendingCoords && (
        <AddMarkerModal
          coords={pendingCoords}
          onConfirm={handleAddMarker}
          onCancel={() => {
            setShowAddModal(false)
            setPendingCoords(null)
          }}
        />
      )}
    </div>
  )
}
