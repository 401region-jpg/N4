"""
Minimal standalone helper: import aircraft metadata from a JSON file or stdin.

Usage:
  python metadata_importer.py --file data.json
  python metadata_importer.py < data.json
  python metadata_importer.py --db /path/to/markers.db --file data.json

JSON format: array of objects, each may contain:
  icao24 (required), registration, manufacturer, model,
  category, owner, operator
"""
import json
import sqlite3
import sys
import os


def import_metadata(db_path: str, records: list) -> int:
    conn = sqlite3.connect(db_path)
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
    count = 0
    for rec in records:
        icao = (rec.get("icao24") or "").strip().upper()
        if not icao:
            continue
        category = (rec.get("category") or "").strip().lower()
        if not category:
            category = "unknown"
        conn.execute(
            "INSERT OR REPLACE INTO aircraft_metadata "
            "(icao24, registration, manufacturer, model, category, owner, operator) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                icao,
                rec.get("registration", ""),
                rec.get("manufacturer", ""),
                rec.get("model", ""),
                category,
                rec.get("owner", ""),
                rec.get("operator", ""),
            ),
        )
        count += 1
    conn.commit()
    conn.close()
    return count


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Import aircraft metadata")
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(__file__), "markers.db"),
        help="Path to the SQLite database (default: markers.db next to this script)",
    )
    parser.add_argument(
        "--file",
        type=str,
        help="JSON file to import (omit to read from stdin)",
    )
    args = parser.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            records = json.load(f)
    else:
        records = json.load(sys.stdin)

    if not isinstance(records, list):
        print("Error: expected a JSON array", file=sys.stderr)
        sys.exit(1)

    count = import_metadata(args.db, records)
    print(f"Imported {count} aircraft metadata records into {args.db}")


if __name__ == "__main__":
    main()
