"""Conversations router — transcript ingest + status read (API_SPEC §6).

Endpoints:
  * POST /api/conversations          — submit transcript (202 queued)
  * GET  /api/conversations/{id}     — poll processing status

Only the patient themselves may submit a transcript for their own patient_id
(API_SPEC §0.4). The GET is allowed to the patient or a linked caretaker.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends, Path, status

from app.deps import get_auth, get_db, http_error
from app.models import (
    ConversationDetailResponse,
    ConversationSubmitRequest,
    ConversationSubmitResponse,
)
from app.ratelimit import default_limiter, make_key
from app.routers._authz import ensure_patient_or_caretaker_of, parse_id
from app.services import conversation as conversation_service
from app.services.auth import AuthContext

router = APIRouter()


def _check_conversation_limit(user_id: int) -> None:
    """30/min per API_SPEC §11 conversations budget."""
    if not default_limiter.check(make_key(user_id, "conversations"), 30, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Conversation submissions limited to 30/min",
        )


# ---------------------------------------------------------------------------
# §6.1 POST /api/conversations
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ConversationSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_transcript(
    payload: ConversationSubmitRequest,
    background_tasks: BackgroundTasks,
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ConversationSubmitResponse:
    """Queue a transcript for async LLM extraction.

    Returns 202 with the new `transcript_id`. The client must NOT block
    waiting for derived memories — poll `GET /api/conversations/{id}`
    or re-read memories after a short delay.
    """
    _check_conversation_limit(auth.user_id)

    patient_id = parse_id(payload.patient_id)
    # Only the patient themselves may submit (API_SPEC §0.4 matrix).
    if auth.role != "patient" or auth.user_id != patient_id:
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Only the patient themselves may submit a conversation",
            {"patient_id": payload.patient_id},
        )

    # Parse face_ids + verify all belong to this patient before inserting.
    try:
        face_id_ints = [int(fid) for fid in payload.recognized_face_ids]
    except ValueError as exc:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "recognized_face_ids must be numeric strings",
            {"recognized_face_ids": payload.recognized_face_ids},
        ) from exc

    if face_id_ints and not conversation_service.faces_all_belong_to_patient(
        db, face_id_ints, patient_id
    ):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            "One or more recognized_face_ids do not belong to this patient",
            {"patient_id": payload.patient_id},
        )

    transcript_id = conversation_service.submit_transcript(
        db,
        patient_id=patient_id,
        transcript=payload.transcript,
        recorded_at=payload.recorded_at,
        duration_seconds=payload.duration_seconds,
        recognized_face_ids=face_id_ints,
    )

    # Fire-and-forget LLM extraction. BackgroundTasks schedules on the
    # running event loop AFTER the response is sent so the client doesn't
    # pay for the 15 s LLM budget.
    background_tasks.add_task(
        conversation_service.process_transcript, transcript_id
    )

    return ConversationSubmitResponse(
        transcript_id=str(transcript_id),
        status="queued",
    )


# ---------------------------------------------------------------------------
# §6.2 GET /api/conversations/{id}
# ---------------------------------------------------------------------------


@router.get(
    "/{transcript_id}", response_model=ConversationDetailResponse
)
def get_transcript(
    transcript_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> ConversationDetailResponse:
    """Return transcript status + any derived memory ids.

    Allowed to the patient OR a caretaker linked to the patient.
    """
    tid = parse_id(transcript_id)

    # Fetch the transcript's patient_id first so we can run the authority check.
    row = db.execute(
        "SELECT patient_id FROM conversation_transcripts WHERE id = ?",
        (tid,),
    ).fetchone()
    if row is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Transcript not found",
            {"transcript_id": transcript_id},
        )
    patient_id = int(row["patient_id"])
    ensure_patient_or_caretaker_of(db, auth, patient_id)

    detail = conversation_service.get_transcript(db, tid)
    assert detail is not None  # we already confirmed the row exists
    return detail
