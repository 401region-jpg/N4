import { useEffect } from 'react'
import styles from '../styles/Toast.module.css'

const ICONS = { error: '⚠', success: '✓', info: 'ℹ' }
const DURATION = { error: 5000, success: 2500, info: 4000 }

export default function Toast({ msg, type = 'error', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, DURATION[type] ?? 4000)
    return () => clearTimeout(t)
  }, [type, onDone]) // msg intentionally omitted — timer resets only on type change

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <span className={styles.icon}>{ICONS[type] ?? 'ℹ'}</span>
      <span className={styles.msg}>{msg}</span>
      <button className={styles.close} onClick={onDone}>✕</button>
    </div>
  )
}
