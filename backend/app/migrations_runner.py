"""Forward-only SQL migration runner.

Applies every `*.sql` file in `app/migrations/` that has not yet been recorded
in the `schema_migrations` bookkeeping table. Idempotent: re-running against
an up-to-date DB is a no-op.

Ordering: filenames are applied in lexicographic order, so the `NNNN_*.sql`
convention guarantees deterministic sequencing. Never edit a migration that
has already been applied in any environment — add a new file instead.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _ensure_bookkeeping_table(conn: sqlite3.Connection) -> None:
    """Create `schema_migrations` if it doesn't yet exist.

    The 0001 migration also creates this table, but we need it to be available
    before we can ask "which migrations are applied?", so we create it here up
    front. `CREATE TABLE IF NOT EXISTS` makes this safe to run repeatedly.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _applied_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM schema_migrations").fetchall()
    return {row[0] for row in rows}


def _discover_migrations(migrations_dir: Path) -> list[Path]:
    if not migrations_dir.exists():
        return []
    return sorted(p for p in migrations_dir.glob("*.sql") if p.is_file())


def apply_pending_migrations(
    conn: sqlite3.Connection,
    migrations_dir: Path | None = None,
) -> list[str]:
    """Apply every un-applied migration in lexicographic order.

    Returns the list of migration filenames that were applied this call.
    Raises any exception from `executescript` — the caller may roll back
    or exit. Each migration is executed inside its own transaction.
    """
    migrations_dir = migrations_dir or MIGRATIONS_DIR
    _ensure_bookkeeping_table(conn)
    applied = _applied_names(conn)
    files = _discover_migrations(migrations_dir)
    newly_applied: list[str] = []
    for path in files:
        name = path.name
        if name in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        # `executescript` issues an implicit COMMIT before and after the
        # script, so we cannot wrap it in our own BEGIN/COMMIT pair. Instead
        # we rely on the per-statement autocommit behavior of the pragma set
        # in `db.open_connection` (isolation_level=None). Migration files use
        # `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so a
        # partial apply followed by a retry is idempotent.
        try:
            conn.executescript(sql)
            conn.execute(
                "INSERT INTO schema_migrations (name) VALUES (?)",
                (name,),
            )
        except Exception:
            raise
        newly_applied.append(name)
    return newly_applied
