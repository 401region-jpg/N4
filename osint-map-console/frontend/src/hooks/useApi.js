const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function apiFetch(path, options = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, options)
  } catch (e) {
    throw new Error('Network error: backend unreachable')
  }
  if (res.status === 204) return null
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const j = await res.json(); detail = j.detail || detail } catch {}
    throw new Error(detail)
  }
  return res.json()
}

export async function fetchMarkers() {
  return apiFetch('/api/markers')
}

export async function createMarker(data) {
  return apiFetch('/api/markers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateMarker(id, data) {
  return apiFetch(`/api/markers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteMarker(id) {
  return apiFetch(`/api/markers/${id}`, { method: 'DELETE' })
}

export async function exportGeoJSON() {
  let res
  try {
    res = await fetch(`${API_BASE}/api/markers/export.geojson`)
  } catch {
    throw new Error('Network error: backend unreachable')
  }
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`)
  return res.blob()
}

export async function importGeoJSON(geojsonObject) {
  return apiFetch('/api/markers/import.geojson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geojsonObject),
  })
}

// ── AOI / geometry objects (Stage 2) ────────────────────────────────────────
export async function fetchAois() {
  return apiFetch('/api/aoi')
}

export async function createAoi(data) {
  return apiFetch('/api/aoi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateAoi(id, data) {
  return apiFetch(`/api/aoi/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteAoi(id) {
  return apiFetch(`/api/aoi/${id}`, { method: 'DELETE' })
}

// ── AOI imagery snapshots / history (Stage 3) ───────────────────────────────
export async function fetchAoiImagery(aoiId) {
  return apiFetch(`/api/aoi/${aoiId}/imagery`)
}

export async function createAoiImagery(aoiId, data) {
  return apiFetch(`/api/aoi/${aoiId}/imagery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateAoiImagery(imageryId, data) {
  return apiFetch(`/api/aoi/imagery/${imageryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteAoiImagery(imageryId) {
  return apiFetch(`/api/aoi/imagery/${imageryId}`, { method: 'DELETE' })
}

// ── Monitoring + alerts (Stage 4) ───────────────────────────────────────────
export async function setAoiMonitored(aoiId, monitored) {
  return apiFetch(`/api/aoi/${aoiId}/monitor`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monitored }),
  })
}

export async function fetchAlerts() {
  return apiFetch('/api/alerts')
}

export async function reviewAlert(alertId, status, review_note = '') {
  return apiFetch(`/api/alerts/${alertId}/review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, review_note }),
  })
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`)
    return res.ok
  } catch {
    return false
  }
}

// ── Stage 4.1 — Monitoring check ────────────────────────────────────────────
export async function triggerMonitoringCheck() {
  return apiFetch('/api/monitoring/check-now', { method: 'POST' })
}

// ── Stage 5 / 5.1 — Air traffic overlay ──────────────────────────────────────
export async function refreshAirTraffic(filters = {}) {
  // filters: { alt_min, alt_max, speed_min, callsign } — all optional
  const params = new URLSearchParams()
  if (filters.alt_min  != null) params.set('alt_min',   filters.alt_min)
  if (filters.alt_max  != null) params.set('alt_max',   filters.alt_max)
  if (filters.speed_min != null) params.set('speed_min', filters.speed_min)
  if (filters.callsign)          params.set('callsign',  filters.callsign)
  const qs = params.toString()
  return apiFetch(`/api/air/refresh${qs ? '?' + qs : ''}`, { method: 'POST' })
}

export async function fetchAirLatest(params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : ''
  return apiFetch(`/api/air/latest${qs}`)
}

export async function fetchAirNearAois(padKm) {
  const qs = padKm != null ? `?pad_km=${padKm}` : ''
  return apiFetch(`/api/air/near-aois${qs}`)
}

export async function fetchAirTrails(icao24) {
  const qs = icao24 ? `?icao24=${encodeURIComponent(icao24)}` : ''
  return apiFetch(`/api/air/trails${qs}`)
}

export async function fetchAirDetail(icao24) {
  return apiFetch(`/api/air/detail/${encodeURIComponent(icao24)}`)
}

// ── Stage 6 — Orbital overlay ────────────────────────────────────────────────

export async function refreshOrbital() {
  return apiFetch('/api/orbit/refresh', { method: 'POST' })
}

export async function fetchOrbitalLatest(params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : ''
  return apiFetch(`/api/orbit/latest${qs}`)
}

export async function fetchOrbitalNearAois(padKm) {
  const qs = padKm != null ? `?pad_km=${padKm}` : ''
  return apiFetch(`/api/orbit/near-aois${qs}`)
}
