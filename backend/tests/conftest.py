"""Pytest configuration + shared fixtures.

Every test runs against a REAL SQLite database file (per CLAUDE.md §7) in
a per-test `tmp_path` directory. Migrations and seed fixtures are applied
through the normal `lifespan` path on TestClient construction, so what tests
see is exactly what production sees on a fresh boot.

Auth is stubbed via the dev-bypass token shape (`dev-<role>-<sub>-<display>`)
so we never hit Auth0 during tests. The seeded patient's `auth0_sub` is
`auth0|dev-patient-1` (see `app/seed.py`) and the caretaker's is
`auth0|dev-caretaker-1`; both match what `auth._parse_dev_token` emits.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make `backend/` importable so `from app...` works whether pytest is invoked
# from the repo root or the backend directory.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Dev-bypass + stub upstream keys so `get_settings()` doesn't blow up on
# missing-env during import. (`pydantic-settings` raises on required fields.)
os.environ.setdefault("BACKEND_DEV_AUTH_BYPASS", "true")
os.environ.setdefault("AUTH0_DOMAIN", "dev.local")
os.environ.setdefault("AUTH0_AUDIENCE", "dev-audience")
os.environ.setdefault("ELEVENLABS_API_KEY", "dev")
os.environ.setdefault("ELEVENLABS_DEFAULT_VOICE_ID", "dev")
os.environ.setdefault("LLM_API_KEY", "dev")
os.environ.setdefault("SEED_ON_STARTUP", "true")


@pytest.fixture
def db_path(tmp_path: Path) -> str:
    """Per-test SQLite file under `tmp_path`."""
    return str(tmp_path / "test.db")


@pytest.fixture
def settings_env(db_path: str, monkeypatch: pytest.MonkeyPatch):
    """Install per-test env + clear the cached `get_settings` singleton."""
    monkeypatch.setenv("SQLITE_PATH", db_path)
    monkeypatch.setenv("BACKEND_DEV_AUTH_BYPASS", "true")
    monkeypatch.setenv("SEED_ON_STARTUP", "true")
    monkeypatch.setenv("AUTH0_DOMAIN", "dev.local")
    monkeypatch.setenv("AUTH0_AUDIENCE", "dev-audience")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "dev")
    monkeypatch.setenv("ELEVENLABS_DEFAULT_VOICE_ID", "dev")
    monkeypatch.setenv("LLM_API_KEY", "dev")

    from app.config import get_settings

    get_settings.cache_clear()
    # Also clear any module-level singletons that latched onto the previous
    # settings object (rate limiter buckets, etc.).
    from app.ratelimit import default_limiter

    default_limiter.reset()
    return get_settings()


@pytest.fixture
def client(settings_env, monkeypatch: pytest.MonkeyPatch):
    """TestClient bound to a fresh app + freshly migrated + seeded DB."""
    # Fresh module-level state for app.main so lifespan runs against the
    # test's SQLITE_PATH.
    import importlib

    import app.main as main_mod

    importlib.reload(main_mod)
    from fastapi.testclient import TestClient

    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture
def patient_token() -> str:
    """Dev-bypass token matching the seeded patient row."""
    return "dev-patient-1-Alice"


@pytest.fixture
def caretaker_token() -> str:
    """Dev-bypass token matching the seeded caretaker row."""
    return "dev-caretaker-1-Carol"


@pytest.fixture
def patient_headers(patient_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {patient_token}"}


@pytest.fixture
def caretaker_headers(caretaker_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {caretaker_token}"}


@pytest.fixture
def seeded_ids(client) -> dict[str, str]:
    """Resolve the seeded patient/caretaker/face/memory/reminder IDs.

    Uses direct SQL rather than API calls so the fixture stays independent of
    the routes under test.
    """
    from app.config import get_settings
    from app.db import open_connection

    _ = get_settings()  # ensure env loaded
    conn = open_connection()
    try:
        patient = conn.execute(
            "SELECT id FROM patients WHERE auth0_sub = 'auth0|dev-patient-1'"
        ).fetchone()
        caretaker = conn.execute(
            "SELECT id FROM caretakers WHERE auth0_sub = 'auth0|dev-caretaker-1'"
        ).fetchone()
        face = conn.execute(
            "SELECT id FROM faces WHERE patient_id = ? AND lower(name) = 'sarah'",
            (patient["id"],),
        ).fetchone()
        memory = conn.execute(
            "SELECT id FROM memories WHERE face_id = ? ORDER BY id ASC LIMIT 1",
            (face["id"],),
        ).fetchone()
        reminder = conn.execute(
            "SELECT id FROM reminders WHERE patient_id = ? ORDER BY id ASC LIMIT 1",
            (patient["id"],),
        ).fetchone()
    finally:
        conn.close()
    return {
        "patient_id": str(patient["id"]),
        "caretaker_id": str(caretaker["id"]),
        "face_id": str(face["id"]),
        "memory_id": str(memory["id"]),
        "reminder_id": str(reminder["id"]),
    }
