"""Read-only SQLite access for collected Prism databases.

The database to read is selected per request via the ``db`` query parameter
(a filename resolved against the configured DB directory). Connections are
opened read-only and filenames are sanitised to prevent path traversal.
"""

import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import HTTPException

from prism_api.config import get_settings


def resolve_db_path(db: str | None) -> str:
    """Resolve a requested DB name to a safe absolute path within the DB dir.

    Raises ``HTTPException`` (400/404) for missing, invalid, or unknown files.
    """
    settings = get_settings()
    name = db or settings.default_db
    if not name:
        raise HTTPException(
            status_code=400,
            detail=(
                "No database specified and no default database is available. "
                "Pass ?db=<filename> (see GET /databases)."
            ),
        )

    # basename strips any directory components -> prevents path traversal.
    safe = os.path.basename(name)
    if not safe.endswith(".db"):
        raise HTTPException(status_code=400, detail="db must be a '.db' filename")

    path = os.path.join(settings.db_dir, safe)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Database not found: {safe}")
    return path


@contextmanager
def open_db(db: str | None) -> Iterator[sqlite3.Connection]:
    """Open the selected database read-only as a context manager."""
    path = resolve_db_path(db)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(
    conn: sqlite3.Connection, query: str, params: tuple = ()
) -> list[dict[str, Any]]:
    """Run a query and return all rows as a list of dicts."""
    cur = conn.execute(query, params)
    return [dict(row) for row in cur.fetchall()]


def fetch_one(
    conn: sqlite3.Connection, query: str, params: tuple = ()
) -> dict[str, Any] | None:
    """Run a query and return the first row as a dict, or ``None``."""
    cur = conn.execute(query, params)
    row = cur.fetchone()
    return dict(row) if row else None


def count_rows(conn: sqlite3.Connection, table: str) -> int:
    """Return the row count for a table, or 0 if the table is absent."""
    if not table_exists(conn, table):
        return 0
    cur = conn.execute(f"SELECT COUNT(*) FROM {table}")  # table name is internal
    return int(cur.fetchone()[0])


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", (table,)
    )
    return cur.fetchone() is not None


def to_float(value: Any) -> float | None:
    """Best-effort float conversion; returns ``None`` for empty/invalid values."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
