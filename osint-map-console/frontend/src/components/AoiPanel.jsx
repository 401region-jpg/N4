import { useState, useEffect, useCallback } from 'react'
import {
  fetchAoiImagery, createAoiImagery, updateAoiImagery, deleteAoiImagery,
} from '../hooks/useApi.js'
import styles from '../styles/AoiPanel.module.css'

const AOI_ICONS = { route: '⇒', zone: '◻', aoi: '◯', site: '◈', base: '▣', airfield: '✈', port: '⚓', depot: '▤', checkpoint: '⊘', observation: '◉' }

const BLANK = { label: '', source: '', imagery_date: '', state: 'current', notes: '', change_notes: '' }

function formatTimestamp(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default function AoiPanel({ aoi, onClose, onLocate, onDelete, showToast }) {
  const [imagery, setImagery]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [adding, setAdding]     = useState(false)
  const [form, setForm]         = useState(BLANK)
  const [compareView, setCompareView] = useState('current') // 'current' | 'previous'

  const load = useCallback(() => {
    if (!aoi) return
    setLoading(true)
    fetchAoiImagery(aoi.id)
      .then(setImagery)
      .catch((e) => showToast?.(e.message || 'Failed to load imagery'))
      .finally(() => setLoading(false))
  }, [aoi, showToast])

  useEffect(() => { setAdding(false); setForm(BLANK); setCompareView('current'); load() }, [aoi?.id]) // eslint-disable-line

  const current  = imagery.find((i) => i.state === 'current')  || null
  const previous = imagery.find((i) => i.state === 'previous') || null
  const active   = compareView === 'current' ? current : previous

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    try {
      const created = await createAoiImagery(aoi.id, form)
      setImagery((prev) => [created, ...prev])
      setAdding(false)
      setForm(BLANK)
      showToast?.('Imagery snapshot added', 'success')
    } catch (err) { showToast?.(err.message || 'Failed to add imagery') }
  }, [aoi, form, showToast])

  const handleSetState = useCallback(async (entry, state) => {
    try {
      const updated = await updateAoiImagery(entry.id, { state })
      setImagery((prev) => prev.map((i) => i.id === updated.id ? updated : i))
    } catch (err) { showToast?.(err.message || 'Failed to update imagery') }
  }, [showToast])

  const handleChangeNotes = useCallback(async (entry, change_notes) => {
    try {
      const updated = await updateAoiImagery(entry.id, { change_notes })
      setImagery((prev) => prev.map((i) => i.id === updated.id ? updated : i))
      showToast?.('Change notes saved', 'success')
    } catch (err) { showToast?.(err.message || 'Failed to save change notes') }
  }, [showToast])

  const handleDeleteEntry = useCallback(async (id) => {
    try {
      await deleteAoiImagery(id)
      setImagery((prev) => prev.filter((i) => i.id !== id))
    } catch (err) { showToast?.(err.message || 'Failed to delete imagery') }
  }, [showToast])

  if (!aoi) return null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.icon} style={{ color: aoi.color }}>
            {AOI_ICONS[aoi.kind] || '◯'}
          </span>
          <span className={styles.headerLabel}>AOI</span>
          <span className={styles.headerId}>#{String(aoi.id).padStart(4, '0')}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>TITLE</span>
          <span className={styles.fieldValue}>{aoi.title}</span>
          <span className={styles.fieldSub}>{(aoi.kind || 'aoi').toUpperCase()}</span>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.fieldLabel}>IMAGERY COMPARE</span>
            <button className={styles.smallBtn} onClick={() => setAdding((v) => !v)}>
              {adding ? '✕ CANCEL' : '+ SNAPSHOT'}
            </button>
          </div>

          {adding && (
            <form className={styles.form} onSubmit={handleSubmit}>
              <input className={styles.input} placeholder="Label / title"
                value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <input className={styles.input} placeholder="Source (e.g. Sentinel-2, Maxar)"
                value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              <input className={styles.input} type="date" placeholder="Imagery date"
                value={form.imagery_date} onChange={(e) => setForm({ ...form, imagery_date: e.target.value })} />
              <select className={styles.input}
                value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="current">current</option>
                <option value="previous">previous</option>
              </select>
              <textarea className={styles.textarea} placeholder="Notes"
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <button className={styles.primaryBtn} type="submit">SAVE SNAPSHOT</button>
            </form>
          )}

          <div className={styles.toggle}>
            <button
              className={`${styles.toggleBtn} ${compareView === 'previous' ? styles.toggleActive : ''}`}
              onClick={() => setCompareView('previous')}>
              ◄ PREVIOUS{previous ? '' : ' —'}
            </button>
            <button
              className={`${styles.toggleBtn} ${compareView === 'current' ? styles.toggleActive : ''}`}
              onClick={() => setCompareView('current')}>
              CURRENT{current ? '' : ' —'} ►
            </button>
          </div>

          {active ? (
            <div className={styles.snapshotCard}>
              <div className={styles.snapRow}>
                <span className={styles.snapLabel}>LABEL</span>
                <span className={styles.snapVal}>{active.label || '—'}</span>
              </div>
              <div className={styles.snapRow}>
                <span className={styles.snapLabel}>SOURCE</span>
                <span className={styles.snapVal}>{active.source || '—'}</span>
              </div>
              <div className={styles.snapRow}>
                <span className={styles.snapLabel}>DATE</span>
                <span className={styles.snapVal}>{active.imagery_date || '—'}</span>
              </div>
              {active.notes && (
                <div className={styles.noteBox}>{active.notes}</div>
              )}
              <div className={styles.changeBlock}>
                <span className={styles.snapLabel}>CHANGE NOTES (vs other state)</span>
                <ChangeNotesEditor entry={active} onSave={handleChangeNotes} />
              </div>
            </div>
          ) : (
            <div className={styles.empty}>
              No {compareView} imagery. Add a snapshot and set its state.
            </div>
          )}
        </div>

        <div className={styles.section}>
          <span className={styles.fieldLabel}>HISTORY ({imagery.length})</span>
          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : imagery.length === 0 ? (
            <div className={styles.empty}>No imagery entries yet.</div>
          ) : (
            <div className={styles.historyList}>
              {imagery.map((i) => (
                <div key={i.id} className={styles.historyItem}>
                  <div className={styles.historyMain}>
                    <span className={styles.historyTitle}>
                      {i.label || i.source || 'Snapshot'}
                    </span>
                    <span className={styles.historyMeta}>
                      {i.imagery_date || formatTimestamp(i.created_at)}
                      {i.source ? ` · ${i.source}` : ''}
                    </span>
                  </div>
                  <div className={styles.historyActions}>
                    <button
                      className={`${styles.stateBtn} ${i.state === 'current' ? styles.stateCurrent : ''}`}
                      title="Mark as current"
                      onClick={() => handleSetState(i, 'current')}>C</button>
                    <button
                      className={`${styles.stateBtn} ${i.state === 'previous' ? styles.statePrevious : ''}`}
                      title="Mark as previous"
                      onClick={() => handleSetState(i, 'previous')}>P</button>
                    <button className={styles.delBtn} title="Delete"
                      onClick={() => handleDeleteEntry(i.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={() => onLocate?.(aoi.id)}>◎ LOCATE</button>
        <button className={`${styles.actionBtn} ${styles.actionDanger}`}
          onClick={() => onDelete?.(aoi.id)}>✕ DELETE AOI</button>
      </div>
    </div>
  )
}

function ChangeNotesEditor({ entry, onSave }) {
  const [val, setVal] = useState(entry.change_notes || '')
  useEffect(() => { setVal(entry.change_notes || '') }, [entry.id]) // eslint-disable-line
  const dirty = val !== (entry.change_notes || '')
  return (
    <div className={styles.changeEditor}>
      <textarea className={styles.textarea}
        placeholder="e.g. new construction, site expansion, route change, removed object"
        value={val} onChange={(e) => setVal(e.target.value)} />
      <button className={styles.primaryBtn} disabled={!dirty}
        onClick={() => onSave(entry, val)}>SAVE CHANGE NOTES</button>
    </div>
  )
}
