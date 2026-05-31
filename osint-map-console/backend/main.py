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
