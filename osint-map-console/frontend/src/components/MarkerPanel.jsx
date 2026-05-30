import styles from '../styles/MarkerPanel.module.css'

function formatTimestamp(ts) {
  const d = new Date(ts * 1000)
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export default function MarkerPanel({ marker, onClose, onDelete, onLocate, onEdit }) {
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
          <span className={styles.fieldLabel}>LAT / LNG</span>
          <div className={styles.coordRow}>
            <span className={styles.coordBox}>
              <span className={styles.coordLabel}>LAT</span>
              <span className={styles.coordVal}>{marker.lat.toFixed(6)}</span>
            </span>
            <span className={styles.coordBox}>
              <span className={styles.coordLabel}>LNG</span>
              <span className={styles.coordVal}>{marker.lng.toFixed(6)}</span>
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
        <button className={styles.actionBtn} onClick={() => onLocate(marker)}>
          <span>◎</span> LOCATE
        </button>
        <button className={styles.actionBtn} onClick={() => onEdit(marker)}>
          <span>✎</span> EDIT
        </button>
        <button className={`${styles.actionBtn} ${styles.actionDanger}`} onClick={() => onDelete(marker.id)}>
          <span>✕</span> DELETE
        </button>
      </div>
    </div>
  )
}
