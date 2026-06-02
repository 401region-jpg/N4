"""
Stage 5 / 5.1 — Air traffic ingestion helper.

Source: OpenSky Network REST API (public, no auth for anonymous use)
  https://opensky-network.org/api/states/all

Stage 5.1 additions over MVP:
  - Per-aircraft trail history: keep last TRAIL_MAX positions per ICAO24
    stored in air_trail table (separate from snapshots).
  - Improved AOI intersection: for Polygon AOIs use a proper
    point-in-polygon test (ray-casting, no external deps). For Point AOIs
    use haversine radius check in km. For LineString AOIs use corridor bbox.
    For all others fall back to padded bbox.
  - Filter params exposed in fetch_aircraft_filtered() for UI filters
    (min/max alt, min speed, callsign substring).
"""

import json
import math
import time
from typing import Optional

import httpx

OPENSKY_URL = "https://opensky-network.org/api/states/all"
TIMEOUT      = 20    # seconds per HTTP request
MAX_STORED   = 5     # keep last N full snapshots in air_snapshot
TRAIL_MAX    = 8     # max trail points kept per aircraft (ring buffer style)
TRAIL_TTL    = 3600  # seconds — purge trail points older than this

# Column indices in OpenSky state vector
_F_ICAO24    = 0
_F_CALLSIGN  = 1
_F_COUNTRY   = 2
_F_LON       = 5
_F_LAT       = 6
_F_ALT_BARO  = 7
_F_ON_GROUND = 8
_F_VELOCITY  = 9
_F_HEADING   = 10
_F_ALT_GEO   = 13


# ── Normalisation ──────────────────────────────────────────────────────────────

def _normalize(sv: list) -> Optional[dict]:
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
            "icao24":    (sv[_F_ICAO24] or "").strip().upper(),
            "callsign":  (sv[_F_CALLSIGN] or "").strip(),
            "country":   (sv[_F_COUNTRY] or "").strip(),
            "lat":       round(lat, 5),
            "lng":       round(lng, 5),
            "alt_m":     round(alt, 0) if alt is not None else None,
            "speed_ms":  round(sv[_F_VELOCITY], 1) if sv[_F_VELOCITY] is not None else None,
            "heading":   round(sv[_F_HEADING], 1) if sv[_F_HEADING] is not None else None,
            "on_ground": on_ground,
        }
    except Exception:
        return None


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_aircraft(bbox: Optional[list] = None) -> dict:
    params = {}
    if bbox:
        params = {"lamin": bbox[1], "lomin": bbox[0], "lamax": bbox[3], "lomax": bbox[2]}
    try:
        resp = httpx.get(OPENSKY_URL, params=params, timeout=TIMEOUT,
                         headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
    except httpx.TimeoutException:
        return {"ok": False, "error": "OpenSky request timed out",
                "ts": int(time.time()), "count": 0, "aircraft": []}
    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"OpenSky HTTP {e.response.status_code}",
                "ts": int(time.time()), "count": 0, "aircraft": []}
    except Exception as e:
        return {"ok": False, "error": str(e), "ts": int(time.time()),
                "count": 0, "aircraft": []}

    states = data.get("states") or []
    aircraft = [a for sv in states if (a := _normalize(sv)) is not None]
    aircraft = [a for a in aircraft if not a["on_ground"]]  # airborne only
    return {"ok": True, "error": None, "ts": int(time.time()),
            "count": len(aircraft), "aircraft": aircraft}


def fetch_aircraft_filtered(
    alt_min: Optional[float] = None,
    alt_max: Optional[float] = None,
    speed_min: Optional[float] = None,
    callsign_contains: Optional[str] = None,
) -> dict:
    """Fetch and apply server-side light filters before returning."""
    result = fetch_aircraft()
    if not result["ok"] or not result["aircraft"]:
        return result
    ac = result["aircraft"]
    if alt_min is not None:
        ac = [a for a in ac if a["alt_m"] is not None and a["alt_m"] >= alt_min]
    if alt_max is not None:
        ac = [a for a in ac if a["alt_m"] is not None and a["alt_m"] <= alt_max]
    if speed_min is not None:
        ac = [a for a in ac if a["speed_ms"] is not None and a["speed_ms"] >= speed_min]
    if callsign_contains:
        needle = callsign_contains.upper()
        ac = [a for a in ac if needle in (a["callsign"] or a["icao24"])]
    result["aircraft"] = ac
    result["count"] = len(ac)
    return result


# ── Snapshot persistence ───────────────────────────────────────────────────────

def store_snapshot(conn, result: dict) -> None:
    payload = json.dumps(result["aircraft"])
    conn.execute(
        "INSERT INTO air_snapshot (fetched_at, aircraft_count, payload) VALUES (?, ?, ?)",
        (result["ts"], result["count"], payload),
    )
    conn.execute("""
        DELETE FROM air_snapshot
        WHERE id NOT IN (SELECT id FROM air_snapshot ORDER BY fetched_at DESC LIMIT ?)
    """, (MAX_STORED,))
    conn.commit()


def load_latest_snapshot(conn) -> Optional[dict]:
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


# ── Trail history ──────────────────────────────────────────────────────────────

def upsert_trails(conn, aircraft: list, ts: int) -> None:
    """
    Store one trail point per aircraft in air_trail.
    Keep at most TRAIL_MAX points per icao24 (ring-buffer: delete oldest excess).
    Also purge points older than TRAIL_TTL seconds.
    """
    cutoff = ts - TRAIL_TTL
    conn.execute("DELETE FROM air_trail WHERE ts < ?", (cutoff,))

    for ac in aircraft:
        icao24 = ac["icao24"]
        if not icao24:
            continue
        conn.execute(
            "INSERT INTO air_trail (icao24, ts, lat, lng, alt_m, heading) VALUES (?, ?, ?, ?, ?, ?)",
            (icao24, ts, ac["lat"], ac["lng"], ac.get("alt_m"), ac.get("heading")),
        )
        # Delete excess — keep newest TRAIL_MAX
        conn.execute("""
            DELETE FROM air_trail WHERE icao24 = ? AND id NOT IN (
                SELECT id FROM air_trail WHERE icao24 = ? ORDER BY ts DESC LIMIT ?
            )
        """, (icao24, icao24, TRAIL_MAX))

    conn.commit()


def load_trails(conn, icao24_set: Optional[set] = None) -> dict:
    """
    Return {icao24: [[lng, lat], ...]} ordered oldest→newest (for LineString).
    If icao24_set is provided, only return trails for those aircraft.
    """
    if icao24_set is not None and not icao24_set:
        return {}
    if icao24_set:
        placeholders = ",".join("?" * len(icao24_set))
        rows = conn.execute(
            f"SELECT icao24, lng, lat FROM air_trail WHERE icao24 IN ({placeholders}) ORDER BY ts ASC",
            list(icao24_set),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT icao24, lng, lat FROM air_trail ORDER BY ts ASC"
        ).fetchall()

    trails: dict = {}
    for r in rows:
        trails.setdefault(r["icao24"], []).append([r["lng"], r["lat"]])
    return trails


# ── Aircraft classification helper ──────────────────────────────────────────────


def classify_aircraft(ac: dict, metadata: dict) -> str:
    """
    Heuristic classification into one of:
      military, government, cargo, business, rotor, civilian, unknown

    Uses operator, owner, manufacturer, model, category (from metadata) and
    callsign, country (from snapshot).  Degrades gracefully when metadata is empty.
    Returns 'unknown' rather than guessing when confidence is low.
    """
    # Normalised text from every available field (metadata + snapshot)
    fields = {
        k: (metadata.get(k) or ac.get(k) or "").strip()
        for k in ("operator", "owner", "manufacturer", "model", "category",
                  "registration", "country")
    }
    callsign = (ac.get("callsign") or "").strip()
    upper_cs = callsign.upper()
    lower_cs = callsign.lower()

    txt = " ".join(v.lower() for v in fields.values() if v)

    # ── MILITARY (checked first, highest priority) ──────────────────────────
    op_lower = fields["operator"].lower()
    own_lower = fields["owner"].lower()

    # Operator / owner military keywords
    mil_op = [
        "air force", "airforce", "usaf", "raf", "luftwaffe",
        "army", "navy", "military", "marine corps", "usmc",
        "air national guard", "air mobility command",
        "ministry of defence", "ministry of defense",
        "united states air force", "united states army",
        "united states navy", "royal air force", "royal navy",
        "royal australian air force", "canadian armed forces",
        "aeronautica militare", "armee de l'air",
        "vojno", "vojvoda",
        "usaf ", "usn ", "ang ",
        "national guard", "coast guard",
        "marine corps", "marines",
    ]
    for kw in mil_op:
        if kw in op_lower or kw in own_lower:
            return "military"

    # Military callsign prefixes (used by air mobility command, tankers, etc.)
    if upper_cs.startswith(("RCH", "BMS", "MCC", "GAF", "AMC", "NAF",
                            "DUKE", "SABER", "HKY", "REACH", "STING",
                            "VIPR", "RAZR", "SNAKE", "DEMON",
                            "USAF", "USN", "USMC", "ARMY")):
        return "military"

    # Military registration markers
    reg = fields["registration"].upper()
    if any(x in reg for x in ("USAF", "US ARMY", "US NAVY", "USMC", "FAB", "FAP")):
        return "military"

    # Known state-operated military fleets via country (conservative)
    # Only applies when operator/owner are empty (so civilian airlines don't match)
    if not op_lower and not own_lower:
        c = fields["country"].upper()
        # USA has many civilian aircraft; don't auto-classify all US as military
        # Only very specific countries with mostly state-run military aviation
        if c in ("KP", "PRK"):  # North Korea — almost all state military
            return "military"

    # ── GOVERNMENT ──────────────────────────────────────────────────────────
    gov_op = [
        "government", "state", "public", "police", "customs", "border",
        "secret service", "fbi", "cia", "dea", "nsa",
        "department of", "federal", "administration",
        "search and rescue",
        "kingdom of", "ministry of",
    ]
    for kw in gov_op:
        if kw in op_lower or kw in own_lower:
            return "government"
    if "coast guard" in txt:
        return "military"

    # ── CARGO ───────────────────────────────────────────────────────────────
    cargo_op = [
        "cargo", "freight", "logistics", "express",
        "ups", "fedex", "dhl", "tnt",
    ]
    for kw in cargo_op:
        if kw in op_lower or kw in own_lower:
            return "cargo"
    cat = fields["category"].lower()
    if cat in ("cargo", "freight", "freighter", "transport"):
        return "cargo"

    # ── ROTOR ───────────────────────────────────────────────────────────────
    mfr = fields["manufacturer"].lower()
    mdl = fields["model"].lower()
    mfr_rotor = [
        "airbus helicopter", "boeing helicopter", "bell helicopter",
        "robinson", "md helicopter", "mdh",
        "enstrom", "agusta", "westland", "kamov", "mil ",
        "eurocopter",  "bell ",
        "sikorsky",  "helicopter",
    ]
    mdl_rotor = [
        "bell ", "robinson r", "sikorsky", "eurocopter", "airbus h",
        "md ", "boeing ch-", "boeing ah-", "boeing v-",
        "ch-", "ah-", "uh-", "mh-", "sh-", "ka-", "mi-",
        "ec ", "bo 105", "bk 117",
        "aw109", "aw119", "aw139", "aw169", "aw189",
        "r22", "r44", "r66", "s-76", "s-92", "s-70", "s-61",
    ]
    for kw in mfr_rotor:
        if kw in mfr:
            return "rotor"
    for kw in mdl_rotor:
        if kw in mdl:
            return "rotor"
    if cat in ("helicopter", "rotorcraft", "rotary", "heli", "rotor"):
        return "rotor"

    # ── BUSINESS / PRIVATE JET ──────────────────────────────────────────────
    mfr_biz = [
        "gulfstream", "bombardier", "dassault", "cessna",
        "learjet", "embraer", "hawker", "beechcraft",
        "pilatus", "honda jet", "cirrus", "piper", "mooney",
    ]
    mdl_biz = [
        "gulfstream", "challenger", "global express", "falcon", "learjet",
        "citation", "phenom", "legacy", "praetor", "hawker",
        "king air", "super king", "beachjet", "premier",
        "astra", "westwind", "galaxy",
        "g450", "g500", "g550", "g600", "g650", "g700",
        "cl30", "cl35", "cl60", "cl85", "bd-100", "bd-700",
        "eclipse 500", "eclipse 550",
    ]
    for kw in mfr_biz:
        if kw in mfr:
            return "business"
    for kw in mdl_biz:
        if kw in mdl:
            return "business"
    if cat in ("business jet", "business", "corporate", "executive", "bizjet", "bizliners"):
        return "business"

    # ── CIVILIAN (positive evidence only) ───────────────────────────────────
    civ_op = [
        "airlines", "airways", "airline", "aviation",
        "commercial", "air taxi", "air transport",
    ]
    for kw in civ_op:
        if kw in op_lower or kw in own_lower:
            return "civilian"
    civ_cat = {
        "passenger", "airliner", "commuter", "regional",
        "civilian", "light", "small", "medium", "utility",
        "sport", "glider", "ultralight", "trainer",
    }
    if cat in civ_cat:
        return "civilian"

    return "unknown"


def load_metadata_batch(conn, icao_set: set) -> dict:
    """
    Batch-load aircraft_metadata rows for a set of ICAO24 codes.
    Returns {icao24: {...metadata_dict...}}.
    """
    if not icao_set:
        return {}
    placeholders = ",".join("?" * len(icao_set))
    rows = conn.execute(
        f"SELECT * FROM aircraft_metadata WHERE icao24 IN ({placeholders})",
        list(icao_set),
    ).fetchall()
    return {r["icao24"]: dict(r) for r in rows}


# ── Geometry helpers ───────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lng / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _point_in_polygon(lng: float, lat: float, ring: list) -> bool:
    """
    Ray-casting point-in-polygon test.
    ring: [[lng, lat], ...] (closed or unclosed, we handle both).
    O(n), no deps.
    """
    n = len(ring)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _bbox_from_geometry(geom: dict) -> Optional[list]:
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

    pts = [coords] if gtype == "Point" else flat(coords)
    if not pts:
        return None
    lngs = [p[0] for p in pts]
    lats  = [p[1] for p in pts]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def _aircraft_near_geom(ac: dict, geom: dict, pad_km: float = 30.0) -> bool:
    """
    Improved AOI-aircraft proximity check.
    - Point AOI: haversine distance ≤ pad_km
    - Polygon AOI: ray-cast point-in-polygon on outer ring; also accept
      aircraft within pad_km/4 of the bbox edge (near but outside)
    - LineString AOI: per-segment distance ≤ pad_km (simplified corridor)
    - Fallback: padded bbox
    """
    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])
    a_lat, a_lng = ac["lat"], ac["lng"]
    pad_deg = pad_km / 111.0  # rough deg equivalent

    if gtype == "Point":
        c_lng, c_lat = coords[0], coords[1]
        return _haversine_km(a_lat, a_lng, c_lat, c_lng) <= pad_km

    if gtype == "Polygon" and coords:
        ring = coords[0]  # outer ring
        if _point_in_polygon(a_lng, a_lat, ring):
            return True
        # Also check within corridor buffer of polygon
        bbox = _bbox_from_geometry(geom)
        if bbox:
            return (bbox[0] - pad_deg / 2 <= a_lng <= bbox[2] + pad_deg / 2 and
                    bbox[1] - pad_deg / 2 <= a_lat <= bbox[3] + pad_deg / 2)
        return False

    if gtype == "LineString" and coords:
        # Check each segment: project point onto segment, compute distance
        for i in range(len(coords) - 1):
            p1_lng, p1_lat = coords[i][0],   coords[i][1]
            p2_lng, p2_lat = coords[i+1][0], coords[i+1][1]
            # Approximate: check if point is within pad_km of either endpoint
            # or within bbox of segment ± pad_deg
            seg_min_lng = min(p1_lng, p2_lng) - pad_deg
            seg_max_lng = max(p1_lng, p2_lng) + pad_deg
            seg_min_lat = min(p1_lat, p2_lat) - pad_deg
            seg_max_lat = max(p1_lat, p2_lat) + pad_deg
            if (seg_min_lng <= a_lng <= seg_max_lng and
                    seg_min_lat <= a_lat <= seg_max_lat):
                # Refine with haversine to midpoint
                mid_lat = (p1_lat + p2_lat) / 2
                mid_lng = (p1_lng + p2_lng) / 2
                if _haversine_km(a_lat, a_lng, mid_lat, mid_lng) <= pad_km * 1.5:
                    return True
        return False

    # Fallback: padded bbox
    bbox = _bbox_from_geometry(geom)
    if not bbox:
        return False
    return (bbox[0] - pad_deg <= a_lng <= bbox[2] + pad_deg and
            bbox[1] - pad_deg <= a_lat <= bbox[3] + pad_deg)


def intersect_with_aoi(aircraft: list, aoi_list: list, pad_km: float = 30.0) -> list:
    """
    Improved AOI intersection with geometry-aware checks.
    pad_km: proximity radius for Point and corridor width for Line/Polygon buffer.
    """
    results = []
    for aoi in aoi_list:
        if not aoi.get("monitored"):
            continue
        geom = aoi.get("geometry", {})
        if not geom:
            continue
        near = [a for a in aircraft if _aircraft_near_geom(a, geom, pad_km)]
        if near:
            results.append({
                "aoi_id":    aoi["id"],
                "aoi_title": aoi["title"],
                "count":     len(near),
                "aircraft":  near,
            })
    return results
