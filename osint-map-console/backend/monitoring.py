"""
Stage 4.1 — Monitoring service: auto-check monitored AOIs for fresh Sentinel-2 imagery.

Uses Element84 Earth Search STAC API (public, no key):
  https://earth-search.aws.element84.com/v1

For each monitored AOI:
  1. Compute a bbox from the geometry
  2. Search for Sentinel-2 L2A scenes newer than the latest stored imagery_date
  3. If a newer scene is found, insert an imagery snapshot + alert_event
  4. Deduplicate by (aoi_id, scene_id) to avoid duplicate inserts

Returns a summary dict with counts.
"""

import json
import time
import math
import sqlite3
from typing import Optional
import httpx

STAC_BASE = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"
SEARCH_DAYS = 30          # look back window in days
CLOUD_COVER_MAX = 60      # percent — skip extremely cloudy scenes
TIMEOUT = 20              # seconds per HTTP call


def _bbox_from_geometry(geom: dict) -> Optional[list]:
    """Return [min_lng, min_lat, max_lng, max_lat] from a GeoJSON geometry."""
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])

    def _flat_points(c, depth=0):
        if not c:
            return []
        if isinstance(c[0], (int, float)):
            return [c]
        pts = []
        for sub in c:
            pts.extend(_flat_points(sub, depth + 1))
        return pts

    if gtype == "Point":
        pts = [coords]
    else:
        pts = _flat_points(coords)

    if not pts:
        return None

    lngs = [p[0] for p in pts]
    lats  = [p[1] for p in pts]
    min_lng, max_lng = min(lngs), max(lngs)
    min_lat, max_lat = min(lats), max(lats)

    # Expand small bbox (point or tiny line) by ~0.5 degrees to get usable search area
    pad = 0.5
    if max_lng - min_lng < pad:
        min_lng -= pad / 2
        max_lng += pad / 2
    if max_lat - min_lat < pad:
        min_lat -= pad / 2
        max_lat += pad / 2

    return [
        max(-180, min_lng), max(-90, min_lat),
        min(180, max_lng),  min(90, max_lat),
    ]


def _stac_search(bbox: list, date_from: str, limit: int = 5) -> list:
    """
    POST to STAC /search.
    Returns list of STAC items sorted by datetime desc.
    Raises httpx.HTTPError on network/API failure.
    """
    payload = {
        "collections": [COLLECTION],
        "bbox": bbox,
        "datetime": f"{date_from}T00:00:00Z/..",
        "limit": limit,
        "sortby": [{"field": "datetime", "direction": "desc"}],
        "fields": {
            "include": ["id", "properties.datetime", "properties.eo:cloud_cover",
                        "properties.s2:mgrs_tile", "properties.platform"],
            "exclude": ["assets", "links"],
        },
        "query": {"eo:cloud_cover": {"lt": CLOUD_COVER_MAX}},
    }
    resp = httpx.post(
        f"{STAC_BASE}/search",
        json=payload,
        timeout=TIMEOUT,
        headers={"Accept": "application/geo+json"},
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("features", [])


def _iso_date(epoch_seconds: int) -> str:
    """Convert unix timestamp → YYYY-MM-DD."""
    import datetime
    return datetime.datetime.utcfromtimestamp(epoch_seconds).strftime("%Y-%m-%d")


def _parse_scene_date(item: dict) -> str:
    """Extract YYYY-MM-DD from STAC item datetime property."""
    dt = item.get("properties", {}).get("datetime", "")
    return dt[:10] if dt else ""


def run_monitoring_check(db_path: str) -> dict:
    """
    Main entry point.  Called from FastAPI endpoint.
    Returns summary dict.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    monitored = conn.execute(
        "SELECT * FROM aoi WHERE monitored = 1"
    ).fetchall()

    summary = {
        "checked": 0,
        "new_snapshots": 0,
        "new_alerts": 0,
        "skipped": 0,
        "errors": [],
    }

    if not monitored:
        conn.close()
        summary["message"] = "No monitored AOIs found"
        return summary

    # Date from = SEARCH_DAYS ago
    cutoff_epoch = int(time.time()) - SEARCH_DAYS * 86400
    date_from = _iso_date(cutoff_epoch)
    now = int(time.time())

    for aoi in monitored:
        aoi_id = aoi["id"]
        aoi_title = aoi["title"]
        summary["checked"] += 1

        # Parse geometry
        try:
            geom = json.loads(aoi["geometry"])
            bbox = _bbox_from_geometry(geom)
            if bbox is None:
                summary["errors"].append(f"AOI {aoi_id} ({aoi_title}): could not compute bbox")
                summary["skipped"] += 1
                continue
        except Exception as e:
            summary["errors"].append(f"AOI {aoi_id} ({aoi_title}): geometry parse error: {e}")
            summary["skipped"] += 1
            continue

        # Get latest known imagery_date for this AOI (Sentinel-2 source only)
        latest_row = conn.execute(
            """SELECT imagery_date FROM aoi_imagery
               WHERE aoi_id = ? AND source LIKE '%Sentinel%'
               ORDER BY imagery_date DESC LIMIT 1""",
            (aoi_id,),
        ).fetchone()
        latest_known = latest_row["imagery_date"] if latest_row else None

        # Search STAC
        try:
            items = _stac_search(bbox, date_from, limit=5)
        except httpx.TimeoutException:
            summary["errors"].append(f"AOI {aoi_id} ({aoi_title}): STAC request timed out")
            summary["skipped"] += 1
            continue
        except httpx.HTTPStatusError as e:
            summary["errors"].append(f"AOI {aoi_id} ({aoi_title}): STAC HTTP {e.response.status_code}")
            summary["skipped"] += 1
            continue
        except Exception as e:
            summary["errors"].append(f"AOI {aoi_id} ({aoi_title}): STAC error: {e}")
            summary["skipped"] += 1
            continue

        if not items:
            continue  # No scenes found in window — not an error, just nothing new

        # Find the newest item that is newer than latest_known
        for item in items:
            scene_id    = item.get("id", "")
            scene_date  = _parse_scene_date(item)
            cloud_cover = item.get("properties", {}).get("eo:cloud_cover", None)
            mgrs_tile   = item.get("properties", {}).get("s2:mgrs_tile", "")
            platform    = item.get("properties", {}).get("platform", "sentinel-2")

            if not scene_date:
                continue

            # Skip if not newer than what we already have
            if latest_known and scene_date <= latest_known:
                continue

            # Deduplicate: check if this scene_id is already stored for this AOI
            existing = conn.execute(
                "SELECT id FROM aoi_imagery WHERE aoi_id = ? AND label = ?",
                (aoi_id, scene_id),
            ).fetchone()
            if existing:
                continue

            # Build label and notes
            label = scene_id
            source = f"Sentinel-2 STAC / {platform}"
            notes_parts = [f"Scene: {scene_id}"]
            if mgrs_tile:
                notes_parts.append(f"MGRS tile: {mgrs_tile}")
            if cloud_cover is not None:
                notes_parts.append(f"Cloud cover: {cloud_cover:.1f}%")
            notes_parts.append(f"Bbox: {[round(x,4) for x in bbox]}")
            notes = " | ".join(notes_parts)

            # Insert imagery snapshot
            conn.execute(
                """INSERT INTO aoi_imagery
                   (aoi_id, label, source, imagery_date, state, notes, change_notes, created_at)
                   VALUES (?, ?, ?, ?, 'current', ?, '', ?)""",
                (aoi_id, label, source, scene_date, notes, now),
            )

            # Insert alert
            alert_title   = f"New Sentinel-2 scene — {aoi_title}"
            alert_details = (
                f"Scene {scene_id} dated {scene_date}"
                + (f", cloud cover {cloud_cover:.1f}%" if cloud_cover is not None else "")
                + (f", tile {mgrs_tile}" if mgrs_tile else "")
            )
            conn.execute(
                """INSERT INTO alert_event
                   (aoi_id, type, status, title, details, created_at)
                   VALUES (?, 'imagery', 'new', ?, ?, ?)""",
                (aoi_id, alert_title, alert_details, now),
            )

            summary["new_snapshots"] += 1
            summary["new_alerts"]    += 1

            # Only take the single newest qualifying scene per AOI per check
            break

    conn.commit()
    conn.close()
    return summary
