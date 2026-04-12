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


def test_patient_may_patch_caretaker_memory_on_own_face(
    client, patient_headers, seeded_ids
):
    """API_SPEC §4.3 (updated): patient may edit any memory on their own face,
    including caretaker- and conversation-sourced memories. `source` stays
    immutable so the audit trail is preserved.
    """
    r = client.patch(
        f"/api/memories/{seeded_ids['memory_id']}",
        headers=patient_headers,
        json={"content": "Actually works as a nurse in Boston."},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content"] == "Actually works as a nurse in Boston."
    # Source must not flip on patient edit.
    assert body["source"] == "caretaker"


def test_patient_may_delete_caretaker_memory_on_own_face(
    client, patient_headers, seeded_ids
):
    r = client.delete(
        f"/api/memories/{seeded_ids['memory_id']}",
        headers=patient_headers,
    )
    assert r.status_code == 204, r.text
    # Follow-up: the memory is gone.
    r2 = client.get(
        f"/api/faces/{seeded_ids['face_id']}/memories",
        headers=patient_headers,
    )
    assert r2.status_code == 200
    ids = [m["memory_id"] for m in r2.json()["memories"]]
    assert seeded_ids["memory_id"] not in ids


def test_clear_face_embedding_patient(client, patient_headers, seeded_ids):
    """API_SPEC §3.6: patient may clear their own face's embedding.

    The seed face has no embedding, so we first attach one, then clear it.
    """
    face_id = seeded_ids["face_id"]
    # Attach a synthetic 512-d embedding.
    emb = [0.0] * 512
    emb[0] = 1.0
    r = client.post(
        f"/api/faces/{face_id}/embedding",
        headers=patient_headers,
        json={"embedding": emb},
    )
    assert r.status_code == 200, r.text
    assert r.json()["has_embedding"] is True

    # Now clear it.
    r = client.delete(f"/api/faces/{face_id}/embedding", headers=patient_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_embedding"] is False
    # Name/title/description/memories must be preserved.
    assert body["name"] == "Sarah"
    assert body["title"] == "daughter"


def test_clear_face_embedding_not_found(client, patient_headers):
    r = client.delete("/api/faces/999999/embedding", headers=patient_headers)
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "FACE_NOT_FOUND"
