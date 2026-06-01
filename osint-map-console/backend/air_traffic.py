"""
Stage 5 — Air traffic ingestion helper.

Source: OpenSky Network REST API (public, no auth for anonymous use)
  https://opensky-network.org/api/states/all
  Returns all aircraft currently tracked worldwide.
  Anonymous: max 400 states, 10 s resolution, rate-limited to ~100 req/day.

We follow the same manual-triggered pattern as Stage 4.1 (no background thread).
Backend stores the latest snapshot in-memory (last_fetch_result) AND in SQLite
so it survives uvicorn --reload.

The ingest stores aircraft as a lightweight JSON blob per refresh, keyed by
fetch timestamp. We keep only the last N snapshots to stay lean.
"""

import json
import time
from typing import Optional

import httpx

OPENSKY_URL = "https://opensky-network.org/api/states/all"
TIMEOUT     = 20   # seconds
MAX_STORED  = 3    # keep last N snapshots in DB (prevents unbounded growth)

# Column indices from OpenSky response
# https://openskynetwork.github.io/opensky-api/rest.html#response
_F_ICAO24    = 0
_F_CALLSIGN  = 1
_F_COUNTRY   = 2
_F_LON       = 5
_F_LAT       = 6
_F_ALT_BARO  = 7    # barometric altitude (m)
_F_ON_GROUND = 8
_F_VELOCITY  = 9    # m/s
_F_HEADING   = 10
_F_ALT_GEO   = 13   # geometric altitude (m)


def _normalize(sv: list) -> Optional[dict]:
    """Convert one OpenSky state vector to our internal aircraft dict."""
    try:
        lng = sv[_F_LON]
        lat = sv[_F_LAT]
        if lng is None or lat is None:
            return None
        if not (-180 <= lng <= 180) or not (-90 <= lat <= 90):
            return None

        on_ground = bool(sv[_F_ON_GROUND])
        alt = sv[_F_ALT_GEO] or sv[_F_ALT_BARO]

        return {
            "icao24":   (sv[_F_ICAO24] or "").strip().upper(),
            "callsign": (sv[_F_CALLSIGN] or "").strip(),
            "country":  (sv[_F_COUNTRY] or "").strip(),
            "lat":      round(lat, 5),
            "lng":      round(lng, 5),
            "alt_m":    round(alt, 0) if alt is not None else None,
            "speed_ms": round(sv[_F_VELOCITY], 1) if sv[_F_VELOCITY] is not None else None,
            "heading":  round(sv[_F_HEADING], 1) if sv[_F_HEADING] is not None else None,
            "on_ground": on_ground,
        }
    except Exception:
        return None


def fetch_aircraft(bbox: Optional[list] = None) -> dict:
    """
    Fetch current aircraft state from OpenSky.
    bbox = [min_lng, min_lat, max_lng, max_lat] — optional spatial filter.
    Returns {"ok": bool, "ts": int, "count": int, "aircraft": [...], "error": str|None}
    """
    params = {}
    if bbox:
        # OpenSky uses (lamin, lomin, lamax, lomax)
        params = {
            "lamin": bbox[1],
            "lomin": bbox[0],
            "lamax": bbox[3],
            "lomax": bbox[2],
        }

    try:
        resp = httpx.get(OPENSKY_URL, params=params, timeout=TIMEOUT,
                         headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
    except httpx.TimeoutException:
        return {"ok": False, "error": "OpenSky request timed out", "ts": int(time.time()),
                "count": 0, "aircraft": []}
    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"OpenSky HTTP {e.response.status_code}",
                "ts": int(time.time()), "count": 0, "aircraft": []}
    except Exception as e:
        return {"ok": False, "error": str(e), "ts": int(time.time()),
                "count": 0, "aircraft": []}

    states = data.get("states") or []
    aircraft = [a for sv in states if (a := _normalize(sv)) is not None]
    # Filter airborne only (skip ground vehicles)
    aircraft = [a for a in aircraft if not a["on_ground"]]

    return {
        "ok":       True,
        "error":    None,
        "ts":       int(time.time()),
        "count":    len(aircraft),
        "aircraft": aircraft,
    }


def store_snapshot(conn, result: dict) -> None:
    """Persist snapshot to air_snapshot table; prune old ones."""
    payload = json.dumps(result["aircraft"])
    conn.execute(
        "INSERT INTO air_snapshot (fetched_at, aircraft_count, payload) VALUES (?, ?, ?)",
        (result["ts"], result["count"], payload),
    )
    # Keep only last MAX_STORED rows
    conn.execute("""
        DELETE FROM air_snapshot
        WHERE id NOT IN (
            SELECT id FROM air_snapshot ORDER BY fetched_at DESC LIMIT ?
        )
    """, (MAX_STORED,))
    conn.commit()


def load_latest_snapshot(conn) -> Optional[dict]:
    """Load the most recent snapshot from DB."""
    row = conn.execute(
        "SELECT fetched_at, aircraft_count, payload FROM air_snapshot ORDER BY fetched_at DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    try:
        aircraft = json.loads(row["payload"])
        return {"ts": row["fetched_at"], "count": row["aircraft_count"], "aircraft": aircraft}
    except Exception:
        return None


def intersect_with_aoi(aircraft: list, aoi_list: list) -> list:
    """
    For each monitored AOI, find aircraft within a rough radius.
    Returns list of {aoi_id, aoi_title, aircraft: [...]}.
    Uses simple bounding-box check (fast, good enough for MVP).
    """
    results = []
    for aoi in aoi_list:
        if not aoi.get("monitored"):
            continue
        geom = aoi.get("geometry", {})
        bbox = _bbox_from_geometry(geom)
        if not bbox:
            continue
        # Pad bbox by ~0.5 deg (~55 km) for "near AOI"
        pad = 0.5
        min_lng, min_lat, max_lng, max_lat = (
            bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad
        )
        near = [
            a for a in aircraft
            if min_lng <= a["lng"] <= max_lng and min_lat <= a["lat"] <= max_lat
        ]
        if near:
            results.append({
                "aoi_id":    aoi["id"],
                "aoi_title": aoi["title"],
                "count":     len(near),
                "aircraft":  near,
            })
    return results


def _bbox_from_geometry(geom: dict) -> Optional[list]:
    """Minimal bbox helper (same logic as monitoring.py)."""
    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])

    def flat(c):
        if not c:
            return []
        if isinstance(c[0], (int, float)):
            return [c]
        pts = []
        for s in c:
            pts.extend(flat(s))
        return pts

    if gtype == "Point":
        pts = [coords]
    else:
        pts = flat(coords)

    if not pts:
        return None
    lngs = [p[0] for p in pts]
    lats  = [p[1] for p in pts]
    return [min(lngs), min(lats), max(lngs), max(lats)]
