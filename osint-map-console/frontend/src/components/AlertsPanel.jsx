import { useState } from 'react'
import styles from '../styles/AlertsPanel.module.css'

const STATUS_LABEL = { new: 'NEW', confirmed: 'CONFIRMED', dismissed: 'DISMISSED', uncertain: 'UNCERTAIN' }

export default function AlertsPanel({ alerts = [], aois = [], onSelectAoi, onReview }) {
  const [openId, setOpenId] = useState(null)
  const [note, setNote] = useState('')

  const aoiTitle = (id) => aois.find((a) => a.id === id)?.title || `AOI #${id}`

  const submit = (alert, status) => {
    onReview?.(alert.id, status, openId === alert.id ? note : '')
    setOpenId(null)
    setNote('')
  }

  const newCount = alerts.filter((a) => a.status === 'new').length

  return (
    <div>
      <div className={styles.objectsHeader}>
        <span>ALERTS</span>
        <span className={styles.count}>{newCount} NEW / {alerts.length}</span>
      </div>
      <div className={styles.list}>
        {alerts.length === 0 ? (
          <div className={styles.empty}>
            <span>NO ALERTS</span>
            <span className={styles.hint}>Monitor an AOI, then add imagery</span>
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
              <button className={`${styles.actBtn} ${styles.confirm}`} onClick={() => submit(a, 'confirmed')}>CONFIRM</button>
              <button className={`${styles.actBtn} ${styles.uncertain}`} onClick={() => submit(a, 'uncertain')}>?</button>
              <button className={`${styles.actBtn} ${styles.dismiss}`} onClick={() => submit(a, 'dismissed')}>DISMISS</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
