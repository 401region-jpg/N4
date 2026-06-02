// Stage 6 Batch 4 — Orbital panel with filters, refresh, tracks, and detail view.
import { useState, useCallback, useMemo } from 'react'
import styles from '../styles/OrbitalPanel.module.css'

function formatAlt(km) {
  if (km == null) return '\u2014'
  if (km >= 1000) return `${(km / 1000).toFixed(1)} Mm`
  return `${Math.round(km)} km`
}

function formatAge(ts) {
  if (!ts) return 'never'
  const sec = Math.round(Date.now() / 1000 - ts)
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

export default function OrbitalPanel({
  snapshot,        // { ts, count, objects, tracks } | null
  nearAois,        // [{ aoi_id, aoi_title, count, aircraft: [] }]
  onRefresh,       // async (filters, silent) => void
  onOrbitalClick,  // (obj) => void
  selectedOrbital, // object|null
  filters,         // { search, category, nearAoiOnly, country, operator }
  onFilterChange,  // (key, value) => void
  onClearFilters,  // () => void
  showOrbTrails,   // bool
  onToggleOrbTrails, // () => void
  refreshInterval, // 'manual' | '30000' | '60000' | '120000'
  onRefreshIntervalChange, // (val) => void
}) {
  const [refreshing,  setRefreshing]  = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const parsed = {
        search:        filters.search        || undefined,
        category:      filters.category      || undefined,
        near_aoi_only: filters.nearAoiOnly   || undefined,
        country:       filters.country       || undefined,
        operator:      filters.operator      || undefined,
      }
      await onRefresh?.(parsed, false)
    } finally { setRefreshing(false) }
  }, [refreshing, onRefresh, filters])

  const hasFilters = Object.values(filters).some(Boolean)

  const displayedObjects = useMemo(() => {
    if (!snapshot?.objects) return []
    let objs = snapshot.objects
    if (filters.search) {
      const n = filters.search.toUpperCase()
      objs = objs.filter((o) =>
        (o.sat_id || '').toUpperCase().includes(n) ||
        (o.name || '').toUpperCase().includes(n) ||
        (o.operator_name || '').toUpperCase().includes(n) ||
        (o.country || '').toUpperCase().includes(n))
    }
    if (filters.category) {
      if (filters.category === 'unknown') {
        objs = objs.filter((o) => !(o.category || ''))
      } else if (filters.category !== 'all') {
        const c = filters.category
        objs = objs.filter((o) => (o.category || '').toLowerCase() === c)
      }
    }
    if (filters.country) {
      const n = filters.country.toLowerCase()
      objs = objs.filter((o) => (o.country || '').toLowerCase().includes(n))
    }
    if (filters.operator) {
      const n = filters.operator.toLowerCase()
      objs = objs.filter((o) => (o.operator_name || '').toLowerCase().includes(n))
    }
    if (filters.nearAoiOnly) {
      const nearSet = new Set()
      ;(nearAois || []).forEach((r) => r.aircraft.forEach((a) => nearSet.add(a.sat_id || a.icao24)))
      objs = objs.filter((o) => nearSet.has(o.sat_id))
    }
    return objs
  }, [snapshot, filters, nearAois])

  const totalNear = nearAois?.reduce((s, r) => s + r.count, 0) ?? 0
  const tracks = snapshot?.tracks || {}
  const trackCount = Object.keys(tracks).length

  // Find the selected orbital object in current snapshot
  const detailObject = useMemo(() => {
    if (!selectedOrbital || !snapshot?.objects) return null
    return snapshot.objects.find((o) => o.sat_id === selectedOrbital.sat_id) || null
  }, [selectedOrbital, snapshot?.objects])

  const nearAoiTitle = useMemo(() => {
    if (!selectedOrbital || !nearAois) return null
    for (const r of nearAois) {
      if (r.aircraft.some((a) => a.sat_id === selectedOrbital.sat_id)) {
        return r.aoi_title
      }
    }
    return null
  }, [selectedOrbital, nearAois])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>&#x1F6F0;</span>
        <span className={styles.headerLabel}>ORBITAL</span>
        {snapshot && <span className={styles.headerAge}>{formatAge(snapshot.ts)}</span>}
      </div>

      <div className={styles.refreshRow}>
        <button
          className={`${styles.refreshBtn} ${refreshing ? styles.refreshBusy : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Fetch orbital object data"
        >
          {refreshing ? '\u25CC FETCHING...' : '\u21BB REFRESH NOW'}
        </button>
        <button
          className={`${styles.filterToggleBtn} ${showFilters ? styles.filterActive : ''} ${hasFilters ? styles.filterHasValues : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          title="Toggle filters"
        >
          {showFilters ? '\u229F ' : '\u229E '}{hasFilters ? 'FILTERS*' : 'FILTERS'}
        </button>
      </div>

      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterGrid}>
            <label className={styles.filterLabel}>SEARCH</label>
            <input className={styles.filterInput} type="text" placeholder="name / sat_id / operator"
              value={filters.search} onChange={(e) => onFilterChange('search', e.target.value)} maxLength={30} />

            <label className={styles.filterLabel}>COUNTRY</label>
            <input className={styles.filterInput} type="text" placeholder="e.g. US, RU, CN"
              value={filters.country} onChange={(e) => onFilterChange('country', e.target.value.toUpperCase())} maxLength={10} />

            <label className={styles.filterLabel}>OPERATOR</label>
            <input className={styles.filterInput} type="text" placeholder="e.g. NASA, SpaceX"
              value={filters.operator} onChange={(e) => onFilterChange('operator', e.target.value)} maxLength={30} />

            <div className={styles.filterCheckRow}>
              <label className={styles.filterLabel}>NEAR AOI ONLY</label>
              <input type="checkbox" className={styles.filterCheckbox}
                checked={filters.nearAoiOnly} onChange={(e) => onFilterChange('nearAoiOnly', e.target.checked)} />
            </div>
          </div>

          <div className={styles.catGroupRow}>
            {[
              { key: '',          label: 'ALL' },
              { key: 'military',  label: 'MIL' },
              { key: 'reconnaissance', label: 'RECON' },
              { key: 'communications', label: 'COMMS' },
              { key: 'navigation',label: 'NAV' },
              { key: 'weather',   label: 'WEATHER' },
              { key: 'science',   label: 'SCIENCE' },
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

      {snapshot && (
        <div className={styles.pollRow}>
          <span className={styles.pollLabel}>AUTO</span>
          {['manual', '30000', '60000', '120000'].map((val) => (
            <button key={val}
              className={`${styles.pollBtn} ${refreshInterval === val ? styles.pollActive : ''}`}
              onClick={() => onRefreshIntervalChange(val)} title={
                val === 'manual' ? 'Manual only' :
                val === '30000'  ? 'Refresh every 30s' :
                val === '60000'  ? 'Refresh every 60s' : 'Refresh every 120s'
              }>
              {val === 'manual' ? 'MAN' : `${Math.round(parseInt(val) / 1000)}s`}
            </button>
          ))}
          <button className={`${styles.trailBtn} ${showOrbTrails ? '' : styles.trailOff}`}
            onClick={onToggleOrbTrails} title={showOrbTrails ? 'Hide tracks' : 'Show tracks'}>
            {showOrbTrails ? '\u21D2 TRACKS ON' : '\u21D2 TRACKS OFF'}
          </button>
        </div>
      )}

      <div className={styles.rateNote}>
        Limited sample data {'\u2014'} live orbital propagation not yet implemented
      </div>

      {snapshot ? (
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryCount}>{displayedObjects.length}</span>
            <span className={styles.summaryLabel}>
              {hasFilters ? `filtered / ${snapshot.count} total` : 'orbital objects'}
            </span>
          </div>
          {trackCount > 0 && (
            <span className={styles.trailBadge}>{'\u21D2'} {trackCount} tracks</span>
          )}
          {totalNear > 0 && (
            <span className={styles.summaryAlert}>&#x2691; {totalNear} near AOIs</span>
          )}
        </div>
      ) : (
        <div className={styles.empty}>
          <span>NO DATA</span>
          <span className={styles.emptyHint}>Click REFRESH to fetch orbital data</span>
        </div>
      )}

      {nearAois && nearAois.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <span>NEAR MONITORED AOIs</span>
            <span className={styles.sectionCount}>{totalNear}</span>
          </div>
          <div className={styles.aoiList}>
            {nearAois.map((r) => (
              <div key={r.aoi_id} className={styles.aoiGroup}>
                <div className={styles.aoiRow}>
                  <span className={styles.aoiTitle}>{r.aoi_title}</span>
                  <span className={styles.aoiCount}>{r.count} obj</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {detailObject && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <span className={styles.detailName}>{detailObject.name || detailObject.sat_id}</span>
            <button className={styles.detailClose} onClick={() => onOrbitalClick?.(null)}>&#x2715;</button>
          </div>
          <div className={styles.detailGrid}>
            <span className={styles.dk}>SAT ID</span>   <span className={styles.dv}>{detailObject.sat_id || '\u2014'}</span>
            <span className={styles.dk}>NORAD</span>    <span className={styles.dv}>{detailObject.norad_id || '\u2014'}</span>
            <span className={styles.dk}>INTL</span>     <span className={styles.dv}>{detailObject.intl_designator || '\u2014'}</span>
            <span className={styles.dk}>TYPE</span>     <span className={styles.dv}>{detailObject.object_type || '\u2014'}</span>
            <span className={styles.dk}>OPERATOR</span> <span className={styles.dv}>{detailObject.operator_name || '\u2014'}</span>
            <span className={styles.dk}>COUNTRY</span>  <span className={styles.dv}>{detailObject.country || '\u2014'}</span>
            <span className={styles.dk}>CATEGORY</span> <span className={styles.dv}>{detailObject.category || '\u2014'}</span>
            <span className={styles.dk}>PURPOSE</span>  <span className={styles.dv}>{detailObject.purpose || '\u2014'}</span>
            <span className={styles.dk}>ALT</span>      <span className={styles.dv}>{formatAlt(detailObject.altitude_km)}</span>
            <span className={styles.dk}>LAT</span>      <span className={styles.dv}>{(detailObject.lat != null) ? detailObject.lat.toFixed(4) : '\u2014'}</span>
            <span className={styles.dk}>LNG</span>      <span className={styles.dv}>{(detailObject.lng != null) ? detailObject.lng.toFixed(4) : '\u2014'}</span>
            <span className={styles.dk}>AOI</span>      <span className={styles.dv}>{nearAoiTitle || 'none'}</span>
            <span className={styles.dk}>TRACK</span>    <span className={styles.dv}>{(tracks[detailObject.sat_id]?.length || 0) > 0 ? `${tracks[detailObject.sat_id].length} pts` : 'none'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
