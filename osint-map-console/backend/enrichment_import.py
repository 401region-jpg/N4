"""
Standalone script: download and import the OpenSky aircraft database CSV.

Usage:
  python enrichment_import.py                          # auto-download + import
  python enrichment_import.py --file aircraftDatabase.csv  # import existing file
  python enrichment_import.py --db /path/to/markers.db --file data.csv

Source: https://opensky-network.org/datasets/metadata/aircraftDatabase.csv
This is a free, publicly available dataset under CC BY 4.0.
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from enrichment import ensure_table, download_csv, import_csv


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Import the OpenSky aircraft database CSV into the enrichment cache."
    )
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(__file__), "markers.db"),
        help="Path to the SQLite database (default: markers.db next to this script)",
    )
    parser.add_argument(
        "--file",
        type=str,
        help="Path to an existing aircraftDatabase.csv file (omit to auto-download)",
    )
    args = parser.parse_args()

    db_path = args.db

    if args.file:
        csv_path = args.file
        print(f"Using existing file: {csv_path}")
    else:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
        csv_path = tmp.name
        tmp.close()
        try:
            download_csv(csv_path)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    import sqlite3
    conn = sqlite3.connect(db_path)
    ensure_table(conn)
    print("Importing...")
    count = import_csv(conn, csv_path)
    conn.close()
    print(f"Imported {count} enrichment records into {db_path}")

    if not args.file:
        os.unlink(csv_path)


if __name__ == "__main__":
    main()
