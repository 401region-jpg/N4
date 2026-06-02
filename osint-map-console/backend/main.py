from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Any
import sqlite3
import json
import time
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "markers.db")

ALLOWED_COLORS = {"#00ff88", "#00e5ff", "#ffcc00", "#ff3b5c", "#ff8c00", "#bf5fff"}
DEFAULT_COLOR = "#00ff88"

# Stage 2 — AOI / geometry objects.
AOI_KINDS = {"aoi", "site", "base", "airfield", "port", "depot", "checkpoint", "route", "zone", "observation"}
DEFAULT_AOI_KIND = "aoi"
GEOM_TYPES = {"Point", "LineString", "Polygon", "MultiPolygon", "MultiLineString"}

app = FastAPI(title="OSINT Map Console API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS markers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            title TEXT NOT NULL DEFAULT 'Marker',
            note TEXT DEFAULT '',
            color TEXT DEFAULT '#00ff88',
            created_at INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS aoi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT 'aoi',
            title TEXT NOT NULL DEFAULT 'AOI',
            note TEXT DEFAULT '',
            color TEXT DEFAULT '#00e5ff',
            geometry TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)
    # Stage 3 — per-AOI imagery snapshots / history.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS aoi_imagery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aoi_id INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            imagery_date TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT 'current',
            notes TEXT DEFAULT '',
            change_notes TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            FOREIGN KEY (aoi_id) REFERENCES aoi(id) ON DELETE CASCADE
        )
    """)
    # Stage 4 — monitoring + alerts.
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(aoi)").fetchall()]
    if "monitored" not in cols:
        conn.execute("ALTER TABLE aoi ADD COLUMN monitored INTEGER NOT NULL DEFAULT 0")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alert_event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aoi_id INTEGER NOT NULL,
            type TEXT NOT NULL DEFAULT 'imagery',
            status TEXT NOT NULL DEFAULT 'new',
            title TEXT NOT NULL DEFAULT '',
            details TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            reviewed_at INTEGER,
            review_note TEXT DEFAULT '',
            FOREIGN KEY (aoi_id) REFERENCES aoi(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


init_db()


class MarkerCreate(BaseModel):
    lat: float
    lng: float
    title: Optional[str] = "Marker"
    note: Optional[str] = ""
    color: Optional[str] = DEFAULT_COLOR

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, v):
        if not (-90 <= v <= 90):
            raise ValueError("lat must be between -90 and 90")
        return v

    @field_validator("lng")
    @classmethod
    def validate_lng(cls, v):
        if not (-180 <= v <= 180):
            raise ValueError("lng must be between -180 and 180")
        return v

    @model_validator(mode="after")
    def sanitize_fields(self):
        self.title = (self.title or "").strip() or "Marker"
        self.note = (self.note or "").strip()
        if self.color not in ALLOWED_COLORS:
            self.color = DEFAULT_COLOR
        return self


class MarkerUpdate(BaseModel):
    title: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None

    @model_validator(mode="after")
    def sanitize_fields(self):
        if self.title is not None:
            self.title = self.title.strip() or "Marker"
        if self.note is not None:
            self.note = self.note.strip()
        if self.color is not None and self.color not in ALLOWED_COLORS:
            self.color = DEFAULT_COLOR
        return self


@app.get("/health")
def health():
    return {"status": "ok", "service": "osint-map-console", "version": "1.1"}


@app.get("/api/markers")
def get_markers():
    conn = get_db()
    rows = conn.execute("SELECT * FROM markers ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/markers", status_code=201)
def create_marker(marker: MarkerCreate):
    conn = get_db()
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO markers (lat, lng, title, note, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (marker.lat, marker.lng, marker.title, marker.note, marker.color, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM markers WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.put("/api/markers/{marker_id}")
def update_marker(marker_id: int, data: MarkerUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM markers WHERE id = ?", (marker_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Marker not found")

    title = data.title if data.title is not None else row["title"]
    note = data.note if data.note is not None else row["note"]
    color = data.color if data.color is not None else row["color"]

    conn.execute(
        "UPDATE markers SET title = ?, note = ?, color = ? WHERE id = ?",
        (title, note, color, marker_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM markers WHERE id = ?", (marker_id,)).fetchone()
    conn.close()
    return dict(updated)


@app.delete("/api/markers/{marker_id}", status_code=204)
def delete_marker(marker_id: int):
    conn = get_db()
    result = conn.execute("DELETE FROM markers WHERE id = ?", (marker_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Marker not found")
    return None


@app.get("/api/markers/export.geojson")
def export_geojson():
    conn = get_db()
    rows = conn.execute("SELECT * FROM markers ORDER BY created_at DESC").fetchall()
    conn.close()
    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]},
            "properties": {
                "id": r["id"],
                "title": r["title"],
                "note": r["note"],
                "color": r["color"],
                "created_at": r["created_at"],
            },
        })
    geojson = {"type": "FeatureCollection", "features": features}
    return JSONResponse(content=geojson, headers={
        "Content-Disposition": "attachment; filename=markers.geojson"
    })


@app.post("/api/markers/import.geojson")
def import_geojson(body: dict):
    if body.get("type") != "FeatureCollection":
        raise HTTPException(status_code=400, detail="Expected GeoJSON FeatureCollection")

    features = body.get("features", [])
    if not isinstance(features, list):
        raise HTTPException(status_code=400, detail="features must be an array")

    conn = get_db()
    now = int(time.time())
    imported = 0
    skipped = 0

    for f in features:
        try:
            if f.get("type") != "Feature":
                skipped += 1
                continue
            geom = f.get("geometry", {})
            if geom.get("type") != "Point":
                skipped += 1
                continue
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                skipped += 1
                continue
            lng, lat = float(coords[0]), float(coords[1])
            if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                skipped += 1
                continue

            props = f.get("properties") or {}
            title = str(props.get("title", "Imported")).strip() or "Imported"
            note = str(props.get("note", "")).strip()
            color = props.get("color", DEFAULT_COLOR)
            if color not in ALLOWED_COLORS:
                color = DEFAULT_COLOR

            conn.execute(
                "INSERT INTO markers (lat, lng, title, note, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (lat, lng, title, note, color, now),
            )
            imported += 1
        except Exception:
            skipped += 1
            continue

    conn.commit()
    conn.close()
    return {"imported": imported, "skipped": skipped}


# ── AOI / geometry objects (Stage 2) ─────────────────────────────────────────

def _validate_geometry(geom: Any) -> dict:
    if not isinstance(geom, dict):
        raise ValueError("geometry must be an object")
    gtype = geom.get("type")
    if gtype not in GEOM_TYPES:
        raise ValueError(f"geometry.type must be one of {sorted(GEOM_TYPES)}")
    if not isinstance(geom.get("coordinates"), list):
        raise ValueError("geometry.coordinates must be an array")
    return {"type": gtype, "coordinates": geom["coordinates"]}


class AoiCreate(BaseModel):
    kind: Optional[str] = DEFAULT_AOI_KIND
    title: Optional[str] = "AOI"
    note: Optional[str] = ""
    color: Optional[str] = "#00e5ff"
    geometry: dict

    @model_validator(mode="after")
    def sanitize(self):
        self.kind = (self.kind or DEFAULT_AOI_KIND)
        if self.kind not in AOI_KINDS:
            self.kind = DEFAULT_AOI_KIND
        self.title = (self.title or "").strip() or "AOI"
        self.note = (self.note or "").strip()
        if self.color not in ALLOWED_COLORS:
            self.color = "#00e5ff"
        self.geometry = _validate_geometry(self.geometry)
        return self


class AoiUpdate(BaseModel):
    kind: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None
    geometry: Optional[dict] = None

    @model_validator(mode="after")
    def sanitize(self):
        if self.kind is not None and self.kind not in AOI_KINDS:
            self.kind = DEFAULT_AOI_KIND
        if self.title is not None:
            self.title = self.title.strip() or "AOI"
        if self.note is not None:
            self.note = self.note.strip()
        if self.color is not None and self.color not in ALLOWED_COLORS:
            self.color = "#00e5ff"
        if self.geometry is not None:
            self.geometry = _validate_geometry(self.geometry)
        return self


def _aoi_row_to_dict(r) -> dict:
    return {
        "id": r["id"],
        "kind": r["kind"],
        "title": r["title"],
        "note": r["note"],
        "color": r["color"],
        "geometry": json.loads(r["geometry"]),
        "monitored": bool(r["monitored"]) if "monitored" in r.keys() else False,
        "created_at": r["created_at"],
    }


@app.get("/api/aoi")
def list_aoi():
    conn = get_db()
    rows = conn.execute("SELECT * FROM aoi ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_aoi_row_to_dict(r) for r in rows]


@app.post("/api/aoi", status_code=201)
def create_aoi(aoi: AoiCreate):
    conn = get_db()
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO aoi (kind, title, note, color, geometry, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (aoi.kind, aoi.title, aoi.note, aoi.color, json.dumps(aoi.geometry), now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM aoi WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _aoi_row_to_dict(row)


@app.put("/api/aoi/{aoi_id}")
def update_aoi(aoi_id: int, data: AoiUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM aoi WHERE id = ?", (aoi_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="AOI not found")

    kind = data.kind if data.kind is not None else row["kind"]
    title = data.title if data.title is not None else row["title"]
    note = data.note if data.note is not None else row["note"]
    color = data.color if data.color is not None else row["color"]
    geometry = json.dumps(data.geometry) if data.geometry is not None else row["geometry"]

    conn.execute(
        "UPDATE aoi SET kind = ?, title = ?, note = ?, color = ?, geometry = ? WHERE id = ?",
        (kind, title, note, color, geometry, aoi_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM aoi WHERE id = ?", (aoi_id,)).fetchone()
    conn.close()
    return _aoi_row_to_dict(updated)


@app.delete("/api/aoi/{aoi_id}", status_code=204)
def delete_aoi(aoi_id: int):
    conn = get_db()
    result = conn.execute("DELETE FROM aoi WHERE id = ?", (aoi_id,))
    conn.execute("DELETE FROM aoi_imagery WHERE aoi_id = ?", (aoi_id,))
    conn.execute("DELETE FROM alert_event WHERE aoi_id = ?", (aoi_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="AOI not found")
    return None


@app.get("/api/aoi/export.geojson")
def export_aoi_geojson():
    conn = get_db()
    rows = conn.execute("SELECT * FROM aoi ORDER BY created_at DESC").fetchall()
    conn.close()
    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": json.loads(r["geometry"]),
            "properties": {
                "id": r["id"], "kind": r["kind"], "title": r["title"],
                "note": r["note"], "color": r["color"], "created_at": r["created_at"],
            },
        })
    return JSONResponse(
        content={"type": "FeatureCollection", "features": features},
        headers={"Content-Disposition": "attachment; filename=aoi.geojson"},
    )


@app.post("/api/aoi/import.geojson")
def import_aoi_geojson(body: dict):
    if body.get("type") != "FeatureCollection":
        raise HTTPException(status_code=400, detail="Expected GeoJSON FeatureCollection")
    features = body.get("features", [])
    if not isinstance(features, list):
        raise HTTPException(status_code=400, detail="features must be an array")

    conn = get_db()
    now = int(time.time())
    imported = 0
    skipped = 0
    for f in features:
        try:
            geom = _validate_geometry(f.get("geometry"))
            props = f.get("properties") or {}
            kind = props.get("kind", DEFAULT_AOI_KIND)
            if kind not in AOI_KINDS:
                kind = DEFAULT_AOI_KIND
            title = str(props.get("title", "Imported AOI")).strip() or "Imported AOI"
            note = str(props.get("note", "")).strip()
            color = props.get("color", "#00e5ff")
            if color not in ALLOWED_COLORS:
                color = "#00e5ff"
            conn.execute(
                "INSERT INTO aoi (kind, title, note, color, geometry, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (kind, title, note, color, json.dumps(geom), now),
            )
            imported += 1
        except Exception:
            skipped += 1
            continue
    conn.commit()
    conn.close()
    return {"imported": imported, "skipped": skipped}


# ── AOI imagery snapshots / history (Stage 3) ────────────────────────────────

IMAGERY_STATES = {"current", "previous"}
DEFAULT_IMAGERY_STATE = "current"


class ImageryCreate(BaseModel):
    label: Optional[str] = ""
    source: Optional[str] = ""
    imagery_date: Optional[str] = ""
    state: Optional[str] = DEFAULT_IMAGERY_STATE
    notes: Optional[str] = ""
    change_notes: Optional[str] = ""

    @model_validator(mode="after")
    def sanitize(self):
        self.label = (self.label or "").strip()
        self.source = (self.source or "").strip()
        self.imagery_date = (self.imagery_date or "").strip()
        self.notes = (self.notes or "").strip()
        self.change_notes = (self.change_notes or "").strip()
        if self.state not in IMAGERY_STATES:
            self.state = DEFAULT_IMAGERY_STATE
        return self


class ImageryUpdate(BaseModel):
    label: Optional[str] = None
    source: Optional[str] = None
    imagery_date: Optional[str] = None
    state: Optional[str] = None
    notes: Optional[str] = None
    change_notes: Optional[str] = None

    @model_validator(mode="after")
    def sanitize(self):
        if self.label is not None:
            self.label = self.label.strip()
        if self.source is not None:
            self.source = self.source.strip()
        if self.imagery_date is not None:
            self.imagery_date = self.imagery_date.strip()
        if self.notes is not None:
            self.notes = self.notes.strip()
        if self.change_notes is not None:
            self.change_notes = self.change_notes.strip()
        if self.state is not None and self.state not in IMAGERY_STATES:
            self.state = DEFAULT_IMAGERY_STATE
        return self


def _imagery_row_to_dict(r) -> dict:
    return {
        "id": r["id"],
        "aoi_id": r["aoi_id"],
        "label": r["label"],
        "source": r["source"],
        "imagery_date": r["imagery_date"],
        "state": r["state"],
        "notes": r["notes"],
        "change_notes": r["change_notes"],
        "created_at": r["created_at"],
    }


def _aoi_exists(conn, aoi_id: int) -> bool:
    return conn.execute("SELECT 1 FROM aoi WHERE id = ?", (aoi_id,)).fetchone() is not None


@app.get("/api/aoi/{aoi_id}/imagery")
def list_aoi_imagery(aoi_id: int):
    conn = get_db()
    if not _aoi_exists(conn, aoi_id):
        conn.close()
        raise HTTPException(status_code=404, detail="AOI not found")
    rows = conn.execute(
        "SELECT * FROM aoi_imagery WHERE aoi_id = ? ORDER BY imagery_date DESC, created_at DESC",
        (aoi_id,),
    ).fetchall()
    conn.close()
    return [_imagery_row_to_dict(r) for r in rows]


@app.post("/api/aoi/{aoi_id}/imagery", status_code=201)
def create_aoi_imagery(aoi_id: int, data: ImageryCreate):
    conn = get_db()
    aoi_row = conn.execute("SELECT * FROM aoi WHERE id = ?", (aoi_id,)).fetchone()
    if not aoi_row:
        conn.close()
        raise HTTPException(status_code=404, detail="AOI not found")
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO aoi_imagery (aoi_id, label, source, imagery_date, state, notes, change_notes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (aoi_id, data.label, data.source, data.imagery_date, data.state, data.notes, data.change_notes, now),
    )
    # Stage 4 — closing the loop: new imagery on a monitored AOI raises an alert.
    if aoi_row["monitored"]:
        snap = data.label or data.source or "snapshot"
        detail = f"New imagery snapshot on monitored AOI: {snap}"
        if data.imagery_date:
            detail += f" ({data.imagery_date})"
        conn.execute(
            "INSERT INTO alert_event (aoi_id, type, status, title, details, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (aoi_id, "imagery", "new", f"Imagery update — {aoi_row['title']}", detail, now),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM aoi_imagery WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _imagery_row_to_dict(row)


@app.put("/api/aoi/imagery/{imagery_id}")
def update_aoi_imagery(imagery_id: int, data: ImageryUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM aoi_imagery WHERE id = ?", (imagery_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Imagery entry not found")

    label = data.label if data.label is not None else row["label"]
    source = data.source if data.source is not None else row["source"]
    imagery_date = data.imagery_date if data.imagery_date is not None else row["imagery_date"]
    state = data.state if data.state is not None else row["state"]
    notes = data.notes if data.notes is not None else row["notes"]
    change_notes = data.change_notes if data.change_notes is not None else row["change_notes"]

    conn.execute(
        "UPDATE aoi_imagery SET label = ?, source = ?, imagery_date = ?, state = ?, notes = ?, change_notes = ? "
        "WHERE id = ?",
        (label, source, imagery_date, state, notes, change_notes, imagery_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM aoi_imagery WHERE id = ?", (imagery_id,)).fetchone()
    conn.close()
    return _imagery_row_to_dict(updated)


@app.delete("/api/aoi/imagery/{imagery_id}", status_code=204)
def delete_aoi_imagery(imagery_id: int):
    conn = get_db()
    result = conn.execute("DELETE FROM aoi_imagery WHERE id = ?", (imagery_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Imagery entry not found")
    return None


# ── Monitoring + alerts (Stage 4) ────────────────────────────────────────────

ALERT_STATUSES = {"new", "confirmed", "dismissed", "uncertain"}


class MonitorToggle(BaseModel):
    monitored: bool


class AlertCreate(BaseModel):
    aoi_id: int
    type: Optional[str] = "manual"
    title: Optional[str] = ""
    details: Optional[str] = ""

    @model_validator(mode="after")
    def sanitize(self):
        self.type = (self.type or "manual").strip() or "manual"
        self.title = (self.title or "").strip()
        self.details = (self.details or "").strip()
        return self


class AlertReview(BaseModel):
    status: str
    review_note: Optional[str] = ""

    @model_validator(mode="after")
    def sanitize(self):
        if self.status not in ALERT_STATUSES:
            raise ValueError(f"status must be one of {sorted(ALERT_STATUSES)}")
        self.review_note = (self.review_note or "").strip()
        return self


def _alert_row_to_dict(r) -> dict:
    return {
        "id": r["id"],
        "aoi_id": r["aoi_id"],
        "type": r["type"],
        "status": r["status"],
        "title": r["title"],
        "details": r["details"],
        "created_at": r["created_at"],
        "reviewed_at": r["reviewed_at"],
        "review_note": r["review_note"],
    }


@app.put("/api/aoi/{aoi_id}/monitor")
def set_aoi_monitored(aoi_id: int, data: MonitorToggle):
    conn = get_db()
    if not _aoi_exists(conn, aoi_id):
        conn.close()
        raise HTTPException(status_code=404, detail="AOI not found")
    conn.execute("UPDATE aoi SET monitored = ? WHERE id = ?", (1 if data.monitored else 0, aoi_id))
    conn.commit()
    row = conn.execute("SELECT * FROM aoi WHERE id = ?", (aoi_id,)).fetchone()
    conn.close()
    return _aoi_row_to_dict(row)


@app.get("/api/aoi/monitored")
def list_monitored_aoi():
    conn = get_db()
    rows = conn.execute("SELECT * FROM aoi WHERE monitored = 1 ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_aoi_row_to_dict(r) for r in rows]


@app.get("/api/alerts")
def list_alerts():
    conn = get_db()
    rows = conn.execute("SELECT * FROM alert_event ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_alert_row_to_dict(r) for r in rows]


@app.post("/api/alerts", status_code=201)
def create_alert(data: AlertCreate):
    conn = get_db()
    if not _aoi_exists(conn, data.aoi_id):
        conn.close()
        raise HTTPException(status_code=404, detail="AOI not found")
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO alert_event (aoi_id, type, status, title, details, created_at) "
        "VALUES (?, ?, 'new', ?, ?, ?)",
        (data.aoi_id, data.type, data.title or "Alert", data.details, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM alert_event WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _alert_row_to_dict(row)


@app.put("/api/alerts/{alert_id}/review")
def review_alert(alert_id: int, data: AlertReview):
    conn = get_db()
    row = conn.execute("SELECT * FROM alert_event WHERE id = ?", (alert_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Alert not found")
    now = int(time.time())
    conn.execute(
        "UPDATE alert_event SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?",
        (data.status, data.review_note, now, alert_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM alert_event WHERE id = ?", (alert_id,)).fetchone()
    conn.close()
    return _alert_row_to_dict(updated)


# ── Stage 4.1 — Automated monitoring check ───────────────────────────────────

from monitoring import run_monitoring_check


@app.post("/api/monitoring/check-now")
def monitoring_check_now():
    """
    Manually trigger a Sentinel-2 STAC metadata check for all monitored AOIs.
    For each monitored AOI, searches for recent scenes and auto-creates
    imagery snapshots and alert_events for any new finds.
    Returns a summary of what was checked and created.
    """
    try:
        result = run_monitoring_check(DB_PATH)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e), "checked": 0, "new_snapshots": 0, "new_alerts": 0}


# ── Stage 5 / 5.1 — Air traffic overlay ──────────────────────────────────────

from air_traffic import (
    fetch_aircraft, fetch_aircraft_filtered,
    store_snapshot, load_latest_snapshot,
    upsert_trails, load_trails,
    intersect_with_aoi,
    classify_aircraft, load_metadata_batch,
)
from enrichment import ensure_table as ensure_enrichment_table, batch_load as batch_load_enrichment, merge_into_metadata
from orbital_data import (
    fetch_orbital_data,
    store_orbit_snapshot, load_latest_orbit_snapshot,
    store_orbit_tracks, load_orbital_tracks,
)


def _init_air_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS air_snapshot (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            fetched_at     INTEGER NOT NULL,
            aircraft_count INTEGER NOT NULL DEFAULT 0,
            payload        TEXT NOT NULL DEFAULT '[]'
        )
    """)
    # Stage 5.1 — trail history table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS air_trail (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            icao24  TEXT NOT NULL,
            ts      INTEGER NOT NULL,
            lat     REAL NOT NULL,
            lng     REAL NOT NULL,
            alt_m   REAL,
            heading REAL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_air_trail_icao24 ON air_trail (icao24, ts)")
    # Stage 5.2 Patch — enrichment cache for aircraft identity
    ensure_enrichment_table(conn)
    # Stage 5.2 — optional aircraft metadata (populated via metadata_importer.py)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS aircraft_metadata (
            icao24       TEXT PRIMARY KEY,
            registration TEXT DEFAULT '',
            manufacturer TEXT DEFAULT '',
            model        TEXT DEFAULT '',
            category     TEXT DEFAULT '',
            owner        TEXT DEFAULT '',
            operator     TEXT DEFAULT ''
        )
    """)
    conn.commit()


# ── Stage 6 — Orbital tables ────────────────────────────────────────────────

def _init_orbit_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orbit_snapshot (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            fetched_at    INTEGER NOT NULL,
            object_count  INTEGER NOT NULL DEFAULT 0,
            payload       TEXT NOT NULL DEFAULT '[]'
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orbit_track (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sat_id      TEXT NOT NULL,
            ts          INTEGER NOT NULL,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            altitude_km REAL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orbit_track_sat_id ON orbit_track (sat_id, ts)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orbit_metadata (
            sat_id          TEXT PRIMARY KEY,
            name            TEXT DEFAULT '',
            norad_id        TEXT DEFAULT '',
            intl_designator TEXT DEFAULT '',
            object_type     TEXT DEFAULT '',
            operator_name   TEXT DEFAULT '',
            country         TEXT DEFAULT '',
            category        TEXT DEFAULT '',
            purpose         TEXT DEFAULT ''
        )
    """)
    conn.commit()


# Init air + orbit tables alongside markers
_db_conn_for_init = get_db()
_init_air_db(_db_conn_for_init)
_init_orbit_db(_db_conn_for_init)
_db_conn_for_init.close()


@app.post("/api/air/refresh")
def air_refresh(
    alt_min: Optional[float] = None,
    alt_max: Optional[float] = None,
    speed_min: Optional[float] = None,
    callsign: Optional[str] = None,
):
    """
    Stage 5.1: Fetch from OpenSky, store snapshot + trail points.
    Optional query-param filters: alt_min, alt_max, speed_min, callsign.
    Returns aircraft list, trail data for all aircraft, and metadata.
    """
    if any(v is not None for v in [alt_min, alt_max, speed_min, callsign]):
        result = fetch_aircraft_filtered(
            alt_min=alt_min, alt_max=alt_max,
            speed_min=speed_min, callsign_contains=callsign,
        )
    else:
        result = fetch_aircraft()

    conn = get_db()
    if result["ok"] and result["aircraft"]:
        store_snapshot(conn, result)
        upsert_trails(conn, result["aircraft"], result["ts"])

    # Classify all aircraft in the response
    if result["aircraft"]:
        icao_set = {a["icao24"] for a in result["aircraft"] if a.get("icao24")}
        meta_batch = load_metadata_batch(conn, icao_set)
        enr_batch = batch_load_enrichment(conn, icao_set)
        for a in result["aircraft"]:
            meta = meta_batch.get(a["icao24"], {})
            enr = enr_batch.get(a["icao24"], {})
            merge_into_metadata(meta, enr)
            a["_class"] = classify_aircraft(a, meta)
            if enr:
                a["_enrichment_source"] = enr.get("source", "opensky-csv")

    # Return trails for the aircraft we just fetched
    icao_set = {a["icao24"] for a in result["aircraft"]} if result["aircraft"] else set()
    trails = load_trails(conn, icao_set) if icao_set else {}
    conn.close()

    return {
        "ok":       result["ok"],
        "error":    result.get("error"),
        "ts":       result["ts"],
        "count":    result["count"],
        "aircraft": result["aircraft"],
        "trails":   trails,
    }


@app.get("/api/air/latest")
def air_latest(
    search:      Optional[str]  = None,
    category:    Optional[str]  = None,
    alt_min:     Optional[float] = None,
    alt_max:     Optional[float] = None,
    speed_min:   Optional[float] = None,
    speed_max:   Optional[float] = None,
    near_aoi_only: Optional[bool] = None,
):
    """
    Return the latest snapshot + current trails. No new OpenSky request.
    Stage 5.2: optional query-param filters applied in Python over the stored JSON payload.
    """
    conn = get_db()
    snapshot = load_latest_snapshot(conn)
    if not snapshot:
        conn.close()
        return {"ok": False, "ts": None, "count": 0, "aircraft": [], "trails": {},
                "message": "No snapshot yet — call POST /api/air/refresh first"}

    aircraft = snapshot["aircraft"]

    # Altitude filters
    if alt_min is not None:
        aircraft = [a for a in aircraft if a.get("alt_m") is not None and a["alt_m"] >= alt_min]
    if alt_max is not None:
        aircraft = [a for a in aircraft if a.get("alt_m") is not None and a["alt_m"] <= alt_max]

    # Speed filters
    if speed_min is not None:
        aircraft = [a for a in aircraft if a.get("speed_ms") is not None and a["speed_ms"] >= speed_min]
    if speed_max is not None:
        aircraft = [a for a in aircraft if a.get("speed_ms") is not None and a["speed_ms"] <= speed_max]

    # Free-text search across icao24 / callsign / country / metadata fields
    if search:
        needle = search.upper().strip()
        if needle:
            meta_rows = conn.execute(
                "SELECT icao24 FROM aircraft_metadata WHERE "
                "UPPER(registration) LIKE ? OR UPPER(manufacturer) LIKE ? OR "
                "UPPER(model) LIKE ? OR UPPER(operator) LIKE ?",
                (f"%{needle}%",) * 4
            ).fetchall()
            meta_icaos = {r["icao24"] for r in meta_rows}
            aircraft = [a for a in aircraft if
                        needle in (a.get("icao24") or "").upper() or
                        needle in (a.get("callsign") or "").upper() or
                        needle in (a.get("country") or "").upper() or
                        a["icao24"] in meta_icaos]

    # Category filter — heuristic classification, applied via _class on each aircraft
    # Pre-compute _class for ALL aircraft (also used for detail display later)
    icao_set = {a["icao24"] for a in aircraft if a.get("icao24")}
    meta_batch = load_metadata_batch(conn, icao_set)
    enr_batch = batch_load_enrichment(conn, icao_set)
    for a in aircraft:
        meta = meta_batch.get(a["icao24"], {})
        enr = enr_batch.get(a["icao24"], {})
        merge_into_metadata(meta, enr)
        a["_class"] = classify_aircraft(a, meta)
        if enr:
            a["_enrichment_source"] = enr.get("source", "opensky-csv")

    if category:
        group = category.strip().lower()
        if group != "all":
            if group == "unknown":
                aircraft = [a for a in aircraft if a["_class"] == "unknown"]
            else:
                aircraft = [a for a in aircraft if a["_class"] == group]

    # Near-AOI-only filter — reuse existing intersect_with_aoi
    if near_aoi_only:
        aoi_rows = conn.execute("SELECT * FROM aoi WHERE monitored = 1").fetchall()
        if aoi_rows and aircraft:
            aoi_list = []
            for r in aoi_rows:
                try:
                    geom = json.loads(r["geometry"])
                except Exception:
                    continue
                aoi_list.append({
                    "id": r["id"], "title": r["title"],
                    "monitored": bool(r["monitored"]), "geometry": geom,
                })
            near_results = intersect_with_aoi(aircraft, aoi_list, pad_km=30.0)
            near_icaos = set()
            for nr in near_results:
                for ac in nr["aircraft"]:
                    near_icaos.add(ac["icao24"])
            aircraft = [a for a in aircraft if a["icao24"] in near_icaos]

    icao_set = {a["icao24"] for a in aircraft}
    trails   = load_trails(conn, icao_set) if icao_set else {}
    conn.close()
    return {
        "ok":       True,
        "ts":       snapshot["ts"],
        "count":    len(aircraft),
        "aircraft": aircraft,
        "trails":   trails,
    }


@app.get("/api/air/near-aois")
def air_near_aois(pad_km: float = 30.0):
    """
    Stage 5.1: geometry-aware intersection (polygon ray-cast, haversine for points,
    corridor for lines). pad_km controls buffer size. Default 30 km.
    """
    conn = get_db()
    snapshot = load_latest_snapshot(conn)
    aoi_rows = conn.execute("SELECT * FROM aoi WHERE monitored = 1").fetchall()
    conn.close()

    if not snapshot:
        return {"ok": False, "ts": None, "results": [],
                "message": "No snapshot yet — call POST /api/air/refresh first"}

    aoi_list = []
    for r in aoi_rows:
        try:
            geom = json.loads(r["geometry"])
        except Exception:
            continue
        aoi_list.append({
            "id":        r["id"],
            "title":     r["title"],
            "monitored": bool(r["monitored"]),
            "geometry":  geom,
        })

    results = intersect_with_aoi(snapshot["aircraft"], aoi_list, pad_km=pad_km)
    return {"ok": True, "ts": snapshot["ts"], "results": results}


# ── Stage 5.2 — Detail / trail-by-ICAO / search ────────────────────────────────


@app.get("/api/air/detail/{icao24}")
def air_detail(icao24: str):
    """
    Return a single aircraft from the latest snapshot + optional metadata.
    404 if the ICAO24 is not found in the current snapshot.
    """
    icao = icao24.upper().strip()
    conn = get_db()
    snapshot = load_latest_snapshot(conn)
    if not snapshot:
        conn.close()
        raise HTTPException(status_code=404, detail="No snapshot available")

    match = None
    for a in snapshot["aircraft"]:
        if a["icao24"] == icao:
            match = a
            break
    if not match:
        conn.close()
        raise HTTPException(status_code=404, detail="Aircraft not found in latest snapshot")

    meta_row = conn.execute(
        "SELECT * FROM aircraft_metadata WHERE icao24 = ?", (icao,)
    ).fetchone()
    metadata = dict(meta_row) if meta_row else {}
    enr_row = conn.execute(
        "SELECT * FROM aircraft_enrichment_cache WHERE icao24 = ?", (icao,)
    ).fetchone()
    enrichment_data = dict(enr_row) if enr_row else {}
    merge_into_metadata(metadata, enrichment_data)
    conn.close()
    cls = classify_aircraft(match, metadata)
    return {
        "ok": True,
        "aircraft": match,
        "metadata": metadata,
        "_class": cls,
        "_enrichment_source": enrichment_data.get("source", "") if enrichment_data else "",
    }


@app.get("/api/air/trail/{icao24}")
def air_trail_single(icao24: str):
    """
    Return trail points for a single aircraft (path-param variant).
    """
    icao = icao24.upper().strip()
    conn = get_db()
    trails = load_trails(conn, {icao})
    conn.close()
    return {"ok": True, "icao24": icao, "trail": trails.get(icao, [])}


@app.get("/api/air/search")
def air_search(q: str = ""):
    """
    Free-text search across the latest snapshot (icao24, callsign, country)
    and aircraft_metadata (registration, manufacturer, model, owner, operator, category).
    Returns combined results for any match.
    """
    needle = q.strip()
    if not needle:
        return {"ok": True, "q": q, "count": 0, "results": []}

    conn = get_db()
    snapshot = load_latest_snapshot(conn)
    needle_up = needle.upper()

    # Collect matching ICAO24 codes from snapshot
    matched_icaos = set()
    if snapshot:
        for a in snapshot["aircraft"]:
            if (needle_up in (a.get("icao24") or "").upper() or
                needle_up in (a.get("callsign") or "").upper() or
                needle_up in (a.get("country") or "").upper()):
                matched_icaos.add(a["icao24"])

    # Also match against metadata fields
    like = f"%{needle}%"
    for row in conn.execute(
        "SELECT icao24 FROM aircraft_metadata WHERE "
        "registration LIKE ? OR manufacturer LIKE ? OR model LIKE ? "
        "OR owner LIKE ? OR operator LIKE ? OR category LIKE ?",
        (like,) * 6,
    ).fetchall():
        matched_icaos.add(row["icao24"])

    if not matched_icaos:
        conn.close()
        return {"ok": True, "q": q, "count": 0, "results": []}

    # Build aircraft lookup from snapshot
    ac_lookup = {}
    if snapshot:
        for a in snapshot["aircraft"]:
            ac_lookup[a["icao24"]] = a

    # Build metadata lookup
    meta_lookup = {}
    placeholders = ",".join("?" * len(matched_icaos))
    for row in conn.execute(
        f"SELECT * FROM aircraft_metadata WHERE icao24 IN ({placeholders})",
        list(matched_icaos),
    ).fetchall():
        meta_lookup[row["icao24"]] = dict(row)

    conn.close()

    results = []
    for icao in sorted(matched_icaos):
        results.append({
            "icao24":   icao,
            "aircraft": ac_lookup.get(icao),
            "metadata": meta_lookup.get(icao, {}),
        })

    return {"ok": True, "q": q, "count": len(results), "results": results}


@app.get("/api/air/trails")
def air_trails(icao24: Optional[str] = None):
    """
    Return trail data. If icao24 query param given, return that aircraft only.
    Otherwise return trails for all aircraft in the latest snapshot.
    """
    conn = get_db()
    if icao24:
        trails = load_trails(conn, {icao24.upper()})
    else:
        snapshot = load_latest_snapshot(conn)
        if snapshot:
            icao_set = {a["icao24"] for a in snapshot["aircraft"]}
            trails   = load_trails(conn, icao_set) if icao_set else {}
        else:
            trails = {}
    conn.close()
    return {"ok": True, "trails": trails}


# ── Stage 6 — Orbital overlay ─────────────────────────────────────────────────


@app.post("/api/orbit/refresh")
def orbit_refresh():
    """
    Fetch orbital object data, store snapshot + track points.
    Returns objects list and track data.
    """
    result = fetch_orbital_data()

    conn = get_db()
    if result["ok"] and result["objects"]:
        store_orbit_snapshot(conn, result)
        store_orbit_tracks(conn, result["objects"], result["ts"])
    conn.close()

    return {
        "ok":       result["ok"],
        "error":    result.get("error"),
        "ts":       result["ts"],
        "count":    result["count"],
        "objects":  result["objects"],
    }


@app.get("/api/orbit/latest")
def orbit_latest(
    search:        Optional[str]  = None,
    category:      Optional[str]  = None,
    near_aoi_only: Optional[bool] = None,
    country:       Optional[str]  = None,
    operator:      Optional[str]  = None,
):
    """
    Return the latest orbital snapshot with optional filters applied.
    No new fetch.
    """
    conn = get_db()
    snapshot = load_latest_orbit_snapshot(conn)
    if not snapshot:
        conn.close()
        return {"ok": False, "ts": None, "count": 0, "objects": [],
                "message": "No snapshot yet — call POST /api/orbit/refresh first"}

    objects = snapshot["objects"]

    # Free-text search across sat_id, name, norad_id, operator, country, purpose
    if search:
        needle = search.upper().strip()
        if needle:
            meta_rows = conn.execute(
                "SELECT sat_id FROM orbit_metadata WHERE "
                "UPPER(name) LIKE ? OR UPPER(operator_name) LIKE ? OR "
                "UPPER(country) LIKE ? OR UPPER(purpose) LIKE ?",
                (f"%{needle}%",) * 4
            ).fetchall()
            meta_sats = {r["sat_id"] for r in meta_rows}
            objects = [o for o in objects if
                        needle in (o.get("sat_id") or "").upper() or
                        needle in (o.get("name") or "").upper() or
                        needle in (o.get("norad_id") or "").upper() or
                        needle in (o.get("country") or "").upper() or
                        needle in (o.get("operator_name") or "").upper() or
                        o.get("sat_id") in meta_sats]

    # Category filter — supports quick group names and exact match
    if category:
        ORBITAL_CATEGORY_GROUPS = {
            "military":        {"military", "reconnaissance", "spy", "sigint", "early warning", "surveillance", "recon", "intelligence"},
            "reconnaissance":  {"reconnaissance", "spy", "sigint", "early warning", "surveillance", "recon", "intelligence"},
            "communications":  {"communication", "communications", "broadband", "data relay", "satellite phone", "telecom", "telecommunication"},
            "navigation":      {"navigation", "positioning", "gnss", "gps", "glonass", "galileo", "beidou"},
            "weather":         {"weather", "meteorological", "weather monitoring", "geostationary weather", "climate", "weather satellite"},
            "science":         {"science", "astronomy", "space telescope", "research", "earth observation", "land monitoring", "land imaging", "imaging", "observation", "scientific", "space station", "habitation"},
        }
        group = category.strip().lower()
        if group == "all":
            pass
        elif group == "unknown":
            known_sats = set()
            for row in conn.execute(
                "SELECT sat_id FROM orbit_metadata WHERE "
                "category IS NOT NULL AND category != '' AND category != 'unknown'"
            ).fetchall():
                known_sats.add(row["sat_id"])
            objects = [o for o in objects if
                        o.get("sat_id") not in known_sats and
                        not (o.get("category") or "")]
        elif group in ORBITAL_CATEGORY_GROUPS:
            members = ORBITAL_CATEGORY_GROUPS[group]
            objects = [o for o in objects if (o.get("category") or "").lower().strip() in members]
        else:
            objects = [o for o in objects if (o.get("category") or "").lower().strip() == group]

    # Country exact match
    if country:
        needle = country.strip().lower()
        objects = [o for o in objects if (o.get("country") or "").lower() == needle]

    # Operator exact match
    if operator:
        needle = operator.strip().lower()
        objects = [o for o in objects if (o.get("operator_name") or "").lower() == needle]

    # Near-AOI-only filter
    if near_aoi_only:
        aoi_rows = conn.execute("SELECT * FROM aoi WHERE monitored = 1").fetchall()
        if aoi_rows and objects:
            aoi_list = []
            for r in aoi_rows:
                try:
                    geom = json.loads(r["geometry"])
                except Exception:
                    continue
                aoi_list.append({
                    "id": r["id"], "title": r["title"],
                    "monitored": bool(r["monitored"]), "geometry": geom,
                })
            near_results = intersect_with_aoi(objects, aoi_list, pad_km=30.0)
            near_sats = set()
            for nr in near_results:
                for obj in nr.get("aircraft") or []:
                    near_sats.add(obj.get("sat_id") or obj.get("icao24"))
            objects = [o for o in objects if o.get("sat_id") in near_sats]

    # Load tracks for filtered objects
    sat_set = {o["sat_id"] for o in objects if o.get("sat_id")}
    tracks = load_orbital_tracks(conn, sat_set) if sat_set else {}
    conn.close()

    return {
        "ok":      True,
        "ts":      snapshot["ts"],
        "count":   len(objects),
        "objects": objects,
        "tracks":  tracks,
    }


@app.get("/api/orbit/detail/{sat_id}")
def orbit_detail(sat_id: str):
    """
    Return a single orbital object from the latest snapshot + optional metadata.
    404 if the sat_id is not found in the current snapshot.
    """
    sid = sat_id.upper().strip()
    conn = get_db()

    # Find in latest snapshot
    snapshot = load_latest_orbit_snapshot(conn)
    if not snapshot:
        conn.close()
        raise HTTPException(status_code=404, detail="No snapshot available")

    match = None
    for obj in snapshot["objects"]:
        if obj.get("sat_id") == sid:
            match = obj
            break
    if not match:
        conn.close()
        raise HTTPException(status_code=404, detail="Satellite not found in latest snapshot")

    # Optional metadata
    meta_row = conn.execute(
        "SELECT * FROM orbit_metadata WHERE sat_id = ?", (sid,)
    ).fetchone()
    metadata = dict(meta_row) if meta_row else {}
    conn.close()
    return {"ok": True, "object": match, "metadata": metadata}


@app.get("/api/orbit/near-aois")
def orbit_near_aois(pad_km: float = 30.0):
    """
    Geometry-aware intersection of orbital objects with monitored AOIs.
    """
    conn = get_db()
    snapshot = load_latest_orbit_snapshot(conn)
    aoi_rows = conn.execute("SELECT * FROM aoi WHERE monitored = 1").fetchall()
    conn.close()

    if not snapshot:
        return {"ok": False, "ts": None, "results": [],
                "message": "No snapshot yet — call POST /api/orbit/refresh first"}

    aoi_list = []
    for r in aoi_rows:
        try:
            geom = json.loads(r["geometry"])
        except Exception:
            continue
        aoi_list.append({
            "id":        r["id"],
            "title":     r["title"],
            "monitored": bool(r["monitored"]),
            "geometry":  geom,
        })

    results = intersect_with_aoi(snapshot["objects"], aoi_list, pad_km=pad_km)
    return {"ok": True, "ts": snapshot["ts"], "results": results}


@app.get("/api/orbit/search")
def orbit_search(q: str = ""):
    """
    Free-text search across the latest orbital snapshot (sat_id, name, norad_id)
    and orbit_metadata fields (name, operator_name, country, category, purpose).
    Returns combined results for any match.
    """
    needle = q.strip()
    if not needle:
        return {"ok": True, "q": q, "count": 0, "results": []}

    conn = get_db()
    snapshot = load_latest_orbit_snapshot(conn)
    needle_up = needle.upper()

    matched = set()
    if snapshot:
        for obj in snapshot["objects"]:
            if (needle_up in (obj.get("sat_id") or "").upper() or
                needle_up in (obj.get("name") or "").upper() or
                needle_up in (obj.get("norad_id") or "").upper()):
                matched.add(obj["sat_id"])

    # Also match against orbit_metadata
    like = f"%{needle}%"
    for row in conn.execute(
        "SELECT sat_id FROM orbit_metadata WHERE "
        "name LIKE ? OR operator_name LIKE ? OR country LIKE ? "
        "OR category LIKE ? OR purpose LIKE ?",
        (like,) * 5,
    ).fetchall():
        matched.add(row["sat_id"])

    if not matched:
        conn.close()
        return {"ok": True, "q": q, "count": 0, "results": []}

    # Build lookups
    obj_lookup = {}
    if snapshot:
        for obj in snapshot["objects"]:
            obj_lookup[obj["sat_id"]] = obj

    meta_lookup = {}
    placeholders = ",".join("?" * len(matched))
    for row in conn.execute(
        f"SELECT * FROM orbit_metadata WHERE sat_id IN ({placeholders})",
        list(matched),
    ).fetchall():
        meta_lookup[row["sat_id"]] = dict(row)

    conn.close()

    results = []
    for sid in sorted(matched):
        results.append({
            "sat_id":  sid,
            "object":  obj_lookup.get(sid),
            "metadata": meta_lookup.get(sid, {}),
        })

    return {"ok": True, "q": q, "count": len(results), "results": results}
