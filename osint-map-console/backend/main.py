from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
import time
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "markers.db")

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
    color: Optional[str] = "#00ff88"


class MarkerOut(BaseModel):
    id: int
    lat: float
    lng: float
    title: str
    note: str
    color: str
    created_at: int


@app.get("/health")
def health():
    return {"status": "ok", "service": "osint-map-console"}


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


@app.delete("/api/markers/{marker_id}", status_code=204)
def delete_marker(marker_id: int):
    conn = get_db()
    result = conn.execute("DELETE FROM markers WHERE id = ?", (marker_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Marker not found")
    return None
