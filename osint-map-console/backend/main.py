from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
import sqlite3
import time
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "markers.db")

ALLOWED_COLORS = {"#00ff88", "#00e5ff", "#ffcc00", "#ff3b5c", "#ff8c00", "#bf5fff"}
DEFAULT_COLOR = "#00ff88"

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
