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

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`)
    return res.ok
  } catch {
    return false
  }
}
