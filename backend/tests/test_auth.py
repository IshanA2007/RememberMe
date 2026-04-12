"""Smoke tests for `/api/auth/*` (API_SPEC §1)."""

from __future__ import annotations


def test_me_unauthenticated(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "UNAUTHENTICATED"


def test_me_patient_ok(client, patient_headers):
    r = client.get("/api/auth/me", headers=patient_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "patient"
    assert body["auth0_sub"] == "auth0|dev-patient-1"
    # IDs are strings per API_SPEC §0.1.
    assert isinstance(body["user_id"], str)
    assert body["display_name"] == "Alice Patient"


def test_me_caretaker_ok(client, caretaker_headers):
    r = client.get("/api/auth/me", headers=caretaker_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "caretaker"
    assert body["auth0_sub"] == "auth0|dev-caretaker-1"


def test_register_idempotent_conflict(client, patient_headers):
    """Seeded patient already exists -> register hits 409 CONFLICT."""
    r = client.post(
        "/api/auth/register",
        headers=patient_headers,
        json={"role": "patient", "display_name": "Alice Patient"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "CONFLICT"


def test_register_new_user(client):
    """A previously-unseen dev sub registers successfully (201)."""
    headers = {"Authorization": "Bearer dev-patient-999-Ignored"}
    r = client.post(
        "/api/auth/register",
        headers=headers,
        json={"role": "patient", "display_name": "New Patient"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "patient"
    assert body["auth0_sub"] == "auth0|dev-patient-999"

    # Second call must be 409.
    r2 = client.post(
        "/api/auth/register",
        headers=headers,
        json={"role": "patient", "display_name": "New Patient"},
    )
    assert r2.status_code == 409
