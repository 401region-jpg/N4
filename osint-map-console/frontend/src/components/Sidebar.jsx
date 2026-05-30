import styles from '../styles/Sidebar.module.css'

export default function Sidebar({
  markers,
  selectedMarker,
  onSelectMarker,
  onDeleteMarker,
  markersVisible,
  onToggleMarkers,
  onFitAll,
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>LAYERS</span>
        <span className={styles.headerCount}>{markers.length} OBJ</span>
      </div>

      <div className={styles.layerList}>
        {/* User Markers — real toggle */}
        <div className={`${styles.layerRow} ${markersVisible ? styles.layerActive : ''}`}>
          <span className={styles.layerIcon}>◈</span>
          <span className={styles.layerLabel}>USER MARKERS</span>
          <span className={styles.layerBadge}>{markers.length}</span>
          <button
            className={`${styles.toggleBtn} ${markersVisible ? styles.toggleOn : styles.toggleOff}`}
            onClick={onToggleMarkers}
            title={markersVisible ? 'Hide' : 'Show'}
          >
            {markersVisible ? '◉' : '○'}
          </button>
        </div>

        {[
          { label: 'GRID OVERLAY', icon: '⊞' },
          { label: 'ROUTES',       icon: '⇒' },
          { label: 'ZONES',        icon: '◻' },
        ].map((l) => (
          <div key={l.label} className={`${styles.layerRow} ${styles.layerDisabled}`}>
            <span className={styles.layerIcon}>{l.icon}</span>
            <span className={styles.layerLabel}>{l.label}</span>
            <span className={styles.layerSoon}>SOON</span>
          </div>
        ))}
      </div>

      <div className={styles.divider} />

      {/* Objects header + FIT ALL */}
      <div className={styles.objectsHeader}>
        <span>OBJECTS</span>
        <button
          className={styles.fitBtn}
          onClick={onFitAll}
          disabled={markers.length === 0}
          title={markers.length === 0 ? 'No markers' : 'Fit map to all markers'}
        >
          FIT ALL
        </button>
      </div>

      <div className={styles.markerList}>
        {markers.length === 0 ? (
          <div className={styles.empty}>
            <span>NO MARKERS</span>
            <span className={styles.emptyHint}>Click map to add</span>
          </div>
        ) : markers.map((m) => (
          <div
            key={m.id}
            className={`${styles.markerItem} ${selectedMarker?.id === m.id ? styles.markerSelected : ''}`}
            onClick={() => onSelectMarker(m)}
          >
            <span className={styles.markerDot}
              style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }} />
            <div className={styles.markerInfo}>
              <span className={styles.markerTitle}>{m.title}</span>
              <span className={styles.markerCoords}>{m.lat.toFixed(4)}, {m.lng.toFixed(4)}</span>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDeleteMarker(m.id) }}
              title="Delete"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
