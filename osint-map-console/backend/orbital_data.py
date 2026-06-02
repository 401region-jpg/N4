"""
Stage 6 — Orbital data ingestion helper.

Sources (tried in order):
  1. CelesTrak JSON GP data for stations (metadata only — no lat/lng)
  2. Bundled sample_orbital.json (pre-computed positions + metadata)

On every call, the bundled fallback is always available so the endpoint works
even without network access. When live data succeeds, fallback positions are
merged in to provide lat/lng/altitude_km.

Data format:
  {
    "ok": bool,
    "ts": int,
    "count": int,
    "objects": [
      {
        "sat_id": str, "name": str, "norad_id": str,
        "intl_designator": str, "object_type": str,
        "operator_name": str, "country": str,
        "category": str, "purpose": str,
        "lat": float|None, "lng": float|None, "altitude_km": float|None
      }
    ]
  }
"""

import json
import os
import time
from typing import Optional

import httpx

CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json"
FALLBACK_FILE = os.path.join(os.path.dirname(__file__), "sample_orbital.json")
TIMEOUT = 15
MAX_SNAPSHOTS = 5


# ── CelesTrak normalisation ───────────────────────────────────────────────────

def _normalize_celestrak(entry: dict) -> Optional[dict]:
    norad = str(entry.get("NORAD_CAT_ID", "") or "")
    if not norad:
        return None
    return {
        "sat_id":          norad,
        "name":            (entry.get("OBJECT_NAME") or "").strip(),
        "norad_id":        norad,
        "intl_designator": (entry.get("OBJECT_ID") or "").strip(),
        "object_type":     (entry.get("OBJECT_TYPE") or "").strip(),
        "operator_name":   (entry.get("OPS_STATUS") or "").strip(),
        "country":         "",
        "category":        "",
        "purpose":         "",
        "lat":             None,
        "lng":             None,
        "altitude_km":     None,
    }


# ── Fallback loader ───────────────────────────────────────────────────────────

def _load_fallback() -> dict:
    """Return {sat_id: obj} from the bundled JSON file."""
    try:
        with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        lookup = {}
        for obj in data.get("objects", []):
            sid = obj.get("sat_id", "")
            if sid:
                lookup[sid] = obj
        return lookup
    except Exception:
        return {}


# ── Live fetch ────────────────────────────────────────────────────────────────

def _fetch_celestrak() -> list:
    """Return normalized object list from CelesTrak, or [] on failure."""
    try:
        resp = httpx.get(CELESTRAK_URL, timeout=TIMEOUT)
        resp.raise_for_status()
        raw = resp.json()
        return [obj for entry in raw if (obj := _normalize_celestrak(entry)) is not None]
    except Exception:
        return []


# ── Public entry point ────────────────────────────────────────────────────────

def fetch_orbital_data() -> dict:
    """
    Fetch orbital object data.
    Returns a dict with keys: ok, ts, count, objects.
    """
    ts = int(time.time())
    fallback = _load_fallback()
    live = _fetch_celestrak()

    if live:
        # Merge fallback positions into live metadata
        for obj in live:
            sid = obj["sat_id"]
            if sid in fallback:
                fb = fallback[sid]
                obj["lat"]         = fb.get("lat")
                obj["lng"]         = fb.get("lng")
                obj["altitude_km"] = fb.get("altitude_km")
                for k in ("operator_name", "country", "category", "purpose"):
                    if not obj.get(k):
                        obj[k] = fb.get(k, "")
        return {"ok": True, "ts": ts, "count": len(live), "objects": live}

    if fallback:
        objects = list(fallback.values())
        return {"ok": True, "ts": ts, "count": len(objects), "objects": objects}

    return {"ok": False, "error": "No orbital data source available",
            "ts": ts, "count": 0, "objects": []}


# ── Snapshot persistence ──────────────────────────────────────────────────────

def store_orbit_snapshot(conn, result: dict) -> None:
    payload = json.dumps(result["objects"])
    conn.execute(
        "INSERT INTO orbit_snapshot (fetched_at, object_count, payload) VALUES (?, ?, ?)",
        (result["ts"], result["count"], payload),
    )
    conn.execute("""
        DELETE FROM orbit_snapshot
        WHERE id NOT IN (SELECT id FROM orbit_snapshot ORDER BY fetched_at DESC LIMIT ?)
    """, (MAX_SNAPSHOTS,))
    conn.commit()


def load_latest_orbit_snapshot(conn) -> Optional[dict]:
    row = conn.execute(
        "SELECT fetched_at, object_count, payload FROM orbit_snapshot "
        "ORDER BY fetched_at DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    try:
        objects = json.loads(row["payload"])
        return {"ts": row["fetched_at"], "count": row["object_count"], "objects": objects}
    except Exception:
        return None


# ── Track persistence ─────────────────────────────────────────────────────────

def store_orbit_tracks(conn, objects: list, ts: int) -> None:
    for obj in objects:
        sat_id = obj.get("sat_id")
        lat = obj.get("lat")
        lng = obj.get("lng")
        alt_km = obj.get("altitude_km")
        if not sat_id or lat is None or lng is None:
            continue
        conn.execute(
            "INSERT INTO orbit_track (sat_id, ts, lat, lng, altitude_km) VALUES (?, ?, ?, ?, ?)",
            (sat_id, ts, lat, lng, alt_km),
        )
    conn.commit()


def load_orbital_tracks(conn, sat_id_set: Optional[set] = None) -> dict:
    """
    Return {sat_id: [[lng, lat], ...]} ordered oldest->newest.
    If sat_id_set is provided, only return tracks for those satellites.
    """
    if sat_id_set is not None and not sat_id_set:
        return {}
    if sat_id_set:
        placeholders = ",".join("?" * len(sat_id_set))
        rows = conn.execute(
            f"SELECT sat_id, lng, lat FROM orbit_track WHERE sat_id IN ({placeholders}) ORDER BY ts ASC",
            list(sat_id_set),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT sat_id, lng, lat FROM orbit_track ORDER BY ts ASC"
        ).fetchall()

    tracks: dict = {}
    for r in rows:
        tracks.setdefault(r["sat_id"], []).append([r["lng"], r["lat"]])
    return tracks
