"""Pending faces router — unknown recognition queue (API_SPEC §3b).

Endpoints:
  * POST   /api/patients/{id}/pending-faces            — Vision submits unknown
  * GET    /api/patients/{id}/pending-faces            — Dashboard lists
  * POST   /api/pending-faces/{id}/accept              — promote to registered face
  * DELETE /api/pending-faces/{id}                     — dismiss

Authority (API_SPEC §0.4):
  * POST submit: patient self only (Vision).
  * GET list, POST accept, DELETE dismiss: patient self OR assigned caretaker.

The submit flow uses a mixed response code:
  * 201 Created when a new row was inserted.
  * 200 OK when the submission merged into an existing row OR matched an
    already-registered face (no mutation surfaced).
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Path, Query, status
from fastapi.responses import JSONResponse, Response

from app.deps import get_auth, get_db, http_error
from app.models import (
    PendingFaceAcceptRequest,
    PendingFaceAcceptResponse,
    PendingFaceCreateRequest,
    PendingFaceListResponse,
    PendingFaceObject,
)
from app.ratelimit import default_limiter, make_key
from app.routers._authz import (
    ensure_patient,
    ensure_patient_or_caretaker_of,
    parse_id,
)
from app.services import pending_faces as pf_service
from app.services.auth import AuthContext

router = APIRouter()


def _check_write_limit(user_id: int) -> None:
    if not default_limiter.check(make_key(user_id, "write"), 120, 60.0):
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Write rate limit exceeded (120/min)",
        )


def _load_pending_or_404(
    conn: sqlite3.Connection, pending_face_id: str
) -> sqlite3.Row:
    """Parse the string id and fetch the pending row or raise 404."""
    pfid = parse_id(pending_face_id)
    row = pf_service.get_pending_face(conn, pfid)
    if row is None:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Pending face not found",
            {"pending_face_id": pending_face_id},
        )
    return row


# ---------------------------------------------------------------------------
# §3b.1 POST /api/patients/{id}/pending-faces
# ---------------------------------------------------------------------------


@router.post(
    "/patients/{patient_id}/pending-faces",
    response_model=PendingFaceObject,
    status_code=status.HTTP_201_CREATED,
)
async def submit_pending(
    payload: PendingFaceCreateRequest,
    patient_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
):
    """Vision submits an unknown-face embedding + thumbnail (API_SPEC §3b.1).

    Only the patient themselves may submit (Vision-only). Dedupes against
    existing pending rows (cosine ≥ 0.85) and against registered faces
    (cosine ≥ 0.50 AND margin ≥ 0.05).
    """
    pid = parse_id(patient_id)
    ensure_patient(auth, pid)
    _check_write_limit(auth.user_id)

    try:
        result = await pf_service.submit_pending_face(
            db,
            pid,
            payload.embedding,
            payload.thumbnail_b64,
            payload.thumbnail_mime,
            payload.captured_at,
        )
    except ValueError as exc:
        # Size-cap overflow → 413; every other shape/semantic error → 422.
        msg = str(exc)
        if "thumbnail exceeds" in msg:
            raise http_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "PAYLOAD_TOO_LARGE",
                msg,
            ) from exc
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            msg,
        ) from exc

    # merged/already_known → 200; new row → 201. FastAPI uses the route's
    # declared status_code as the default; we override with JSONResponse when
    # no new row was created.
    if result.get("merged") or result.get("already_known"):
        return JSONResponse(status_code=status.HTTP_200_OK, content=result)
    return result


# ---------------------------------------------------------------------------
# §3b.2 GET /api/patients/{id}/pending-faces
# ---------------------------------------------------------------------------


@router.get(
    "/patients/{patient_id}/pending-faces",
    response_model=PendingFaceListResponse,
)
def list_pending(
    patient_id: str = Path(...),
    limit: int = Query(50, ge=1, le=200),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> PendingFaceListResponse:
    """List pending faces awaiting a name (API_SPEC §3b.2)."""
    pid = parse_id(patient_id)
    ensure_patient_or_caretaker_of(db, auth, pid)
    items = pf_service.list_pending_faces(db, pid, limit=limit)
    return PendingFaceListResponse(pending_faces=items)


# ---------------------------------------------------------------------------
# §3b.3 POST /api/pending-faces/{id}/accept
# ---------------------------------------------------------------------------


@router.post(
    "/pending-faces/{pending_face_id}/accept",
    response_model=PendingFaceAcceptResponse,
    status_code=status.HTTP_201_CREATED,
)
def accept_pending(
    payload: PendingFaceAcceptRequest,
    pending_face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> PendingFaceAcceptResponse:
    """Promote a pending face into the faces registry (API_SPEC §3b.3)."""
    row = _load_pending_or_404(db, pending_face_id)
    ensure_patient_or_caretaker_of(db, auth, int(row["patient_id"]))
    _check_write_limit(auth.user_id)

    try:
        face = pf_service.accept_pending_face(
            db,
            int(row["id"]),
            payload.name,
            payload.title,
            payload.description,
        )
    except LookupError as exc:
        raise http_error(
            status.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "Pending face not found",
            {"pending_face_id": pending_face_id},
        ) from exc
    except ValueError as exc:
        if str(exc) == "duplicate_name":
            raise http_error(
                status.HTTP_409_CONFLICT,
                "CONFLICT",
                "A face with this name already exists for the patient",
                {"name": payload.name},
            ) from exc
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "SEMANTIC_ERROR",
            str(exc),
        ) from exc

    return PendingFaceAcceptResponse(face=face)


# ---------------------------------------------------------------------------
# §3b.4 DELETE /api/pending-faces/{id}
# ---------------------------------------------------------------------------


@router.delete(
    "/pending-faces/{pending_face_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def dismiss_pending(
    pending_face_id: str = Path(...),
    auth: AuthContext = Depends(get_auth),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """Dismiss a pending face without naming it (API_SPEC §3b.4)."""
    row = _load_pending_or_404(db, pending_face_id)
    ensure_patient_or_caretaker_of(db, auth, int(row["patient_id"]))
    _check_write_limit(auth.user_id)
    pf_service.delete_pending_face(db, int(row["id"]))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
