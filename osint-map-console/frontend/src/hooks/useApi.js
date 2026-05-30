const API = 'http://localhost:8000'

export async function fetchMarkers() {
  const res = await fetch(`${API}/api/markers`)
  if (!res.ok) throw new Error('Failed to fetch markers')
  return res.json()
}

export async function createMarker(data) {
  const res = await fetch(`${API}/api/markers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create marker')
  return res.json()
}

export async function deleteMarker(id) {
  const res = await fetch(`${API}/api/markers/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete marker')
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`)
    return res.ok
  } catch {
    return false
  }
}
