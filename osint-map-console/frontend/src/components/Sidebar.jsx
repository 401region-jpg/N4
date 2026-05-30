import styles from '../styles/Sidebar.module.css'

// Countries, Regions, Cities, Grid are implemented.
// Routes, Zones remain disabled.
const OVERLAY_LAYERS = [
  { key: 'countries', label: 'COUNTRIES', icon: '◫', impl: true },
  { key: 'regions',   label: 'REGIONS',   icon: '⊟', impl: true },
  { key: 'cities',    label: 'CITIES',    icon: '⊙', impl: true },
  { key: 'grid',      label: 'GRID',      icon: '⊞', impl: true },
  { key: 'routes',    label: 'ROUTES',    icon: '⇒', impl: false },
  { key: 'zones',     label: 'ZONES',     icon: '◻', impl: false },
]

export default function Sidebar({
  markers, selectedMarker,
  onSelectMarker, onDeleteMarker,
  markersVisible, onToggleMarkers,
  overlayVisibility, onToggleOverlay,
  onFitAll,
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>LAYERS</span>
        <span className={styles.headerCount}>{markers.length} OBJ</span>
      </div>

      <div className={styles.layerList}>
        <LayerRow icon="◈" label="USER MARKERS" badge={markers.length}
          active={markersVisible} onToggle={onToggleMarkers} impl />

        {OVERLAY_LAYERS.map((l) => (
          <LayerRow key={l.key}
            icon={l.icon} label={l.label}
            active={l.impl ? (overlayVisibility?.[l.key] ?? false) : false}
            onToggle={l.impl ? () => onToggleOverlay(l.key) : null}
            impl={l.impl}
          />
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.objectsHeader}>
        <span>OBJECTS</span>
        <button className={styles.fitBtn} onClick={onFitAll}
          disabled={markers.length === 0} title="Fit to all markers">
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
          <div key={m.id}
            className={`${styles.markerItem} ${selectedMarker?.id === m.id ? styles.markerSelected : ''}`}
            onClick={() => onSelectMarker(m)}>
            <span className={styles.markerDot}
              style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }} />
            <div className={styles.markerInfo}>
              <span className={styles.markerTitle}>{m.title}</span>
              <span className={styles.markerCoords}>{m.lat.toFixed(4)}, {m.lng.toFixed(4)}</span>
            </div>
            <button className={styles.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDeleteMarker(m.id) }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function LayerRow({ icon, label, badge, active, onToggle, impl }) {
  return (
    <div className={`${styles.layerRow} ${active ? styles.layerActive : ''} ${!impl ? styles.layerDisabled : ''}`}>
      <span className={styles.layerIcon}>{icon}</span>
      <span className={styles.layerLabel}>{label}</span>
      {badge !== undefined && <span className={styles.layerBadge}>{badge}</span>}
      {!impl && <span className={styles.layerSoon}>SOON</span>}
      {impl && (
        <button className={`${styles.toggleBtn} ${active ? styles.toggleOn : styles.toggleOff}`}
          onClick={onToggle}>
          {active ? '◉' : '○'}
        </button>
      )}
    </div>
  )
}
