import styles from '../styles/Sidebar.module.css'

const LAYERS = [
  { id: 'markers', label: 'MARKERS', icon: '◈' },
  { id: 'grid', label: 'GRID', icon: '⊞', disabled: true },
  { id: 'routes', label: 'ROUTES', icon: '⇒', disabled: true },
  { id: 'zones', label: 'ZONES', icon: '◻', disabled: true },
]

export default function Sidebar({
  markers,
  selectedMarker,
  onSelectMarker,
  onDeleteMarker,
  activeLayer,
  onLayerChange,
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>LAYERS</span>
        <span className={styles.headerCount}>{markers.length} OBJ</span>
      </div>

      <div className={styles.layerList}>
        {LAYERS.map((l) => (
          <button
            key={l.id}
            className={`${styles.layerBtn} ${activeLayer === l.id ? styles.layerActive : ''} ${l.disabled ? styles.layerDisabled : ''}`}
            onClick={() => !l.disabled && onLayerChange(l.id)}
            title={l.disabled ? 'Coming soon' : l.label}
          >
            <span className={styles.layerIcon}>{l.icon}</span>
            <span className={styles.layerLabel}>{l.label}</span>
            {l.id === 'markers' && (
              <span className={styles.layerBadge}>{markers.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.objectsHeader}>
        <span>OBJECTS</span>
      </div>

      <div className={styles.markerList}>
        {markers.length === 0 && (
          <div className={styles.empty}>
            <span>NO MARKERS</span>
            <span className={styles.emptyHint}>Click map to add</span>
          </div>
        )}
        {markers.map((m) => (
          <div
            key={m.id}
            className={`${styles.markerItem} ${selectedMarker?.id === m.id ? styles.markerSelected : ''}`}
            onClick={() => onSelectMarker(m)}
          >
            <span
              className={styles.markerDot}
              style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }}
            />
            <div className={styles.markerInfo}>
              <span className={styles.markerTitle}>{m.title}</span>
              <span className={styles.markerCoords}>
                {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
              </span>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDeleteMarker(m.id) }}
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
