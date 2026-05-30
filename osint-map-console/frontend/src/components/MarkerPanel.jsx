import styles from '../styles/MarkerPanel.module.css'

function formatTimestamp(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function toDMS(deg, isLat) {
  const abs = Math.abs(deg)
  const d   = Math.floor(abs)
  const mAll = (abs - d) * 60
  const m   = Math.floor(mAll)
  const s   = ((mAll - m) * 60).toFixed(1)
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')
  return `${d}°${m}'${s}"${dir}`
}

export default function MarkerPanel({ marker, onClose, onDelete, onLocate, onEdit, onCopyCoords, coordFormat }) {
  const fmt = coordFormat || 'decimal'

  const latStr = fmt === 'dms' ? toDMS(marker.lat, true)  : marker.lat.toFixed(6)
  const lngStr = fmt === 'dms' ? toDMS(marker.lng, false) : marker.lng.toFixed(6)

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.colorDot}
            style={{ background: marker.color, boxShadow: `0 0 8px ${marker.color}` }} />
          <span className={styles.headerLabel}>OBJECT</span>
          <span className={styles.headerId}>#{String(marker.id).padStart(4, '0')}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>TITLE</span>
          <span className={styles.fieldValue}>{marker.title}</span>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabelRow}>
            <span className={styles.fieldLabel}>COORDINATES</span>
            {onCopyCoords && (
              <button className={styles.copyBtn}
                onClick={() => onCopyCoords(marker.lat, marker.lng)}
                title="Copy coordinates">
                ⊡ COPY
              </button>
            )}
          </div>
          <div className={styles.coordRow}>
            <span className={styles.coordBox}>
              <span className={styles.coordLabel}>LAT</span>
              <span className={styles.coordVal}>{latStr}</span>
            </span>
            <span className={styles.coordBox}>
              <span className={styles.coordLabel}>LNG</span>
              <span className={styles.coordVal}>{lngStr}</span>
            </span>
          </div>
        </div>

        {marker.note && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>NOTES</span>
            <div className={styles.noteBox}>{marker.note}</div>
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>CREATED</span>
          <span className={styles.fieldValueMono}>{formatTimestamp(marker.created_at)}</span>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>COLOR TAG</span>
          <span className={styles.fieldValueMono} style={{ color: marker.color }}>
            {marker.color.toUpperCase()}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={() => onLocate(marker)}>◎ LOCATE</button>
        <button className={styles.actionBtn} onClick={() => onEdit(marker)}>✎ EDIT</button>
        <button className={`${styles.actionBtn} ${styles.actionDanger}`} onClick={() => onDelete(marker.id)}>✕ DELETE</button>
      </div>
    </div>
  )
}
