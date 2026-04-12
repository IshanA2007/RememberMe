"""Pydantic v2 request/response models.

Source of truth: `docs/API_SPEC.md` (every shape is documented there).

Conventions (API_SPEC §0):
  * IDs are decimal-rendered strings (`"42"`), not integers. DB layer converts.
  * Timestamps are ISO 8601 UTC with `Z` suffix. Use `iso_utc(dt)` to format.
  * Enums are `typing.Literal[...]` — never free-form strings.
  * Every non-2xx response uses the `ErrorEnvelope` shape in §0.3.

WebSocket message types live at the bottom; see API_SPEC §10 and
DATA_SCHEMAS §9.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def iso_utc(dt: datetime | str) -> str:
    """Render any datetime or pre-formatted timestamp as canonical ISO 8601 UTC.

    Output shape: `YYYY-MM-DDTHH:MM:SS[.ffffff]Z` (trailing `Z`, no `+00:00`).
    If `dt` is already a string, it is normalised through `datetime.fromisoformat`
    so we catch silent drift between producers (e.g. SQLite's `CURRENT_TIMESTAMP`
    returns `YYYY-MM-DD HH:MM:SS` — we coerce that shape too).
    """
    if isinstance(dt, str):
        raw = dt.strip()
        # Accept SQLite's `YYYY-MM-DD HH:MM:SS` and ISO variants ending in Z.
        if " " in raw and "T" not in raw:
            raw = raw.replace(" ", "T", 1)
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError(f"Unparseable timestamp: {dt!r}") from exc
        dt = parsed
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    # isoformat() yields `+00:00`; swap for `Z`.
    return dt.isoformat().replace("+00:00", "Z")


# Base config — forbid unknown fields on requests so we fail loud on drift.
class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class _ResponseModel(BaseModel):
    # Responses may pick up additional keys in future specs; be lenient on in.
    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# §0.3 — Error envelope
# ---------------------------------------------------------------------------


class ErrorBody(BaseModel):
    """Inner body of the error envelope."""

    model_config = ConfigDict(extra="ignore")

    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorEnvelope(BaseModel):
    """Top-level error response shape used by every non-2xx response."""

    model_config = ConfigDict(extra="ignore")

    error: ErrorBody


# ---------------------------------------------------------------------------
# §1 — Auth
# ---------------------------------------------------------------------------


Role = Literal["patient", "caretaker"]


class MeResponse(_ResponseModel):
    """`GET /api/auth/me` 200 response (also returned on `POST /register`)."""

    user_id: str
    auth0_sub: str
    role: Role
    display_name: str
    email: str | None = None
    created_at: str


class RegisterRequest(_StrictModel):
    """`POST /api/auth/register` body."""

    role: Role
    display_name: str = Field(min_length=1, max_length=80)


class CaretakerAssignRequest(_StrictModel):
    """`POST /api/auth/caretaker/assign` body."""

    patient_id: str
    caretaker_id: str


class CaretakerAssignResponse(_ResponseModel):
    """`POST /api/auth/caretaker/assign` 201 body."""

    patient_id: str
    caretaker_id: str
    created_at: str


# ---------------------------------------------------------------------------
# §2 — Patient directory (caretaker-facing)
# ---------------------------------------------------------------------------


class PatientDirectoryEntry(_ResponseModel):
    """A single patient in a caretaker's assignment list."""

    patient_id: str
    display_name: str
    assigned_at: str


class PatientDirectoryResponse(_ResponseModel):
    """`GET /api/patients` 200 body."""

    patients: list[PatientDirectoryEntry]


# ---------------------------------------------------------------------------
# §3 — Face registry
# ---------------------------------------------------------------------------


class FaceObject(_ResponseModel):
    """Canonical face shape (API_SPEC §3.1)."""

    face_id: str
    patient_id: str
    name: str
    title: str | None = None
    description: str | None = None
    has_embedding: bool
    created_at: str
    updated_at: str


class FaceListResponse(_ResponseModel):
    """`GET /api/patients/{id}/faces` 200 body."""

    faces: list[FaceObject]


class FaceCreateRequest(_StrictModel):
    """`POST /api/patients/{id}/faces` body.

    Embedding is optional — absent in Dashboard mode, present in Vision mode.
    When provided, it MUST be length 512 and finite; router validates.
    """

    name: str = Field(min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=500)
    embedding: list[float] | None = None


class FacePatchRequest(_StrictModel):
    """`PATCH /api/faces/{id}` body — any subset."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=500)


class FaceEmbeddingRequest(_StrictModel):
    """`POST /api/faces/{id}/embedding` body."""

    embedding: list[float]


# ---------------------------------------------------------------------------
# §3b — Pending faces (unknown recognition queue)
# ---------------------------------------------------------------------------


class PendingFaceCreateRequest(_StrictModel):
    """`POST /api/patients/{id}/pending-faces` body (API_SPEC §3b.1).

    Validation of the 512-length + finite-floats embedding is done in the
    service layer so we can produce a shared 422 SEMANTIC_ERROR envelope.
    """

    embedding: list[float]
    thumbnail_b64: str = Field(min_length=1)
    thumbnail_mime: Literal["image/jpeg", "image/png"]
    captured_at: str


class PendingFaceObject(_ResponseModel):
    """`POST /api/patients/{id}/pending-faces` response (API_SPEC §3b.1).

    `pending_face_id` is null when `already_known=true` (no row created).
    `face_id` is populated only when `already_known=true`.
    """

    pending_face_id: str | None = None
    patient_id: str
    thumbnail_b64: str
    thumbnail_mime: Literal["image/jpeg", "image/png"]
    captured_at: str
    created_at: str
    updated_at: str
    merged: bool
    already_known: bool
    face_id: str | None = None


class PendingFaceListItem(_ResponseModel):
    """A single row in `GET /api/patients/{id}/pending-faces` (API_SPEC §3b.2).

    Embeddings are NOT returned on the list view — only on POST.
    """

    pending_face_id: str
    patient_id: str
    thumbnail_b64: str
    thumbnail_mime: Literal["image/jpeg", "image/png"]
    captured_at: str
    created_at: str
    updated_at: str


class PendingFaceListResponse(_ResponseModel):
    """`GET /api/patients/{id}/pending-faces` 200 body."""

    pending_faces: list[PendingFaceListItem]


class PendingFaceAcceptRequest(_StrictModel):
    """`POST /api/pending-faces/{id}/accept` body (API_SPEC §3b.3)."""

    name: str = Field(min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=500)


class PendingFaceAcceptResponse(_ResponseModel):
    """`POST /api/pending-faces/{id}/accept` 201 body."""

    face: FaceObject


# ---------------------------------------------------------------------------
# §4 — Memories
# ---------------------------------------------------------------------------


MemorySource = Literal["conversation", "manual", "caretaker"]


class MemoryObject(_ResponseModel):
    """Canonical memory shape (API_SPEC §4.1 + DATA_SCHEMAS §5)."""

    memory_id: str
    face_id: str
    content: str
    source: MemorySource
    created_by_user_id: str | None = None
    created_by_role: Literal["patient", "caretaker"] | None = None
    transcript_id: str | None = None
    created_at: str
    updated_at: str | None = None


class MemoryListResponse(_ResponseModel):
    """`GET /api/faces/{id}/memories` 200 body."""

    memories: list[MemoryObject]
    has_more: bool


# POST-memory request source excludes 'conversation' (API_SPEC §4.2).
MemoryCreateSource = Literal["manual", "caretaker"]


class MemoryCreateRequest(_StrictModel):
    """`POST /api/faces/{id}/memories` body."""

    content: str = Field(min_length=1, max_length=280)
    source: MemoryCreateSource


class MemoryPatchRequest(_StrictModel):
    """`PATCH /api/memories/{id}` body. Only `content` is mutable."""

    content: str = Field(min_length=1, max_length=280)


# ---------------------------------------------------------------------------
# §5 — Reminders
# ---------------------------------------------------------------------------


class ReminderObject(_ResponseModel):
    """Canonical reminder shape (API_SPEC §5.1 + DATA_SCHEMAS §7)."""

    reminder_id: str
    patient_id: str
    title: str
    description: str | None = None
    trigger_at: str
    created_by_user_id: str
    created_by_role: Role
    created_at: str
    updated_at: str


class ReminderListResponse(_ResponseModel):
    """`GET /api/patients/{id}/reminders[/upcoming]` 200 body."""

    reminders: list[ReminderObject]


class ReminderCreateRequest(_StrictModel):
    """`POST /api/patients/{id}/reminders` body.

    Server validates that `trigger_at` is strictly in the future.
    """

    title: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=280)
    trigger_at: str


class ReminderPatchRequest(_StrictModel):
    """`PATCH /api/reminders/{id}` body — any subset."""

    title: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=280)
    trigger_at: str | None = None


# ---------------------------------------------------------------------------
# §6 — Conversation / memory ingest
# ---------------------------------------------------------------------------


ConversationStatus = Literal["queued", "processing", "completed", "failed"]


class ConversationSubmitRequest(_StrictModel):
    """`POST /api/conversations` body."""

    patient_id: str
    transcript: str = Field(min_length=10, max_length=8000)
    recorded_at: str
    duration_seconds: float = Field(ge=5.0)
    recognized_face_ids: list[str]


class ConversationSubmitResponse(_ResponseModel):
    """`POST /api/conversations` 202 body."""

    transcript_id: str
    status: ConversationStatus


class ConversationDetailResponse(_ResponseModel):
    """`GET /api/conversations/{id}` 200 body."""

    transcript_id: str
    patient_id: str
    status: ConversationStatus
    processed_at: str | None = None
    derived_memory_ids: list[str]


# ---------------------------------------------------------------------------
# §7 — ElevenLabs proxy
# ---------------------------------------------------------------------------


class TtsRequest(_StrictModel):
    """`POST /api/tts/synthesize` body."""

    text: str = Field(min_length=1, max_length=1000)
    voice_id: str | None = None


class SttResponse(_ResponseModel):
    """`POST /api/stt/transcribe` 200 body."""

    transcript: str
    confidence: float
    duration_seconds: float


# ---------------------------------------------------------------------------
# §8 — Dashboard snapshot endpoints
# ---------------------------------------------------------------------------


class QuickInfoRecentMemory(_ResponseModel):
    """A single row in `quick-info.recent_memories`."""

    memory_id: str
    face_id: str
    face_name: str
    content: str
    source: MemorySource
    created_at: str


class QuickInfoUpcomingReminder(_ResponseModel):
    """A single row in `quick-info.upcoming_reminders`."""

    reminder_id: str
    title: str
    trigger_at: str


class QuickInfoResponse(_ResponseModel):
    """`GET /api/patients/{id}/quick-info` 200 body."""

    patient_id: str
    display_name: str
    face_count: int
    recent_memories: list[QuickInfoRecentMemory]
    upcoming_reminders: list[QuickInfoUpcomingReminder]


class ActivityNewlyRecognizedFace(_ResponseModel):
    """A single row in `activity.newly_recognized_faces`."""

    face_id: str
    name: str
    first_seen_at: str


class ActivityRecentConversationMemory(_ResponseModel):
    """A single row in `activity.recent_conversation_memories`."""

    memory_id: str
    face_id: str
    face_name: str
    content: str
    created_at: str
    transcript_id: str


class ActivityResponse(_ResponseModel):
    """`GET /api/patients/{id}/activity` 200 body."""

    patient_id: str
    newly_recognized_faces: list[ActivityNewlyRecognizedFace]
    recent_conversation_memories: list[ActivityRecentConversationMemory]
    upcoming_reminders: list[QuickInfoUpcomingReminder]


# ---------------------------------------------------------------------------
# §9 — Health
# ---------------------------------------------------------------------------


class HealthResponse(_ResponseModel):
    """`GET /api/health` 200 body."""

    status: Literal["ok"]
    version: str


# ---------------------------------------------------------------------------
# §10 — WebSocket messages (see also DATA_SCHEMAS §9)
# ---------------------------------------------------------------------------


ImageMime = Literal["image/jpeg", "image/png"]


class BoundingBox(_StrictModel):
    """Client-reported face bbox on the source frame (API_SPEC §10.4)."""

    x: float
    y: float
    w: float
    h: float


# --- Client → Server ---


class RecognizeMessage(_StrictModel):
    """`type: "recognize"` — client sends one face crop per 500 ms (min)."""

    type: Literal["recognize"]
    msg_id: str
    frame_id: str
    captured_at: str
    image_b64: str
    image_mime: ImageMime
    bbox: BoundingBox | None = None


class PingMessage(_StrictModel):
    """`type: "ping"` — client liveness probe."""

    type: Literal["ping"]
    msg_id: str


ClientWsMessage = Union[RecognizeMessage, PingMessage]


# --- Server → Client ---


class SessionReadyMessage(_ResponseModel):
    """First frame server sends after a successful WS handshake."""

    type: Literal["session_ready"]
    patient_id: str
    server_time: str
    embedding_cache_loaded: bool
    face_count: int


class SessionErrorMessage(_ResponseModel):
    """Fatal session error — server will close after sending this."""

    type: Literal["session_error"]
    code: str
    message: str


class RecognitionResultMatched(_ResponseModel):
    """`type: "recognition_result"` when `matched=true`."""

    type: Literal["recognition_result"]
    msg_id: str
    frame_id: str
    matched: Literal[True]
    face_id: str
    name: str
    title: str | None = None
    confidence: float
    margin: float
    recent_memory_summary: str
    server_time: str


class RecognitionResultUnknown(_ResponseModel):
    """`type: "recognition_result"` when `matched=false`."""

    type: Literal["recognition_result"]
    msg_id: str
    frame_id: str
    matched: Literal[False]
    embedding: list[float]
    best_similarity: float
    server_time: str


class PongMessage(_ResponseModel):
    """Server's reply to a client `ping`."""

    type: Literal["pong"]
    msg_id: str
    server_time: str


class WsErrorMessage(_ResponseModel):
    """Per-message error; non-fatal unless the code says so (API_SPEC §10.7)."""

    type: Literal["error"]
    msg_id: str | None = None
    code: str
    message: str


ServerWsMessage = Union[
    SessionReadyMessage,
    SessionErrorMessage,
    RecognitionResultMatched,
    RecognitionResultUnknown,
    PongMessage,
    WsErrorMessage,
]
