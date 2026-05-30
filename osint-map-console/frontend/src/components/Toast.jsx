import { useEffect } from 'react'
import styles from '../styles/Toast.module.css'

export default function Toast({ msg, type = 'error', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [msg, onDone])

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <span className={styles.icon}>{type === 'error' ? '⚠' : 'ℹ'}</span>
      <span className={styles.msg}>{msg}</span>
      <button className={styles.close} onClick={onDone}>✕</button>
    </div>
  )
}
