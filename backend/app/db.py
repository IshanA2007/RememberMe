"""SQLite connection helpers.

Single-file DB at `SQLITE_PATH`. WAL mode, foreign keys on, row factory = Row.
Per-request connection via FastAPI dependency in `deps.py`.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from app.config import get_settings


def _resolve_db_path() -> Path:
    """Resolve SQLITE_PATH relative to the backend directory (parent of app/)."""
    raw = get_settings().SQLITE_PATH
    p = Path(raw)
    if not p.is_absolute():
        # backend/ is the parent of app/
        backend_dir = Path(__file__).resolve().parent.parent
        p = (backend_dir / p).resolve()
    return p


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    """Apply per-connection PRAGMAs required by the service."""
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")


def open_connection() -> sqlite3.Connection:
    """Open a new SQLite connection with pragmas and row factory applied.

    Ensures the parent directory of the DB file exists.
    """
    path = _resolve_db_path()
    os.makedirs(path.parent, exist_ok=True)
    conn = sqlite3.connect(
        str(path),
        isolation_level=None,  # autocommit; use explicit BEGIN/COMMIT when needed
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn)
    return conn


def get_connection() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: yields a connection, closes after the request."""
    conn = open_connection()
    try:
        yield conn
    finally:
        conn.close()
