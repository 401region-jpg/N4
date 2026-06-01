// Stage 5 / 5.1 — Aircraft activity panel
// Adds: filter controls (alt, speed, callsign), trail info in detail view.
import { useState, useCallback, useMemo } from 'react'
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

// Default filter state
const DEFAULT_FILTERS = { altMin: '', altMax: '', speedMin: '', callsign: '' }

export default function AircraftPanel({
  snapshot,        // { ts, count, aircraft: [], trails: {} } | null
  nearAois,        // [{ aoi_id, aoi_title, count, aircraft: [] }]
  onRefresh,       // async (filters) => void
  onAircraftClick, // (aircraft) => void
}) {
  const [refreshing,  setRefreshing]  = useState(false)
  const [expandedAoi, setExpandedAoi] = useState(null)
  const [selectedAc,  setSelectedAc]  = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filters,     setFilters]     = useState(DEFAULT_FILTERS)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const parsedFilters = {
        alt_min:   filters.altMin   !== '' ? parseFloat(filters.altMin)   : undefined,
        alt_max:   filters.altMax   !== '' ? parseFloat(filters.altMax)   : undefined,
        speed_min: filters.speedMin !== '' ? parseFloat(filters.speedMin) : undefined,
        callsign:  filters.callsign || undefined,
      }
      await onRefresh?.(parsedFilters)
    } finally { setRefreshing(false) }
  }, [refreshing, onRefresh, filters])

  const handleFilterChange = useCallback((key, val) => {
    setFilters((prev) => ({ ...prev, [key]: val }))
  }, [])

  const clearFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const hasFilters = Object.values(filters).some(Boolean)

  // Client-side filter for display (in addition to server-side on refresh)
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
    return ac
  }, [snapshot, filters])

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
              value={filters.callsign} onChange={(e) => handleFilterChange('callsign', e.target.value.toUpperCase())} maxLength={8} />

            <label className={styles.filterLabel}>ALT MIN (m)</label>
            <input className={styles.filterInput} type="number" placeholder="0"
              value={filters.altMin} onChange={(e) => handleFilterChange('altMin', e.target.value)} min={0} max={15000} />

            <label className={styles.filterLabel}>ALT MAX (m)</label>
            <input className={styles.filterInput} type="number" placeholder="15000"
              value={filters.altMax} onChange={(e) => handleFilterChange('altMax', e.target.value)} min={0} max={15000} />

            <label className={styles.filterLabel}>SPEED MIN (m/s)</label>
            <input className={styles.filterInput} type="number" placeholder="0"
              value={filters.speedMin} onChange={(e) => handleFilterChange('speedMin', e.target.value)} min={0} max={400} />
          </div>
          <div className={styles.filterActions}>
            <button className={styles.filterClearBtn} onClick={clearFilters} disabled={!hasFilters}>
              CLEAR
            </button>
            <span className={styles.filterHint}>Filters apply on next REFRESH</span>
          </div>
        </div>
      )}

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
                        selected={selectedAc === ac.icao24}
                        hasTrail={ac.icao24 in trails}
                        onClick={() => {
                          setSelectedAc(ac.icao24 === selectedAc ? null : ac.icao24)
                          onAircraftClick?.(ac)
                        }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Selected aircraft detail */}
      {selectedAc && (() => {
        const ac = snapshot?.aircraft?.find((a) => a.icao24 === selectedAc)
        if (!ac) return null
        const trail = trails[ac.icao24]
        return (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <span className={styles.detailCall}>{ac.callsign || ac.icao24}</span>
              <button className={styles.detailClose} onClick={() => setSelectedAc(null)}>✕</button>
            </div>
            <div className={styles.detailGrid}>
              <span className={styles.dk}>ICAO24</span>  <span className={styles.dv}>{ac.icao24}</span>
              <span className={styles.dk}>CALLSIGN</span><span className={styles.dv}>{ac.callsign || '—'}</span>
              <span className={styles.dk}>COUNTRY</span> <span className={styles.dv}>{ac.country || '—'}</span>
              <span className={styles.dk}>ALT</span>     <span className={styles.dv}>{formatAlt(ac.alt_m)}</span>
              <span className={styles.dk}>SPEED</span>   <span className={styles.dv}>{formatSpeed(ac.speed_ms)}</span>
              <span className={styles.dk}>HEADING</span> <span className={styles.dv}>{formatHeading(ac.heading)}</span>
              <span className={styles.dk}>POS</span>     <span className={styles.dv}>{ac.lat.toFixed(4)}, {ac.lng.toFixed(4)}</span>
              <span className={styles.dk}>TRAIL</span>   <span className={styles.dv}>{trail ? `${trail.length} pts` : 'none'}</span>
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
