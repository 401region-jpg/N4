import { useState, useRef } from 'react'
import { BASEMAPS } from '../hooks/basemaps.js'
import styles from '../styles/TopBar.module.css'

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

export default function TopBar({ basemap, onBasemapChange, backendOk, onSearch }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)

  const handleQueryChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.length < 3) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `${NOMINATIM}?q=${encodeURIComponent(val)}&format=json&limit=5`,
          { headers: { 'Accept-Language': 'en' } }
        )
        const data = await res.json()
        setResults(data)
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 400)
  }

  const handleSelect = (r) => {
    onSearch({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), zoom: 13 })
    setQuery(r.display_name.split(',')[0])
    setResults([])
  }

  return (
    <div className={styles.topbar}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>◈</span>
        <span className={styles.logoText}>OSINT<span className={styles.logoSub}>MAP</span></span>
      </div>

      <div className={styles.searchWrapper}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            className={styles.searchInput}
            placeholder="SEARCH LOCATION..."
            value={query}
            onChange={handleQueryChange}
            onKeyDown={(e) => e.key === 'Escape' && setResults([])}
          />
          {searching && <span className={styles.spinner}>◌</span>}
        </div>
        {results.length > 0 && (
          <ul className={styles.dropdown}>
            {results.map((r) => (
              <li key={r.place_id} className={styles.dropdownItem} onClick={() => handleSelect(r)}>
                <span className={styles.dropdownName}>{r.display_name.split(',').slice(0, 2).join(', ')}</span>
                <span className={styles.dropdownType}>{r.type?.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.basemapSwitcher}>
        {Object.values(BASEMAPS).map((bm) => (
          <button
            key={bm.id}
            className={`${styles.bmBtn} ${basemap === bm.id ? styles.bmActive : ''}`}
            onClick={() => onBasemapChange(bm.id)}
          >
            {bm.label}
          </button>
        ))}
      </div>

      <div className={styles.status}>
        <span className={`${styles.statusDot} ${backendOk === null ? styles.pending : backendOk ? styles.online : styles.offline}`} />
        <span className={styles.statusText}>
          {backendOk === null ? 'CONNECTING' : backendOk ? 'API ONLINE' : 'API OFFLINE'}
        </span>
      </div>
    </div>
  )
}
