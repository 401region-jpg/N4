import { useState } from 'react'
import styles from '../styles/AlertsPanel.module.css'

const STATUS_LABEL = { new: 'NEW', confirmed: 'CONFIRMED', dismissed: 'DISMISSED', uncertain: 'UNCERTAIN' }

export default function AlertsPanel({ alerts = [], aois = [], onSelectAoi, onReview, onCheckNow }) {
  const [openId,   setOpenId]   = useState(null)
  const [note,     setNote]     = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null)

  const aoiTitle = (id) => aois.find((a) => a.id === id)?.title || `AOI #${id}`

  const submit = (alert, status) => {
    onReview?.(alert.id, status, openId === alert.id ? note : '')
    setOpenId(null)
    setNote('')
  }

  const handleCheckNow = async () => {
    if (checking) return
    setChecking(true)
    setCheckResult(null)
    try {
      const result = await onCheckNow?.()
      setCheckResult(result)
    } catch (e) {
      setCheckResult({ ok: false, error: e.message })
    } finally {
      setChecking(false)
    }
  }

  const newCount = alerts.filter((a) => a.status === 'new').length

  return (
    <div>
      {/* ── Check Now button ── */}
      <div className={styles.checkRow}>
        <button
          className={`${styles.checkBtn} ${checking ? styles.checkBusy : ''}`}
          onClick={handleCheckNow}
          disabled={checking}
          title="Search Sentinel-2 STAC for new imagery on all monitored AOIs"
        >
          {checking ? '◌ CHECKING...' : '⟳ CHECK MONITORED AOIS NOW'}
        </button>
      </div>

      {/* ── Check result summary ── */}
      {checkResult && (
        <div className={`${styles.checkResult} ${checkResult.ok === false ? styles.checkError : styles.checkOk}`}>
          {checkResult.ok === false ? (
            <span>✕ Error: {checkResult.error}</span>
          ) : (
            <span>
              Checked {checkResult.checked} AOI{checkResult.checked !== 1 ? 's' : ''} · {' '}
              {checkResult.new_snapshots} new snapshot{checkResult.new_snapshots !== 1 ? 's' : ''} · {' '}
              {checkResult.new_alerts} new alert{checkResult.new_alerts !== 1 ? 's' : ''}
              {checkResult.message ? ` — ${checkResult.message}` : ''}
              {checkResult.errors?.length > 0 && (
                <span className={styles.checkWarn}> · {checkResult.errors.length} error(s)</span>
              )}
            </span>
          )}
          <button className={styles.checkDismiss} onClick={() => setCheckResult(null)}>✕</button>
        </div>
      )}

      {/* ── Alerts list ── */}
      <div className={styles.objectsHeader}>
        <span>ALERTS</span>
        <span className={styles.count}>{newCount} NEW / {alerts.length}</span>
      </div>

      <div className={styles.list}>
        {alerts.length === 0 ? (
          <div className={styles.empty}>
            <span>NO ALERTS</span>
            <span className={styles.hint}>Monitor an AOI, then click CHECK NOW</span>
          </div>
        ) : alerts.map((a) => (
          <div key={a.id} className={`${styles.item} ${styles['s_' + a.status]}`}>
            <div className={styles.itemMain} onClick={() => onSelectAoi?.(a.aoi_id)}>
              <div className={styles.itemTop}>
                <span className={`${styles.badge} ${styles['b_' + a.status]}`}>
                  {STATUS_LABEL[a.status] || a.status}
                </span>
                <span className={styles.aoiName}>{aoiTitle(a.aoi_id)}</span>
              </div>
              <span className={styles.title}>{a.title}</span>
              {a.details && <span className={styles.details}>{a.details}</span>}
              {a.review_note && <span className={styles.reviewNote}>note: {a.review_note}</span>}
            </div>
            {openId === a.id && (
              <input className={styles.noteInput} placeholder="Review note (optional)"
                value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            )}
            <div className={styles.actions}>
              <button className={styles.actBtn} onClick={() => { setOpenId(openId === a.id ? null : a.id); setNote('') }}>
                {openId === a.id ? '✕ NOTE' : '✎ NOTE'}
              </button>
              <button className={`${styles.actBtn} ${styles.confirm}`}   onClick={() => submit(a, 'confirmed')}>CONFIRM</button>
              <button className={`${styles.actBtn} ${styles.uncertain}`} onClick={() => submit(a, 'uncertain')}>?</button>
              <button className={`${styles.actBtn} ${styles.dismiss}`}   onClick={() => submit(a, 'dismissed')}>DISMISS</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
