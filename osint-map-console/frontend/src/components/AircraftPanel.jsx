// Stage 5 — Aircraft activity panel
// Shows: refresh button, last fetch summary, aircraft near monitored AOIs
import { useState, useCallback } from 'react'
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
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(h / 45) % 8] + ` ${Math.round(h)}°`
}

function formatAge(ts) {
  if (!ts) return 'never'
  const sec = Math.round(Date.now() / 1000 - ts)
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`
  return `${Math.floor(sec/3600)}h ago`
}

export default function AircraftPanel({
  snapshot,      // { ts, count, aircraft: [] } | null
  nearAois,      // [{ aoi_id, aoi_title, count, aircraft: [] }]
  onRefresh,     // async () => void
  onAircraftClick, // (aircraft) => void
}) {
  const [refreshing,  setRefreshing]  = useState(false)
  const [expandedAoi, setExpandedAoi] = useState(null)
  const [selectedAc,  setSelectedAc]  = useState(null)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh?.() }
    finally { setRefreshing(false) }
  }, [refreshing, onRefresh])

  const totalNear = nearAois?.reduce((s, r) => s + r.count, 0) ?? 0

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerIcon}>✈</span>
        <span className={styles.headerLabel}>AIR ACTIVITY</span>
        {snapshot && (
          <span className={styles.headerAge}>{formatAge(snapshot.ts)}</span>
        )}
      </div>

      {/* Refresh button */}
      <div className={styles.refreshRow}>
        <button
          className={`${styles.refreshBtn} ${refreshing ? styles.refreshBusy : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Fetch current aircraft from OpenSky Network"
        >
          {refreshing ? '◌ FETCHING...' : '⟳ REFRESH AIRCRAFT NOW'}
        </button>
      </div>

      {/* Snapshot summary */}
      {snapshot && (
        <div className={styles.summary}>
          <span className={styles.summaryCount}>{snapshot.count}</span>
          <span className={styles.summaryLabel}>airborne tracked</span>
          {totalNear > 0 && (
            <span className={styles.summaryAlert}>
              ⚑ {totalNear} near monitored AOIs
            </span>
          )}
        </div>
      )}

      {!snapshot && (
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
                <div
                  className={styles.aoiRow}
                  onClick={() => setExpandedAoi(expandedAoi === r.aoi_id ? null : r.aoi_id)}
                >
                  <span className={styles.aoiTitle}>{r.aoi_title}</span>
                  <span className={styles.aoiCount}>{r.count} ac</span>
                  <span className={styles.expandIcon}>{expandedAoi === r.aoi_id ? '▲' : '▼'}</span>
                </div>
                {expandedAoi === r.aoi_id && (
                  <div className={styles.acList}>
                    {r.aircraft.map((ac) => (
                      <AircraftRow
                        key={ac.icao24}
                        ac={ac}
                        selected={selectedAc === ac.icao24}
                        onClick={() => {
                          setSelectedAc(ac.icao24 === selectedAc ? null : ac.icao24)
                          onAircraftClick?.(ac)
                        }}
                      />
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
        const ac = nearAois?.flatMap(r => r.aircraft).find(a => a.icao24 === selectedAc)
          || snapshot?.aircraft?.find(a => a.icao24 === selectedAc)
        if (!ac) return null
        return (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <span className={styles.detailCall}>{ac.callsign || ac.icao24}</span>
              <button className={styles.detailClose} onClick={() => setSelectedAc(null)}>✕</button>
            </div>
            <div className={styles.detailGrid}>
              <span className={styles.dk}>ICAO24</span><span className={styles.dv}>{ac.icao24}</span>
              <span className={styles.dk}>CALLSIGN</span><span className={styles.dv}>{ac.callsign || '—'}</span>
              <span className={styles.dk}>COUNTRY</span><span className={styles.dv}>{ac.country || '—'}</span>
              <span className={styles.dk}>ALT</span><span className={styles.dv}>{formatAlt(ac.alt_m)}</span>
              <span className={styles.dk}>SPEED</span><span className={styles.dv}>{formatSpeed(ac.speed_ms)}</span>
              <span className={styles.dk}>HEADING</span><span className={styles.dv}>{formatHeading(ac.heading)}</span>
              <span className={styles.dk}>POS</span>
              <span className={styles.dv}>{ac.lat.toFixed(4)}, {ac.lng.toFixed(4)}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function AircraftRow({ ac, selected, onClick }) {
  return (
    <div
      className={`${styles.acRow} ${selected ? styles.acSelected : ''}`}
      onClick={onClick}
    >
      <span className={styles.acCall}>{ac.callsign || ac.icao24}</span>
      <span className={styles.acDetail}>
        {ac.alt_m != null ? `${Math.round(ac.alt_m / 100) * 100}m` : ''}
        {ac.heading != null ? ` ${Math.round(ac.heading)}°` : ''}
      </span>
    </div>
  )
}
