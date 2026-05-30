import styles from '../styles/Sidebar.module.css'

const STATIC_LAYERS = [
  { key: 'countries', label: 'COUNTRIES',  icon: '◫', implemented: true },
  { key: 'regions',   label: 'REGIONS',    icon: '⊟', implemented: false },
  { key: 'cities',    label: 'CITIES',     icon: '⊙', implemented: false },
  { key: 'grid',      label: 'GRID',       icon: '⊞', implemented: false },
  { key: 'routes',    label: 'ROUTES',     icon: '⇒', implemented: false },
  { key: 'zones',     label: 'ZONES',      icon: '◻', implemented: false },
]

export default function Sidebar({
  markers,
  selectedMarker,
  onSelectMarker,
  onDeleteMarker,
  markersVisible,
  onToggleMarkers,
  overlayVisibility,
  onToggleOverlay,
  onFitAll,
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>LAYERS</span>
        <span className={styles.headerCount}>{markers.length} OBJ</span>
      </div>

      <div className={styles.layerList}>
        {/* User Markers */}
        <LayerRow
          icon="◈" label="USER MARKERS" badge={markers.length}
          active={markersVisible} onToggle={onToggleMarkers}
          implemented
        />
        {/* Overlay layers */}
        {STATIC_LAYERS.map((l) => (
          <LayerRow
            key={l.key}
            icon={l.icon} label={l.label}
            active={l.implemented ? (overlayVisibility?.[l.key] ?? false) : false}
            onToggle={l.implemented ? () => onToggleOverlay(l.key) : null}
            implemented={l.implemented}
          />
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.objectsHeader}>
        <span>OBJECTS</span>
        <button
          className={styles.fitBtn}
          onClick={onFitAll}
          disabled={markers.length === 0}
          title={markers.length === 0 ? 'No markers' : 'Fit to all markers'}
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

function LayerRow({ icon, label, badge, active, onToggle, implemented }) {
  return (
    <div className={`${styles.layerRow} ${active ? styles.layerActive : ''} ${!implemented ? styles.layerDisabled : ''}`}>
      <span className={styles.layerIcon}>{icon}</span>
      <span className={styles.layerLabel}>{label}</span>
      {badge !== undefined && <span className={styles.layerBadge}>{badge}</span>}
      {!implemented && <span className={styles.layerSoon}>SOON</span>}
      {implemented && (
        <button
          className={`${styles.toggleBtn} ${active ? styles.toggleOn : styles.toggleOff}`}
          onClick={onToggle}
          title={active ? 'Hide' : 'Show'}
        >
          {active ? '◉' : '○'}
        </button>
      )}
    </div>
  )
}
