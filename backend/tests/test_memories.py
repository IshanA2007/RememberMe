"""Smoke tests for `/api/faces/{id}/memories` and `/api/memories/{id}` (API_SPEC §4)."""

from __future__ import annotations


def test_list_memories(client, patient_headers, seeded_ids):
    r = client.get(
        f"/api/faces/{seeded_ids['face_id']}/memories", headers=patient_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "memories" in body
    assert len(body["memories"]) >= 1
    contents = [m["content"] for m in body["memories"]]
    assert "Works as a nurse." in contents


def test_patient_create_manual(client, patient_headers, seeded_ids):
    r = client.post(
        f"/api/faces/{seeded_ids['face_id']}/memories",
        headers=patient_headers,
        json={"content": "Loves gardening.", "source": "manual"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "manual"
    assert body["content"] == "Loves gardening."


def test_patient_cannot_create_caretaker_source(
    client, patient_headers, seeded_ids
):
    r = client.post(
        f"/api/faces/{seeded_ids['face_id']}/memories",
        headers=patient_headers,
        json={"content": "nope", "source": "caretaker"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "SEMANTIC_ERROR"


def test_conversation_source_rejected(client, patient_headers, seeded_ids):
    """`source='conversation'` is excluded at the pydantic layer -> 400."""
    r = client.post(
        f"/api/faces/{seeded_ids['face_id']}/memories",
        headers=patient_headers,
        json={"content": "from a transcript", "source": "conversation"},
    )
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_caretaker_create_caretaker_source(
    client, caretaker_headers, seeded_ids
):
    r = client.post(
        f"/api/faces/{seeded_ids['face_id']}/memories",
        headers=caretaker_headers,
        json={"content": "Enjoys morning walks.", "source": "caretaker"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "caretaker"
    assert body["created_by_role"] == "caretaker"


def test_caretaker_patch_memory(client, caretaker_headers, seeded_ids):
    r = client.patch(
        f"/api/memories/{seeded_ids['memory_id']}",
        headers=caretaker_headers,
        json={"content": "Works as a nurse in Seattle."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "Works as a nurse in Seattle."


def test_patient_cannot_patch_caretaker_memory(
    client, patient_headers, seeded_ids
):
    r = client.patch(
        f"/api/memories/{seeded_ids['memory_id']}",
        headers=patient_headers,
        json={"content": "Nope"},
    )
    assert r.status_code == 403, r.text
