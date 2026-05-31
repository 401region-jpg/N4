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
