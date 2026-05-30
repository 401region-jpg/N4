// Unified modal for both Add and Edit modes.
// mode="add"  → requires coords prop, shows coordinates, submit = "PLACE MARKER"
// mode="edit" → requires initial prop (marker), hides coords, submit = "SAVE CHANGES"
import { useState } from 'react'
import styles from '../styles/AddMarkerModal.module.css'

const COLOR_OPTIONS = [
  { value: '#00ff88', label: 'GREEN' },
  { value: '#00e5ff', label: 'CYAN' },
  { value: '#ffcc00', label: 'YELLOW' },
  { value: '#ff3b5c', label: 'RED' },
  { value: '#ff8c00', label: 'ORANGE' },
  { value: '#bf5fff', label: 'PURPLE' },
]

export default function MarkerModal({ mode, coords, initial, onConfirm, onCancel }) {
  const isEdit = mode === 'edit'
  const [title, setTitle] = useState(isEdit ? initial.title : '')
  const [note, setNote] = useState(isEdit ? initial.note : '')
  const [color, setColor] = useState(isEdit ? initial.color : '#00ff88')

  const handleSubmit = () => {
    if (!title.trim()) return
    onConfirm({ title: title.trim(), note: note.trim(), color })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        <div className={styles.header}>
          <span className={styles.headerIcon}>◈</span>
          <span className={styles.headerLabel}>{isEdit ? 'EDIT MARKER' : 'NEW MARKER'}</span>
          <button className={styles.closeBtn} onClick={onCancel}>✕</button>
        </div>

        {!isEdit && coords && (
          <div className={styles.coordsDisplay}>
            <span className={styles.coordPair}>
              <span className={styles.coordKey}>LAT</span>
              <span className={styles.coordVal}>{coords.lat.toFixed(6)}</span>
            </span>
            <span className={styles.coordSep}>·</span>
            <span className={styles.coordPair}>
              <span className={styles.coordKey}>LNG</span>
              <span className={styles.coordVal}>{coords.lng.toFixed(6)}</span>
            </span>
          </div>
        )}

        {isEdit && (
          <div className={styles.coordsDisplay}>
            <span className={styles.coordPair}>
              <span className={styles.coordKey}>ID</span>
              <span className={styles.coordVal}>#{String(initial.id).padStart(4, '0')}</span>
            </span>
            <span className={styles.coordSep}>·</span>
            <span className={styles.coordPair}>
              <span className={styles.coordKey}>POS</span>
              <span className={styles.coordVal}>{initial.lat.toFixed(4)}, {initial.lng.toFixed(4)}</span>
            </span>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.formGroup}>
            <label className={styles.label}>TITLE <span className={styles.required}>*</span></label>
            <input
              className={styles.input}
              placeholder="Object designation..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              maxLength={80}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>NOTES</label>
            <textarea
              className={styles.textarea}
              placeholder="Additional intelligence notes..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              maxLength={500}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>COLOR TAG</label>
            <div className={styles.colorRow}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  className={`${styles.colorBtn} ${color === c.value ? styles.colorSelected : ''}`}
                  style={{
                    background: color === c.value ? c.value + '22' : 'transparent',
                    borderColor: color === c.value ? c.value : 'var(--border)',
                  }}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                >
                  <span className={styles.colorDot} style={{
                    background: c.value,
                    boxShadow: color === c.value ? `0 0 8px ${c.value}` : 'none',
                  }} />
                  <span className={styles.colorLabel} style={{
                    color: color === c.value ? c.value : 'var(--text-muted)',
                  }}>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel}>CANCEL</button>
          <button
            className={styles.confirmBtn}
            onClick={handleSubmit}
            disabled={!title.trim()}
          >
            {isEdit ? '✎ SAVE CHANGES' : '◈ PLACE MARKER'}
          </button>
        </div>
      </div>
    </div>
  )
}
