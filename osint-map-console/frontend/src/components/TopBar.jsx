import { useState, useRef } from 'react'
import { BASEMAP_IDS, BASEMAP_LABELS } from '../hooks/basemaps.js'
import styles from '../styles/TopBar.module.css'

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

export default function TopBar({
  basemap, onBasemapChange, backendOk,
  onSearch, onExport, onImport, onResetView,
  measureActive, onToggleMeasure,
  coordFormat, onToggleCoordFormat,
  measureResult,
}) {
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const debounceRef  = useRef(null)
  const fileInputRef = useRef(null)

  const doSearch = (val) => {
    clearTimeout(debounceRef.current)
    if (val.length < 3) { setResults([]); setNoResults(false); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(
          `${NOMINATIM}?q=${encodeURIComponent(val)}&format=json&limit=6&accept-language=ru,en`
        )
        const data = await res.json()
        setResults(data)
        setNoResults(data.length === 0)
      } catch {
        setResults([])
        setNoResults(false)
      } finally { setSearching(false) }
    }, 380)
  }

  const handleSelect = (r) => {
    onSearch({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), zoom: 13 })
    setQuery(r.display_name.split(',')[0])
    setResults([])
    setNoResults(false)
  }

  return (
    <div className={styles.topbar}>
      {/* Logo */}
      <div className={styles.logo}>
        <span className={styles.logoIcon}>◈</span>
        <span className={styles.logoText}>OSINT<span className={styles.logoSub}>MAP</span></span>
      </div>

      {/* Search */}
      <div className={styles.searchWrapper}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            className={styles.searchInput}
            placeholder="SEARCH LOCATION..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); doSearch(e.target.value) }}
            onKeyDown={(e) => e.key === 'Escape' && (setResults([]), setNoResults(false))}
          />
          {searching && <span className={styles.spinner}>◌</span>}
        </div>
        {(results.length > 0 || noResults) && (
          <ul className={styles.dropdown}>
            {noResults
              ? <li className={styles.dropdownEmpty}>Nothing found</li>
              : results.map((r) => (
                <li key={r.place_id} className={styles.dropdownItem} onClick={() => handleSelect(r)}>
                  <span className={styles.dropdownName}>{r.display_name.split(',').slice(0, 2).join(', ')}</span>
                  <span className={styles.dropdownType}>{r.type?.toUpperCase()}</span>
                </li>
              ))
            }
          </ul>
        )}
      </div>

      {/* Basemap */}
      <div className={styles.basemapSwitcher}>
        {BASEMAP_IDS.map((id) => (
          <button key={id}
            className={`${styles.bmBtn} ${basemap === id ? styles.bmActive : ''}`}
            onClick={() => onBasemapChange(id)}>
            {BASEMAP_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Tools row */}
      <div className={styles.tools}>
        <button className={styles.iconBtn} onClick={onResetView} title="Reset view to world">⊕</button>

        <button
          className={`${styles.toolBtn} ${measureActive ? styles.toolActive : ''}`}
          onClick={onToggleMeasure}
          title={measureActive ? 'Cancel measure (click 2 points)' : 'Measure distance'}>
          ⇹ MEASURE
        </button>

        {measureActive && measureResult && (
          <span className={styles.measureResult}>{measureResult}</span>
        )}

        <button
          className={styles.toolBtn}
          onClick={onToggleCoordFormat}
          title="Toggle decimal / DMS">
          {coordFormat === 'dms' ? 'DMS' : 'DEC'}
        </button>
      </div>

      {/* IO */}
      <div className={styles.ioButtons}>
        <button className={styles.ioBtn} onClick={onExport}>↓ EXPORT</button>
        <button className={styles.ioBtn} onClick={() => fileInputRef.current?.click()}>↑ IMPORT</button>
        <input ref={fileInputRef} type="file" accept=".geojson,.json"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
      </div>

      {/* Status */}
      <div className={styles.status}>
        <span className={`${styles.statusDot} ${
          backendOk === null ? styles.pending : backendOk ? styles.online : styles.offline}`} />
        <span className={styles.statusText}>
          {backendOk === null ? 'CONNECTING' : backendOk ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
    </div>
  )
}
