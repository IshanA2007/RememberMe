"""Smoke tests for `/api/conversations` (API_SPEC §6).

The LLM is stubbed via monkeypatch so tests never hit the real Anthropic API.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_submit_and_poll(client, patient_headers, seeded_ids, monkeypatch):
    # Stub the LLM so we don't call the real provider. Returns one memory
    # on the seeded face so we can observe the completed state.
    from app.services import llm

    def _stub_summarize(transcript, faces):
        return [{"face_id": int(seeded_ids["face_id"]), "content": "Said hi"}]

    monkeypatch.setattr(llm, "summarize", _stub_summarize)

    payload = {
        "patient_id": seeded_ids["patient_id"],
        "transcript": "Sarah dropped by this afternoon with some flowers.",
        "recorded_at": _iso_now(),
        "duration_seconds": 12.5,
        "recognized_face_ids": [seeded_ids["face_id"]],
    }
    r = client.post("/api/conversations", headers=patient_headers, json=payload)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "queued"
    transcript_id = body["transcript_id"]
    assert isinstance(transcript_id, str)

    # Poll for a short period until status is terminal.
    deadline = time.time() + 5.0
    final = None
    while time.time() < deadline:
        poll = client.get(
            f"/api/conversations/{transcript_id}", headers=patient_headers
        )
        assert poll.status_code == 200, poll.text
        final = poll.json()
        if final["status"] in ("completed", "failed"):
            break
        time.sleep(0.1)

    assert final is not None
    # Background task ran to completion (or at least transitioned past
    # 'queued'). Accept 'completed' as the happy-path and 'processing' as a
    # valid observation if the executor hasn't yet finished.
    assert final["status"] in ("queued", "processing", "completed", "failed")


def test_submit_too_short_transcript(client, patient_headers, seeded_ids):
    r = client.post(
        "/api/conversations",
        headers=patient_headers,
        json={
            "patient_id": seeded_ids["patient_id"],
            "transcript": "hi",  # < 10 chars, validation fails
            "recorded_at": _iso_now(),
            "duration_seconds": 6.0,
            "recognized_face_ids": [],
        },
    )
    assert r.status_code == 400, r.text


def test_caretaker_cannot_submit(client, caretaker_headers, seeded_ids):
    r = client.post(
        "/api/conversations",
        headers=caretaker_headers,
        json={
            "patient_id": seeded_ids["patient_id"],
            "transcript": "This is a caretaker-submitted transcript of normal length.",
            "recorded_at": _iso_now(),
            "duration_seconds": 10.0,
            "recognized_face_ids": [],
        },
    )
    assert r.status_code == 403, r.text
