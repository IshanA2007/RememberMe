"""Smoke tests for `/api/patients/{id}/pending-faces` + `/api/pending-faces/...`.

Covers API_SPEC §3b in its entirety. All tests hit a real SQLite fixture (see
`conftest.py`), per CLAUDE.md §7 — no database mocking.

Embedding inputs are deterministic random-normal vectors generated from a
seeded numpy Generator so dedupe / already-known results are reproducible.
Thumbnails are tiny PIL-generated JPEGs (~2 KB) unless a test explicitly
needs a size-limit failure.
"""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from PIL import Image


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _embedding(seed: int) -> list[float]:
    """Deterministic L2-normalized 512-float vector for a given seed."""
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(512).astype(np.float32)
    v = v / np.linalg.norm(v)
    return v.tolist()


def _thumb_jpeg(size: int = 96, color: tuple[int, int, int] = (200, 120, 60)) -> str:
    """Base64-encoded small JPEG thumbnail. Default ~2 KB at 96x96."""
    im = Image.new("RGB", (size, size), color)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _captured_at() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _submit(client, patient_id: str, headers, **overrides):
    """Post a pending face; returns the `Response`."""
    body = {
        "embedding": overrides.get("embedding", _embedding(1)),
        "thumbnail_b64": overrides.get("thumbnail_b64", _thumb_jpeg()),
        "thumbnail_mime": overrides.get("thumbnail_mime", "image/jpeg"),
        "captured_at": overrides.get("captured_at", _captured_at()),
    }
    return client.post(
        f"/api/patients/{patient_id}/pending-faces", headers=headers, json=body
    )


# ---------------------------------------------------------------------------
# POST submit
# ---------------------------------------------------------------------------


def test_submit_new_returns_201(client, patient_headers, seeded_ids):
    """First submission of a fresh embedding → 201, new row created."""
    r = _submit(client, seeded_ids["patient_id"], patient_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["merged"] is False
    assert body["already_known"] is False
    assert body["pending_face_id"] is not None
    assert body["patient_id"] == seeded_ids["patient_id"]
    assert body["thumbnail_mime"] == "image/jpeg"


def test_submit_duplicate_merges_returns_200(
    client, patient_headers, seeded_ids
):
    """Posting the same L2-normalized embedding again dedupes → 200 merged."""
    emb = _embedding(42)
    first = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=emb,
    )
    assert first.status_code == 201, first.text
    pfid = first.json()["pending_face_id"]

    second = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=emb,
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["merged"] is True
    assert body["already_known"] is False
    assert body["pending_face_id"] == pfid


def test_submit_matches_registered_face_returns_200_already_known(
    client, patient_headers, seeded_ids
):
    """A submission whose embedding already matches a registered face →
    200 already_known, no new row, `face_id` populated.
    """
    # Attach a deterministic embedding to the seeded 'Sarah' face so the
    # recognition cache picks it up.
    emb = _embedding(777)
    r = client.post(
        f"/api/faces/{seeded_ids['face_id']}/embedding",
        headers=patient_headers,
        json={"embedding": emb},
    )
    assert r.status_code == 200, r.text

    # Submitting that same embedding should match the registered face.
    submit = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=emb,
    )
    assert submit.status_code == 200, submit.text
    body = submit.json()
    assert body["already_known"] is True
    assert body["merged"] is False
    assert body["pending_face_id"] is None
    assert body["face_id"] == seeded_ids["face_id"]


def test_submit_bad_embedding_length_returns_422(
    client, patient_headers, seeded_ids
):
    """Length ≠ 512 → 422 SEMANTIC_ERROR."""
    r = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=[0.0] * 511,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "SEMANTIC_ERROR"


def test_submit_oversized_thumbnail_returns_413(
    client, patient_headers, seeded_ids
):
    """> 50 KB decoded thumbnail → 413 PAYLOAD_TOO_LARGE."""
    # 60 KB of raw bytes → base64 blows up to ~80 KB chars, still > 50 KB once
    # decoded server-side.
    huge = base64.b64encode(b"\x00" * (60 * 1024)).decode("ascii")
    r = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        thumbnail_b64=huge,
    )
    assert r.status_code == 413, r.text
    assert r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_submit_requires_patient_token(client, caretaker_headers, seeded_ids):
    """Caretakers may NOT submit pending faces (Vision-only endpoint)."""
    r = _submit(
        client,
        seeded_ids["patient_id"],
        caretaker_headers,
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


# ---------------------------------------------------------------------------
# GET list
# ---------------------------------------------------------------------------


def test_list_returns_submitted_rows(client, patient_headers, seeded_ids):
    """GET returns every pending face for the patient (newest-first)."""
    _submit(client, seeded_ids["patient_id"], patient_headers, embedding=_embedding(10))
    _submit(client, seeded_ids["patient_id"], patient_headers, embedding=_embedding(11))

    r = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/pending-faces",
        headers=patient_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pending_faces" in body
    assert len(body["pending_faces"]) >= 2
    for item in body["pending_faces"]:
        assert item["patient_id"] == seeded_ids["patient_id"]
        assert "thumbnail_b64" in item
        assert "pending_face_id" in item


def test_caretaker_can_list(client, caretaker_headers, patient_headers, seeded_ids):
    """Caretakers may list pending faces for assigned patients."""
    _submit(client, seeded_ids["patient_id"], patient_headers, embedding=_embedding(12))

    r = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/pending-faces",
        headers=caretaker_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["pending_faces"]) >= 1


# ---------------------------------------------------------------------------
# POST accept
# ---------------------------------------------------------------------------


def test_accept_promotes_to_faces_and_removes_pending(
    client, patient_headers, seeded_ids
):
    """Accept creates a `faces` row, deletes the pending row, and the new face
    appears in `GET /api/patients/{id}/faces` with `has_embedding=true`.
    """
    submit = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=_embedding(100),
    )
    assert submit.status_code == 201, submit.text
    pfid = submit.json()["pending_face_id"]

    accept = client.post(
        f"/api/pending-faces/{pfid}/accept",
        headers=patient_headers,
        json={"name": "Marcus", "title": "friend", "description": "Chess partner"},
    )
    assert accept.status_code == 201, accept.text
    face = accept.json()["face"]
    assert face["name"] == "Marcus"
    assert face["has_embedding"] is True
    assert face["patient_id"] == seeded_ids["patient_id"]

    # Pending row is gone.
    listing = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/pending-faces",
        headers=patient_headers,
    )
    assert listing.status_code == 200
    assert all(
        item["pending_face_id"] != pfid for item in listing.json()["pending_faces"]
    )

    # Face appears in the registered list.
    faces = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/faces",
        headers=patient_headers,
    )
    assert faces.status_code == 200
    names = [f["name"] for f in faces.json()["faces"]]
    assert "Marcus" in names


def test_accept_duplicate_name_returns_409(
    client, patient_headers, seeded_ids
):
    """Accepting into a name that already exists for the patient → 409 CONFLICT."""
    submit = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=_embedding(200),
    )
    assert submit.status_code == 201, submit.text
    pfid = submit.json()["pending_face_id"]

    # 'Sarah' is seeded; accepting with that name must collide.
    accept = client.post(
        f"/api/pending-faces/{pfid}/accept",
        headers=patient_headers,
        json={"name": "Sarah"},
    )
    assert accept.status_code == 409, accept.text
    assert accept.json()["error"]["code"] == "CONFLICT"


def test_accept_nonexistent_returns_404(client, patient_headers):
    """Accepting a pending_face_id that never existed → 404 NOT_FOUND."""
    r = client.post(
        "/api/pending-faces/999999/accept",
        headers=patient_headers,
        json={"name": "ghost"},
    )
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# DELETE dismiss
# ---------------------------------------------------------------------------


def test_dismiss_returns_204(client, patient_headers, seeded_ids):
    """DELETE removes the pending row, returns 204, and the listing reflects it."""
    submit = _submit(
        client,
        seeded_ids["patient_id"],
        patient_headers,
        embedding=_embedding(300),
    )
    assert submit.status_code == 201, submit.text
    pfid = submit.json()["pending_face_id"]

    delete = client.delete(
        f"/api/pending-faces/{pfid}", headers=patient_headers
    )
    assert delete.status_code == 204

    listing = client.get(
        f"/api/patients/{seeded_ids['patient_id']}/pending-faces",
        headers=patient_headers,
    )
    assert listing.status_code == 200
    assert all(
        item["pending_face_id"] != pfid for item in listing.json()["pending_faces"]
    )


def test_dismiss_nonexistent_returns_404(client, patient_headers):
    """DELETE on unknown pending_face_id → 404 NOT_FOUND."""
    r = client.delete("/api/pending-faces/999999", headers=patient_headers)
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "NOT_FOUND"
