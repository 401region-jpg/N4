// Grid canvas overlay + measurement helpers — v1.4

const R = 6371000

export function haversineMeters(a, b) {
  const rad = (d) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function formatDistance(m) {
  if (m < 1000)  return `${Math.round(m)} m`
  if (m < 10000) return `${(m / 1000).toFixed(2)} km`
  return `${(m / 1000).toFixed(1)} km`
}

function getGridStep(zoom) {
  if (zoom < 2)  return 30
  if (zoom < 3)  return 20
  if (zoom < 4)  return 15
  if (zoom < 5)  return 10
  if (zoom < 7)  return 5
  if (zoom < 9)  return 2
  if (zoom < 11) return 1
  if (zoom < 13) return 0.5
  if (zoom < 15) return 0.25
  return 0.1
}

function toDMSShort(deg, isLat) {
  const abs = Math.abs(deg)
  const d   = Math.floor(abs)
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')
  return `${d}°${dir}`
}

// ── Canvas-based grid ─────────────────────────────────────────────────────────
// canvas el must be absolutely positioned over the map with pointer-events:none.
// Returns cleanup fn.
export function attachGridCanvas(map, canvas, getVisible, getCoordFmt) {
  let rafId = null

  function syncSize() {
    const mc  = map.getCanvas()
    const dpr = window.devicePixelRatio || 1
    const w   = mc.clientWidth  * dpr
    const h   = mc.clientHeight * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w
      canvas.height = h
      canvas.style.width  = mc.clientWidth  + 'px'
      canvas.style.height = mc.clientHeight + 'px'
    }
  }

  function draw() {
    syncSize()
    const ctx  = canvas.getContext('2d')
    const w    = canvas.width
    const h    = canvas.height
    ctx.clearRect(0, 0, w, h)

    if (!getVisible()) return

    const dpr    = window.devicePixelRatio || 1
    const zoom   = map.getZoom()
    const step   = getGridStep(zoom)
    const bounds = map.getBounds()
    const fmt    = getCoordFmt()

    const minLng = Math.floor(bounds.getWest()  / step) * step
    const maxLng = Math.ceil (bounds.getEast()  / step) * step
    const minLat = Math.floor(bounds.getSouth() / step) * step
    const maxLat = Math.ceil (bounds.getNorth() / step) * step

    ctx.save()
    ctx.strokeStyle = 'rgba(0,229,255,0.14)'
    ctx.lineWidth   = 0.8 * dpr
    ctx.setLineDash([5 * dpr, 5 * dpr])
    ctx.beginPath()

    for (let lng = minLng; lng <= maxLng + 1e-9; lng = +(lng + step).toFixed(9)) {
      const top = map.project([lng, bounds.getNorth()])
      const bot = map.project([lng, bounds.getSouth()])
      ctx.moveTo(top.x * dpr, top.y * dpr)
      ctx.lineTo(bot.x * dpr, bot.y * dpr)
    }
    for (let lat = minLat; lat <= maxLat + 1e-9; lat = +(lat + step).toFixed(9)) {
      const l = map.project([bounds.getWest(),  lat])
      const r = map.project([bounds.getEast(), lat])
      ctx.moveTo(l.x * dpr, l.y * dpr)
      ctx.lineTo(r.x * dpr, r.y * dpr)
    }
    ctx.stroke()
    ctx.setLineDash([])

    if (step >= 0.25) {
      ctx.fillStyle    = 'rgba(0,229,255,0.45)'
      ctx.font         = `${9 * dpr}px monospace`
      ctx.textBaseline = 'top'

      for (let lng = minLng; lng <= maxLng + 1e-9; lng = +(lng + step).toFixed(9)) {
        const pt  = map.project([lng, bounds.getNorth()])
        const lbl = fmt === 'dms' ? toDMSShort(lng, false)
          : (step < 1 ? lng.toFixed(2) : Math.round(lng)) + '°'
        ctx.fillText(lbl, pt.x * dpr + 2 * dpr, 2 * dpr)
      }

      ctx.textBaseline = 'bottom'
      for (let lat = minLat; lat <= maxLat + 1e-9; lat = +(lat + step).toFixed(9)) {
        const pt  = map.project([bounds.getWest(), lat])
        const lbl = fmt === 'dms' ? toDMSShort(lat, true)
          : (step < 1 ? lat.toFixed(2) : Math.round(lat)) + '°'
        ctx.fillText(lbl, 3 * dpr, pt.y * dpr - 2 * dpr)
      }
    }
    ctx.restore()
  }

  function schedule() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(draw)
  }

  map.on('render',  schedule)
  map.on('move',    schedule)
  map.on('zoom',    schedule)
  map.on('resize',  schedule)

  draw()

  return function cleanup() {
    if (rafId) cancelAnimationFrame(rafId)
    map.off('render',  schedule)
    map.off('move',    schedule)
    map.off('zoom',    schedule)
    map.off('resize',  schedule)
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}
