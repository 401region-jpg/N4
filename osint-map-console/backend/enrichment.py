"""
Stage 5.2 Patch — Aircraft enrichment cache layer.

Downloads and imports the free OpenSky aircraft database CSV for identity
enrichment (operator, owner, manufacturer, model, typecode, registration).

Source: https://opensky-network.org/datasets/metadata/aircraftDatabase.csv
License: CC BY 4.0 (OpenSky Network)
"""

import csv
import json
import sqlite3
import time
from typing import Optional
from urllib.request import urlretrieve

ENRICHMENT_URL = "https://opensky-network.org/datasets/metadata/aircraftDatabase.csv"
ENRICHMENT_TABLE = "aircraft_enrichment_cache"
IMPORT_BATCH = 500

ENRICHMENT_SCHEMA = f"""
    CREATE TABLE IF NOT EXISTS {ENRICHMENT_TABLE} (
        icao24            TEXT PRIMARY KEY,
        registration      TEXT DEFAULT '',
        operator_name     TEXT DEFAULT '',
        owner             TEXT DEFAULT '',
        manufacturer_name TEXT DEFAULT '',
        model             TEXT DEFAULT '',
        typecode          TEXT DEFAULT '',
        status            TEXT DEFAULT '',
        built             TEXT DEFAULT '',
        source            TEXT DEFAULT 'opensky-csv',
        updated_at        INTEGER DEFAULT 0,
        raw_payload       TEXT DEFAULT ''
    )
"""


def ensure_table(conn):
    conn.execute(ENRICHMENT_SCHEMA)
    conn.commit()


def download_csv(output_path: str) -> str:
    """
    Download the OpenSky aircraft database CSV.
    Returns the path to the downloaded file.
    """
    print(f"Downloading enrichment data from {ENRICHMENT_URL}...")
    try:
        urlretrieve(ENRICHMENT_URL, output_path)
        print(f"Downloaded to {output_path}")
        return output_path
    except Exception as e:
        raise RuntimeError(f"Failed to download enrichment data: {e}")


def import_csv(conn, csv_path: str) -> int:
    """
    Import a CSV file into the enrichment cache table.
    Returns the number of records imported.
    """
    count = 0
    batch = []
    now = int(time.time())
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            icao = (row.get("icao24") or "").strip().lower()
            if not icao or len(icao) < 5:
                continue
            reg = (row.get("registration") or "").strip()
            op = (row.get("operator") or "").strip() or (row.get("operatorcallsign") or "").strip()
            own = (row.get("owner") or "").strip()
            mfr = (row.get("manufacturername") or "").strip()
            mdl = (row.get("model") or "").strip()
            tc = (row.get("typecode") or "").strip()
            st = (row.get("status") or "").strip()
            built = (row.get("built") or "").strip()
            payload = json.dumps({
                k: row.get(k, "")
                for k in ("manufacturericao", "serialnumber", "linenumber",
                          "operatorcallsign", "operatoricao", "operatoriata",
                          "icaoaircrafttype", "registered", "firstflightdate")
            })
            batch.append((icao, reg, op, own, mfr, mdl, tc, st, built, now, payload))
            count += 1
            if count % IMPORT_BATCH == 0:
                _flush(conn, batch)
                batch = []
    if batch:
        _flush(conn, batch)
    conn.commit()
    return count


def _flush(conn, batch):
    conn.executemany(
        f"INSERT OR REPLACE INTO {ENRICHMENT_TABLE} "
        f"(icao24, registration, operator_name, owner, manufacturer_name, model, "
        f"typecode, status, built, updated_at, raw_payload) "
        f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        batch,
    )


def batch_load(conn, icao_set: set) -> dict:
    """
    Load enrichment cache data for a set of ICAO24 codes.
    Returns {icao24: {...enrichment_dict...}}.
    """
    if not icao_set:
        return {}
    placeholders = ",".join("?" * len(icao_set))
    rows = conn.execute(
        f"SELECT * FROM {ENRICHMENT_TABLE} WHERE icao24 IN ({placeholders})",
        list(icao_set),
    ).fetchall()
    return {r["icao24"]: dict(r) for r in rows}


def merge_into_metadata(metadata: dict, enrichment: dict) -> dict:
    """
    Merge enrichment data into an aircraft metadata dict.
    Priority: existing metadata > enrichment cache.
    Modifies metadata in-place and returns it.
    """
    field_map = {
        "operator": "operator_name",
        "owner": "owner",
        "manufacturer": "manufacturer_name",
        "model": "model",
        "registration": "registration",
    }
    for md_key, enr_key in field_map.items():
        if not metadata.get(md_key):
            metadata[md_key] = enrichment.get(enr_key, "")

    if not metadata.get("typecode"):
        metadata["typecode"] = enrichment.get("typecode", "")

    enrichment_source = enrichment.get("source", "")
    if enrichment_source:
        metadata["_enrichment_source"] = enrichment_source
    elif metadata.get("operator") or metadata.get("owner") or metadata.get("manufacturer"):
        metadata["_enrichment_source"] = metadata.get("_enrichment_source") or "metadata"

    return metadata
