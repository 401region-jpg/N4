import styles from '../styles/Sidebar.module.css'
import AlertsPanel from './AlertsPanel.jsx'

// Countries, Cities, Grid are implemented.
// Regions needs a global admin-1 vector source we don't have keyless; Routes/Zones land in Stage 2.
const OVERLAY_LAYERS = [
  { key: 'countries', label: 'COUNTRIES', icon: '◫', impl: true },
  { key: 'cities',    label: 'CITIES',    icon: '⊙', impl: true },
  { key: 'grid',      label: 'GRID',      icon: '⊞', impl: true },
  { key: 'regions',   label: 'REGIONS',   icon: '⊟', impl: false },
  { key: 'routes',    label: 'ROUTES',    icon: '⇒', impl: false },
  { key: 'zones',     label: 'ZONES',     icon: '◻', impl: false },
]

const AOI_ICONS = { route: '⇒', zone: '◻', aoi: '◯', site: '◈', base: '▣', airfield: '✈', port: '⚓', depot: '▤', checkpoint: '⊘', observation: '◉' }

export default function Sidebar({
  markers, selectedMarker,
  onSelectMarker, onDeleteMarker,
  markersVisible, onToggleMarkers,
  overlayVisibility, onToggleOverlay,
  onFitAll,
  aois = [], selectedAoiId, onSelectAoi, onDeleteAoi,
  alerts = [], onReviewAlert,
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

      <div className={styles.divider} />

      <div className={styles.objectsHeader}>
        <span>AOI / GEOMETRY</span>
        <span className={styles.headerCount}>{aois.length}</span>
      </div>

      <div className={styles.markerList}>
        {aois.length === 0 ? (
          <div className={styles.empty}>
            <span>NO AOI</span>
            <span className={styles.emptyHint}>Use ZONE / ROUTE / CIRCLE tools</span>
          </div>
        ) : aois.map((a) => (
          <div key={a.id}
            className={`${styles.markerItem} ${selectedAoiId === a.id ? styles.markerSelected : ''}`}
            onClick={() => onSelectAoi(a.id)}>
            <span className={styles.markerDot}
              style={{ background: 'transparent', boxShadow: 'none', color: a.color }}>
              {AOI_ICONS[a.kind] || '◯'}
            </span>
            <div className={styles.markerInfo}>
              <span className={styles.markerTitle}>{a.title}</span>
              <span className={styles.markerCoords}>{(a.kind || 'aoi').toUpperCase()}{a.note ? ` · ${a.note}` : ''}</span>
            </div>
            <button className={styles.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDeleteAoi(a.id) }}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.divider} />

      <AlertsPanel
        alerts={alerts}
        aois={aois}
        onSelectAoi={onSelectAoi}
        onReview={onReviewAlert}
      />
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
