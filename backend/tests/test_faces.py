"""Smoke tests for `/api/patients/{id}/faces` and `/api/faces/{id}` (API_SPEC §3)."""

from __future__ import annotations


def test_list_faces(client, patient_headers, seeded_ids):
    r = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/faces", headers=patient_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "faces" in body
    names = [f["name"] for f in body["faces"]]
    assert "Sarah" in names


def test_create_face(client, patient_headers, seeded_ids):
    r = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/faces",
        headers=patient_headers,
        json={"name": "Tom", "title": "son", "description": "Lives nearby."},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Tom"
    assert body["has_embedding"] is False
    assert isinstance(body["face_id"], str)


def test_create_face_duplicate(client, patient_headers, seeded_ids):
    """Seeded face 'Sarah' already exists -> 409 CONFLICT on duplicate."""
    r = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/faces",
        headers=patient_headers,
        json={"name": "Sarah", "title": "daughter"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "CONFLICT"


def test_patch_face(client, patient_headers, seeded_ids):
    r = client.patch(
        f"/api/faces/{seeded_ids['face_id']}",
        headers=patient_headers,
        json={"description": "Updated description"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["description"] == "Updated description"


def test_delete_face(client, patient_headers, seeded_ids):
    # Create a throwaway face to avoid cascading the seeded memory away.
    created = client.post(
        f"/api/patients/{seeded_ids['patient_id']}/faces",
        headers=patient_headers,
        json={"name": "Temporary"},
    )
    assert created.status_code == 201, created.text
    face_id = created.json()["face_id"]

    r = client.delete(f"/api/faces/{face_id}", headers=patient_headers)
    assert r.status_code == 204


def test_unauth_list_faces(client, seeded_ids):
    """No Authorization header -> 401."""
    r = client.get(f"/api/patients/{seeded_ids['patient_id']}/faces")
    assert r.status_code == 401
