// Stage 5 / 5.1 — Aircraft activity panel
// Adds: filter controls (alt, speed, callsign), trail info in detail view.
import { useState, useCallback, useMemo, useEffect } from 'react'
import { fetchAirDetail } from '../hooks/useApi.js'
import styles from '../styles/AircraftPanel.module.css'

function formatAlt(m) {
  if (m == null) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function formatSpeed(ms) {
  if (ms == null) return '—'
  return `${Math.round(ms * 3.6)} km/h`
}
function formatHeading(h) {
  if (h == null) return '—'
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N']
  return dirs[Math.round(h / 45) % 8] + ` ${Math.round(h)}°`
}
function formatAge(ts) {
  if (!ts) return 'never'
  const sec = Math.round(Date.now() / 1000 - ts)
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

export default function AircraftPanel({
  snapshot,        // { ts, count, aircraft: [], trails: {} } | null
  nearAois,        // [{ aoi_id, aoi_title, count, aircraft: [] }]
  onRefresh,       // async (filters, silent) => void
  onAircraftClick, // (aircraft) => void
  selectedAircraft,// object|null — currently selected aircraft
  filters,         // { altMin, altMax, speedMin, speedMax, callsign, search, category, nearAoiOnly }
  onFilterChange,  // (key, value) => void
  onClearFilters,  // () => void
  showTrails,      // bool
  onToggleTrails,  // () => void
  refreshInterval, // 'manual' | '15000' | '30000' | '60000'
  onRefreshIntervalChange, // (val) => void
}) {
  const [refreshing,   setRefreshing]   = useState(false)
  const [expandedAoi,  setExpandedAoi]  = useState(null)
  const [showFilters,  setShowFilters]  = useState(false)
  const [detailMeta,   setDetailMeta]   = useState(null)
  const [detailFetchOk, setDetailFetchOk] = useState(true)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const parsedFilters = {
        alt_min:   filters.altMin   !== '' ? parseFloat(filters.altMin)   : undefined,
        alt_max:   filters.altMax   !== '' ? parseFloat(filters.altMax)   : undefined,
        speed_min: filters.speedMin !== '' ? parseFloat(filters.speedMin) : undefined,
        speed_max: filters.speedMax !== '' ? parseFloat(filters.speedMax) : undefined,
        callsign:  filters.callsign || undefined,
        search:    filters.search   || undefined,
        category:  filters.category || undefined,
        near_aoi_only: filters.nearAoiOnly || undefined,
      }
      await onRefresh?.(parsedFilters, false)
    } finally { setRefreshing(false) }
  }, [refreshing, onRefresh, filters])

  const hasFilters = Object.values(filters).some(Boolean)

  // Client-side filter for display (backup — server already filters via GET /api/air/latest)
  const displayedAircraft = useMemo(() => {
    if (!snapshot?.aircraft) return []
    let ac = snapshot.aircraft
    if (filters.callsign) {
      const needle = filters.callsign.toUpperCase()
      ac = ac.filter((a) => (a.callsign || a.icao24).includes(needle))
    }
    if (filters.altMin !== '') ac = ac.filter((a) => a.alt_m != null && a.alt_m >= parseFloat(filters.altMin))
    if (filters.altMax !== '') ac = ac.filter((a) => a.alt_m != null && a.alt_m <= parseFloat(filters.altMax))
    if (filters.speedMin !== '') ac = ac.filter((a) => a.speed_ms != null && a.speed_ms >= parseFloat(filters.speedMin))
    if (filters.speedMax !== '') ac = ac.filter((a) => a.speed_ms != null && a.speed_ms <= parseFloat(filters.speedMax))
    if (filters.search) {
      const n = filters.search.toUpperCase()
      ac = ac.filter((a) => (a.callsign || a.icao24).toUpperCase().includes(n) || (a.country || '').toUpperCase().includes(n))
    }
    return ac
  }, [snapshot, filters])

  // Fetch metadata (registration, manufacturer, etc.) when selection changes
  useEffect(() => {
    setDetailMeta(null)
    setDetailFetchOk(true)
    if (!selectedAircraft?.icao24) return
    fetchAirDetail(selectedAircraft.icao24)
      .then((data) => setDetailMeta(data.metadata || {}))
      .catch(() => { setDetailMeta(null); setDetailFetchOk(false) })
  }, [selectedAircraft?.icao24])

  // Find the selected aircraft in the current snapshot (to get full lat/lng etc.)
  const detailAircraft = useMemo(() => {
    if (!selectedAircraft || !snapshot?.aircraft) return null
    return snapshot.aircraft.find((a) => a.icao24 === selectedAircraft.icao24) || null
  }, [selectedAircraft, snapshot?.aircraft])

  // Check if selected aircraft is near any monitored AOI
  const nearAoiTitle = useMemo(() => {
    if (!selectedAircraft || !nearAois) return null
    for (const r of nearAois) {
      if (r.aircraft.some((a) => a.icao24 === selectedAircraft.icao24)) {
        return r.aoi_title
      }
    }
    return null
  }, [selectedAircraft, nearAois])

  const totalNear = nearAois?.reduce((s, r) => s + r.count, 0) ?? 0
  const trails = snapshot?.trails || {}
  const trailCount = Object.keys(trails).length

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerIcon}>✈</span>
        <span className={styles.headerLabel}>AIR ACTIVITY</span>
        {snapshot && <span className={styles.headerAge}>{formatAge(snapshot.ts)}</span>}
      </div>

      {/* Refresh + filter toggle */}
      <div className={styles.refreshRow}>
        <button
          className={`${styles.refreshBtn} ${refreshing ? styles.refreshBusy : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Fetch current aircraft from OpenSky Network"
        >
          {refreshing ? '◌ FETCHING...' : '⟳ REFRESH NOW'}
        </button>
        <button
          className={`${styles.filterToggleBtn} ${showFilters ? styles.filterActive : ''} ${hasFilters ? styles.filterHasValues : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          title="Toggle filters"
        >
          ⊟ {hasFilters ? 'FILTERS*' : 'FILTERS'}
        </button>
      </div>

      {/* Filter controls — collapsible */}
      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterGrid}>
            <label className={styles.filterLabel}>CALLSIGN</label>
            <input className={styles.filterInput} type="text" placeholder="e.g. AFL"
              value={filters.callsign} onChange={(e) => onFilterChange('callsign', e.target.value.toUpperCase())} maxLength={8} />

            <label className={styles.filterLabel}>SEARCH</label>
            <input className={styles.filterInput} type="text" placeholder="callsign / country / icao24"
              value={filters.search} onChange={(e) => onFilterChange('search', e.target.value)} maxLength={20} />

            <label className={styles.filterLabel}>ALT MIN (m)</label>
            <input className={styles.filterInput} type="number" placeholder="0"
              value={filters.altMin} onChange={(e) => onFilterChange('altMin', e.target.value)} min={0} max={20000} />

            <label className={styles.filterLabel}>ALT MAX (m)</label>
            <input className={styles.filterInput} type="number" placeholder="15000"
              value={filters.altMax} onChange={(e) => onFilterChange('altMax', e.target.value)} min={0} max={20000} />

            <label className={styles.filterLabel}>SPEED MIN (m/s)</label>
            <input className={styles.filterInput} type="number" placeholder="0"
              value={filters.speedMin} onChange={(e) => onFilterChange('speedMin', e.target.value)} min={0} max={400} />

            <label className={styles.filterLabel}>SPEED MAX (m/s)</label>
            <input className={styles.filterInput} type="number" placeholder="300"
              value={filters.speedMax} onChange={(e) => onFilterChange('speedMax', e.target.value)} min={0} max={400} />

            <div className={styles.filterCheckRow}>
              <label className={styles.filterLabel}>NEAR AOI ONLY</label>
              <input type="checkbox" className={styles.filterCheckbox}
                checked={filters.nearAoiOnly} onChange={(e) => onFilterChange('nearAoiOnly', e.target.checked)} />
            </div>
          </div>
          {/* Category quick-group buttons — resolved via heuristic _class */}
          <div className={styles.catGroupRow}>
            {[
              { key: '',          label: 'ALL' },
              { key: 'military',  label: 'MILITARY' },
              { key: 'government',label: 'GOVERNMENT' },
              { key: 'civilian',  label: 'CIVILIAN' },
              { key: 'cargo',     label: 'CARGO' },
              { key: 'business',  label: 'BUSINESS' },
              { key: 'rotor',     label: 'ROTOR' },
              { key: 'unknown',   label: 'UNKNOWN' },
            ].map((g) => (
              <button key={g.key}
                className={`${styles.catBtn} ${(filters.category || '') === g.key ? styles.catActive : ''}`}
                onClick={() => onFilterChange('category', g.key)}>
                {g.label}
              </button>
            ))}
          </div>
          <div className={styles.filterActions}>
            <button className={styles.filterClearBtn} onClick={onClearFilters} disabled={!hasFilters}>
              CLEAR
            </button>
          </div>
        </div>
      )}

      {/* Polling + trails controls — always visible when snapshot exists */}
      {snapshot && (
        <div className={styles.pollRow}>
          <span className={styles.pollLabel}>AUTO</span>
          {['manual', '15000', '30000', '60000'].map((val) => (
            <button key={val}
              className={`${styles.pollBtn} ${refreshInterval === val ? styles.pollActive : ''}`}
              onClick={() => onRefreshIntervalChange(val)} title={
                val === 'manual' ? 'Manual only' :
                val === '15000' ? 'Refresh every 15s' :
                val === '30000' ? 'Refresh every 30s' : 'Refresh every 60s'
              }>
              {val === 'manual' ? 'MAN' : `${Math.round(parseInt(val) / 1000)}s`}
            </button>
          ))}
          <button className={`${styles.trailBtn} ${showTrails ? '' : styles.trailOff}`}
            onClick={onToggleTrails} title={showTrails ? 'Hide trails' : 'Show trails'}>
            {showTrails ? '⇒ TRAILS ON' : '⇒ TRAILS OFF'}
          </button>
        </div>
      )}

      {/* Rate-limit note */}
      <div className={styles.rateNote}>
        OpenSky data delayed up to 5 min &middot; rate limited ~10 req/60s
      </div>

      {/* Summary */}
      {snapshot ? (
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryCount}>{displayedAircraft.length}</span>
            <span className={styles.summaryLabel}>
              {hasFilters ? `filtered / ${snapshot.count} total` : 'airborne tracked'}
            </span>
          </div>
          {trailCount > 0 && (
            <span className={styles.trailBadge}>⇒ {trailCount} trails</span>
          )}
          {totalNear > 0 && (
            <span className={styles.summaryAlert}>⚑ {totalNear} near AOIs</span>
          )}
        </div>
      ) : (
        <div className={styles.empty}>
          <span>NO DATA</span>
          <span className={styles.emptyHint}>Click REFRESH to fetch aircraft</span>
        </div>
      )}

      {/* Aircraft near monitored AOIs */}
      {nearAois && nearAois.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <span>NEAR MONITORED AOIs</span>
            <span className={styles.sectionCount}>{totalNear}</span>
          </div>
          <div className={styles.aoiList}>
            {nearAois.map((r) => (
              <div key={r.aoi_id} className={styles.aoiGroup}>
                <div className={styles.aoiRow}
                  onClick={() => setExpandedAoi(expandedAoi === r.aoi_id ? null : r.aoi_id)}>
                  <span className={styles.aoiTitle}>{r.aoi_title}</span>
                  <span className={styles.aoiCount}>{r.count} ac</span>
                  <span className={styles.expandIcon}>{expandedAoi === r.aoi_id ? '▲' : '▼'}</span>
                </div>
                {expandedAoi === r.aoi_id && (
                  <div className={styles.acList}>
                    {r.aircraft.map((ac) => (
                      <AircraftRow key={ac.icao24} ac={ac}
                        selected={selectedAircraft?.icao24 === ac.icao24}
                        hasTrail={ac.icao24 in trails}
                        onClick={() => onAircraftClick?.(ac)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Selected aircraft detail */}
      {detailAircraft && (() => {
        const ac = detailAircraft
        const trail = trails[ac.icao24]
        const meta = detailMeta
        const fr24Url = `https://www.flightradar24.com/${ac.icao24}`
        const rbUrl = ac.registration
          ? `https://www.radarbox.com/data/registration/${ac.registration}`
          : `https://www.radarbox.com/data/flights/${ac.callsign || ac.icao24}`
        return (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <span className={styles.detailCall}>{ac.callsign || ac.icao24}</span>
              <button className={styles.detailClose} onClick={() => onAircraftClick?.(null)}>✕</button>
            </div>
            <div className={styles.detailGrid}>
              <span className={styles.dk}>ICAO24</span>   <span className={styles.dv}>{ac.icao24}</span>
              <span className={styles.dk}>CALLSIGN</span> <span className={styles.dv}>{ac.callsign || '—'}</span>
              <span className={styles.dk}>CLASS</span>    <span className={styles.dv}>{ac._class || 'unknown'}</span>
              <span className={styles.dk}>SOURCE</span>   <span className={styles.dv}>{ac._enrichment_source || (meta?.operator ? 'metadata' : 'none')}</span>
              <span className={styles.dk}>COUNTRY</span>  <span className={styles.dv}>{ac.country || '—'}</span>
              <span className={styles.dk}>REG</span>      <span className={styles.dv}>{meta?.registration || '—'}</span>
              <span className={styles.dk}>OPERATOR</span> <span className={styles.dv}>{meta?.operator || '—'}</span>
              <span className={styles.dk}>TYPE</span>     <span className={styles.dv}>{[meta?.manufacturer, meta?.model].filter(Boolean).join(' ') || '—'}</span>
              <span className={styles.dk}>ALT</span>      <span className={styles.dv}>{formatAlt(ac.alt_m)}</span>
              <span className={styles.dk}>SPEED</span>    <span className={styles.dv}>{formatSpeed(ac.speed_ms)}</span>
              <span className={styles.dk}>HEADING</span>  <span className={styles.dv}>{formatHeading(ac.heading)}</span>
              <span className={styles.dk}>UPDATED</span>  <span className={styles.dv}>{formatAge(snapshot?.ts)}</span>
              <span className={styles.dk}>LAT</span>      <span className={styles.dv}>{ac.lat.toFixed(4)}</span>
              <span className={styles.dk}>LNG</span>      <span className={styles.dv}>{ac.lng.toFixed(4)}</span>
              <span className={styles.dk}>AOI</span>      <span className={styles.dv}>{nearAoiTitle || 'none'}</span>
              <span className={styles.dk}>TRAIL</span>    <span className={styles.dv}>{trail ? `${trail.length} pts` : 'none'}</span>
            </div>
            {!detailFetchOk && (
              <div className={styles.detailFetchNote}>Metadata unavailable</div>
            )}
            <div className={styles.detailLinks}>
              <a className={styles.extLink} href={fr24Url} target="_blank" rel="noopener noreferrer">FLIGHTRADAR24</a>
              <a className={styles.extLink} href={rbUrl} target="_blank" rel="noopener noreferrer">RADARBOX</a>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function AircraftRow({ ac, selected, hasTrail, onClick }) {
  return (
    <div className={`${styles.acRow} ${selected ? styles.acSelected : ''}`} onClick={onClick}>
      <span className={styles.acCall}>{ac.callsign || ac.icao24}</span>
      <div className={styles.acMeta}>
        {hasTrail && <span className={styles.trailDot} title="Trail available">⇒</span>}
        <span className={styles.acDetail}>
          {ac.alt_m != null ? `${Math.round(ac.alt_m)}m` : ''}
          {ac.heading != null ? ` ${Math.round(ac.heading)}°` : ''}
        </span>
      </div>
    </div>
  )
}
