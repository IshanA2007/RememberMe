"""Smoke tests for `/api/patients/{id}/reminders` + `/api/reminders/{id}` (API_SPEC §5)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _future_iso(minutes: int) -> str:
    """ISO 8601 UTC timestamp `now + minutes`, `Z` suffix."""
    dt = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _past_iso(minutes: int) -> str:
    dt = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_list_reminders(client, caretaker_headers, seeded_ids):
    r = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/reminders",
        headers=caretaker_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["reminders"]) >= 1


def test_upcoming_reminders(client, caretaker_headers, seeded_ids):
    r = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/reminders/upcoming?window_seconds=3600",
        headers=caretaker_headers,
    )
    assert r.status_code == 200, r.text
    # Seed reminder is +10 min ahead; always within 1 hr window.
    assert len(r.json()["reminders"]) >= 1


def test_create_reminder_future(client, caretaker_headers, seeded_ids):
    r = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/reminders",
        headers=caretaker_headers,
        json={
            "title": "Physio",
            "description": "Leg exercises",
            "trigger_at": _future_iso(30),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Physio"


def test_create_reminder_past_rejected(
    client, caretaker_headers, seeded_ids
):
    r = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/reminders",
        headers=caretaker_headers,
        json={"title": "Too late", "trigger_at": _past_iso(5)},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "SEMANTIC_ERROR"


def test_patch_and_delete_reminder(client, caretaker_headers, seeded_ids):
    # Create a throwaway reminder so we don't disturb the seeded one.
    created = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/reminders",
        headers=caretaker_headers,
        json={"title": "Lunch", "trigger_at": _future_iso(45)},
    )
    assert created.status_code == 201, created.text
    rid = created.json()["reminder_id"]

    patched = client.patch(
        f"/api/reminders/{rid}",
        headers=caretaker_headers,
        json={"title": "Lunch at 1pm"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "Lunch at 1pm"

    deleted = client.delete(f"/api/reminders/{rid}", headers=caretaker_headers)
    assert deleted.status_code == 204
