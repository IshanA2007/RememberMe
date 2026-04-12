# RememberMe — API Specification

All endpoints are served by the FastAPI backend. Base URL: `{BACKEND_ORIGIN}` (e.g. `http://localhost:5000`).

- REST prefix: `/api`
- WebSocket prefix: `/ws`
- Auth header (REST): `Authorization: Bearer <Auth0 access token>`
- Auth for WS: access token passed as `?token=<...>` query parameter on connection open
- Content-Type: `application/json` unless noted (e.g. `audio/mpeg` on TTS response)

---

## 0. Conventions

### 0.1 ID types
- Internal IDs are **signed 64-bit integers** rendered as decimal strings in JSON (`"12"`).
- Auth0 `sub` claims are opaque strings (`"auth0|abc123"`) and never exposed as foreign keys in the client-facing API.

### 0.2 Timestamps
- All timestamps are **ISO 8601 UTC** with `Z` suffix: `"2026-04-11T14:30:00Z"`.
- Clients MUST send UTC.

### 0.3 Errors
Every non-2xx response uses this envelope:

```json
{
  "error": {
    "code": "FACE_NOT_FOUND",
    "message": "Face 42 does not belong to patient 7",
    "details": { "face_id": "42", "patient_id": "7" }
  }
}
```

Error codes:

| HTTP | `code`                    | Meaning                                        |
|------|---------------------------|------------------------------------------------|
| 400  | `VALIDATION_ERROR`        | Body failed schema validation                  |
| 401  | `UNAUTHENTICATED`         | Missing/invalid token                          |
| 403  | `FORBIDDEN`               | Valid token, insufficient authority            |
| 404  | `NOT_FOUND`               | Resource does not exist                        |
| 404  | `FACE_NOT_FOUND`          | Face not in this patient's registry            |
| 404  | `MEMORY_NOT_FOUND`        | Memory missing                                 |
| 404  | `REMINDER_NOT_FOUND`      | Reminder missing                               |
| 409  | `CONFLICT`                | Duplicate or concurrent modification           |
| 413  | `PAYLOAD_TOO_LARGE`       | Image or transcript over limit                 |
| 415  | `UNSUPPORTED_MEDIA_TYPE`  | Bad content-type                               |
| 422  | `SEMANTIC_ERROR`          | Payload shape OK, values invalid               |
| 429  | `RATE_LIMITED`            | Throttle exceeded                              |
| 500  | `INTERNAL_ERROR`          | Uncategorized server error                     |
| 502  | `UPSTREAM_ERROR`          | Auth0 / ElevenLabs / LLM failed                |

### 0.4 Authorization matrix

| Resource                      | Patient (self) | Caretaker (for assigned patient) | Caretaker (other patients) |
|-------------------------------|---------------:|---------------------------------:|---------------------------:|
| GET faces                     | ✓              | ✓                                | ✗                          |
| POST faces                    | ✓              | ✓ (name+title only; no embedding required) | ✗               |
| PATCH/DELETE face             | ✓              | ✓                                | ✗                          |
| GET memories                  | ✓              | ✓                                | ✗                          |
| POST memory (source=manual)   | ✓              | ✗ (must use source=caretaker)    | ✗                          |
| POST memory (source=caretaker)| ✗              | ✓                                | ✗                          |
| PATCH/DELETE memory any source| own manual only| any                              | ✗                          |
| GET reminders                 | ✓              | ✓                                | ✗                          |
| POST/PATCH/DELETE reminder    | ✓              | ✓                                | ✗                          |
| POST conversation             | ✓ (own only)   | ✗                                | ✗                          |
| POST tts/synthesize           | ✓              | ✓                                | ✗                          |
| POST stt/transcribe           | ✓              | ✗                                | ✗                          |
| WS /ws/recognize              | ✓ (own only)   | ✗                                | ✗                          |
| POST pending-faces            | ✓ (own only)   | ✗                                | ✗                          |
| GET pending-faces             | ✓              | ✓                                | ✗                          |
| POST pending-faces/{id}/accept| ✓              | ✓                                | ✗                          |
| DELETE pending-face           | ✓              | ✓                                | ✗                          |

---

## 1. Auth Endpoints

### 1.1 `GET /api/auth/me`

Purpose: resolve the caller's identity and role.

Request: no body. Token required.

Response 200:
```json
{
  "user_id": "7",
  "auth0_sub": "auth0|abc123",
  "role": "patient",
  "display_name": "Alice Patient",
  "email": "alice@example.com",
  "created_at": "2026-01-15T10:00:00Z"
}
```

For caretakers, `role: "caretaker"`.

Response 401: `UNAUTHENTICATED`.

Response 404: `NOT_FOUND` — token valid but no matching user row (first-time login; caller should POST `/api/auth/register`).

### 1.2 `POST /api/auth/register`

Purpose: first-time provisioning after Auth0 login. Idempotent.

Request:
```json
{
  "role": "patient",
  "display_name": "Alice Patient"
}
```

| Field          | Type   | Required | Validation                                 |
|----------------|--------|----------|--------------------------------------------|
| `role`         | enum   | yes      | `"patient"` or `"caretaker"`; must match JWT `https://rememberme.app/role` claim |
| `display_name` | string | yes      | 1–80 chars, trimmed                         |

Response 201: same body as `GET /api/auth/me`.

Response 409: `CONFLICT` if already registered.

### 1.3 `POST /api/auth/caretaker/assign`

Purpose: link a caretaker to a patient. Hackathon scope: either user may submit via an out-of-band invite code.

Request:
```json
{
  "patient_id": "7",
  "caretaker_id": "12"
}
```

Response 201:
```json
{ "patient_id": "7", "caretaker_id": "12", "created_at": "2026-04-11T14:00:00Z" }
```

Response 403 if caller is not either party involved.

---

## 2. Patient Directory Endpoints (Caretaker-Facing)

### 2.1 `GET /api/patients`

Purpose: caretaker lists assigned patients.

Request: no body. Caretaker token required.

Response 200:
```json
{
  "patients": [
    { "patient_id": "7", "display_name": "Alice Patient", "assigned_at": "2026-02-01T12:00:00Z" },
    { "patient_id": "9", "display_name": "Bob Patient",   "assigned_at": "2026-03-10T08:00:00Z" }
  ]
}
```

Response 403: caller is a patient, not a caretaker.

---

## 3. Face Registry Endpoints

### 3.1 `GET /api/patients/{patient_id}/faces`

Purpose: list all faces registered to a patient.

Response 200:
```json
{
  "faces": [
    {
      "face_id": "42",
      "patient_id": "7",
      "name": "Sarah",
      "title": "daughter",
      "description": "Lives in Seattle. Visits monthly.",
      "has_embedding": true,
      "created_at": "2026-02-15T09:30:00Z",
      "updated_at": "2026-04-01T11:00:00Z"
    }
  ]
}
```

Field definitions:

| Field           | Type   | Notes                                                    |
|-----------------|--------|----------------------------------------------------------|
| `face_id`       | string | internal int as string                                   |
| `name`          | string | 1–80 chars                                               |
| `title`         | string\|null | 0–40 chars; relationship label ("daughter", "doctor") |
| `description`   | string\|null | 0–500 chars; free text for dashboard display       |
| `has_embedding` | bool   | `false` if caretaker pre-registered; will be `true` after Vision sees them |

### 3.2 `POST /api/patients/{patient_id}/faces`

Purpose: register a new face. Two modes:
- **Vision mode**: patient token, includes embedding from unknown-face flow
- **Dashboard mode**: patient or caretaker token, no embedding (filled in later by Vision)

Request (Vision mode):
```json
{
  "name": "Sarah",
  "title": "daughter",
  "description": "Lives in Seattle.",
  "embedding": [0.0123, -0.0456, "... 512 floats total"]
}
```

Request (Dashboard mode):
```json
{
  "name": "Sarah",
  "title": "daughter",
  "description": "Lives in Seattle."
}
```

| Field         | Type    | Required | Validation |
|---------------|---------|----------|------------|
| `name`        | string  | yes      | 1–80       |
| `title`       | string  | no       | 0–40       |
| `description` | string  | no       | 0–500      |
| `embedding`   | float[] | no       | length exactly 512 if provided; each finite |

Response 201: returns the full `face` object (see 3.1).

Response 409: `CONFLICT` if a face with same `name` (case-insensitive) already exists for this patient AND no embedding distinction is provided (hackathon simplification).

### 3.3 `PATCH /api/faces/{face_id}`

Purpose: edit name / title / description.

Request (any subset):
```json
{
  "name": "Sarah M.",
  "title": "daughter",
  "description": "Updated description"
}
```

Response 200: full `face` object.

Response 403 if caller has no authority over the owning patient.

### 3.4 `POST /api/faces/{face_id}/embedding`

Purpose: attach or replace the embedding on an existing face (used when Vision finally sees a caretaker-pre-registered face).

Request:
```json
{ "embedding": [ /* 512 floats */ ] }
```

Response 200: full `face` object with `has_embedding: true`.

Response 422 if embedding length ≠ 512 or contains non-finite values.

### 3.5 `DELETE /api/faces/{face_id}`

Purpose: remove a face and cascade-delete its memories.

Response 204 on success.

---

## 3b. Pending Faces (Unknown Recognition Queue)

Unknown faces captured by the Vision interface are persisted server-side and surfaced in the Dashboard for naming. This replaces the simplified "one unembedded face per patient" heuristic.

### 3b.1 `POST /api/patients/{patient_id}/pending-faces`

Purpose: Vision submits an unknown face's embedding plus a thumbnail for later naming.

Caller: patient (self only).

Request:
```json
{
  "embedding": [0.0123, -0.0456, "... 512 floats total"],
  "thumbnail_b64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "thumbnail_mime": "image/jpeg",
  "captured_at": "2026-04-11T16:03:22Z"
}
```

| Field            | Type   | Required | Validation                                                      |
|------------------|--------|----------|-----------------------------------------------------------------|
| `embedding`      | float[]| yes      | length exactly 512, each finite                                 |
| `thumbnail_b64`  | string | yes      | base64 JPEG/PNG; ≤50 KB decoded; recommended 96×96 or 128×128    |
| `thumbnail_mime` | string | yes      | `image/jpeg` or `image/png`                                     |
| `captured_at`    | string | yes      | ISO 8601 UTC                                                    |

Dedupe: if an existing pending face for this patient has cosine similarity ≥ 0.85 to the submitted embedding, the server updates its `thumbnail_b64`, `embedding`, and `captured_at` in place and returns the existing row with `merged: true`. Otherwise a new row is inserted.

Match-then-skip: if the submitted embedding ALREADY matches a registered face (cosine ≥ 0.50 AND margin ≥ 0.05), no pending face is created and the server responds with `already_known: true` plus the matched `face_id`. Client discards the embedding.

Response 201 (new):
```json
{
  "pending_face_id": "17",
  "patient_id": "7",
  "thumbnail_b64": "...",
  "thumbnail_mime": "image/jpeg",
  "captured_at": "2026-04-11T16:03:22Z",
  "created_at": "2026-04-11T16:03:22Z",
  "updated_at": "2026-04-11T16:03:22Z",
  "merged": false,
  "already_known": false
}
```

Response 200 (merged OR already_known — no new row): same shape with `merged: true` OR `already_known: true`; when `already_known`, `pending_face_id` is `null` and an additional `face_id` field identifies the existing registered face.

Response 413: `PAYLOAD_TOO_LARGE` if thumbnail > 50 KB decoded.
Response 422: embedding length ≠ 512, non-finite values, or bad thumbnail MIME.

### 3b.2 `GET /api/patients/{patient_id}/pending-faces`

Purpose: Dashboard lists pending faces awaiting a name.

Caller: patient (self) OR caretaker of patient.

Query params: `?limit=50` (default 50, max 200)

Response 200:
```json
{
  "pending_faces": [
    {
      "pending_face_id": "17",
      "patient_id": "7",
      "thumbnail_b64": "...",
      "thumbnail_mime": "image/jpeg",
      "captured_at": "2026-04-11T16:03:22Z",
      "created_at": "2026-04-11T16:03:22Z",
      "updated_at": "2026-04-11T16:10:44Z"
    }
  ]
}
```

Embeddings are NOT returned on `GET` (too large for the list view; the server promotes them internally on accept).

### 3b.3 `POST /api/pending-faces/{pending_face_id}/accept`

Purpose: promote a pending face to a registered face by naming it.

Caller: patient (self) OR caretaker of owning patient.

Request:
```json
{
  "name": "Sarah",
  "title": "daughter",
  "description": "Lives in Seattle."
}
```

| Field         | Type   | Required | Validation |
|---------------|--------|----------|------------|
| `name`        | string | yes      | 1–80       |
| `title`       | string | no       | 0–40       |
| `description` | string | no       | 0–500      |

Server behavior: atomic transaction — insert a `faces` row with this name/title/description and the stored embedding, then delete the `pending_faces` row. Invalidates the patient's recognition cache.

Response 201:
```json
{
  "face": {
    "face_id": "42",
    "patient_id": "7",
    "name": "Sarah",
    "title": "daughter",
    "description": "Lives in Seattle.",
    "has_embedding": true,
    "created_at": "2026-04-11T16:12:00Z",
    "updated_at": "2026-04-11T16:12:00Z"
  }
}
```

Response 409: `CONFLICT` if a face with the same case-insensitive `name` already exists for this patient.

### 3b.4 `DELETE /api/pending-faces/{pending_face_id}`

Purpose: dismiss a pending face without naming it.

Caller: patient (self) OR caretaker of owning patient.

Response 204.

---

## 4. Memory Endpoints

### 4.1 `GET /api/faces/{face_id}/memories`

Query params: `?limit=50&before=2026-04-11T00:00:00Z`

Response 200:
```json
{
  "memories": [
    {
      "memory_id": "301",
      "face_id": "42",
      "content": "Visited last Tuesday and brought flowers.",
      "source": "conversation",
      "created_at": "2026-04-08T16:20:00Z",
      "created_by_user_id": null,
      "transcript_id": "88"
    },
    {
      "memory_id": "287",
      "face_id": "42",
      "content": "Works as a nurse.",
      "source": "caretaker",
      "created_at": "2026-03-20T10:00:00Z",
      "created_by_user_id": "12",
      "transcript_id": null
    }
  ],
  "has_more": false
}
```

| Field                 | Type         | Notes                                         |
|-----------------------|--------------|-----------------------------------------------|
| `content`             | string       | 1–280 chars                                   |
| `source`              | enum         | `conversation`, `manual`, `caretaker`         |
| `created_by_user_id`  | string\|null | null for `conversation`                       |
| `transcript_id`       | string\|null | non-null only for `conversation`              |

### 4.2 `POST /api/faces/{face_id}/memories`

Request:
```json
{
  "content": "Loves gardening.",
  "source": "manual"
}
```

| Field    | Type   | Required | Validation                                       |
|----------|--------|----------|--------------------------------------------------|
| `content`| string | yes      | 1–280 chars, trimmed                             |
| `source` | enum   | yes      | must be `manual` (patient) or `caretaker` (caretaker). `conversation` is rejected (those go via POST /api/conversations) |

Response 201: full memory object.

### 4.3 `PATCH /api/memories/{memory_id}`

Request:
```json
{ "content": "corrected text" }
```

Only `content` is editable. `source` never changes.

Response 200: full memory object.

Authority rules:
- Patient may PATCH only `manual` memories they created
- Caretaker may PATCH any memory on any assigned patient's face (including `conversation` ones)

### 4.4 `DELETE /api/memories/{memory_id}`

Same authority rules as PATCH.

Response 204.

---

## 5. Reminder Endpoints

### 5.1 `GET /api/patients/{patient_id}/reminders`

Query params: `?from=2026-04-11T00:00:00Z&to=2026-04-20T00:00:00Z`

Response 200:
```json
{
  "reminders": [
    {
      "reminder_id": "55",
      "patient_id": "7",
      "title": "Doctor appointment",
      "description": "Dr. Nguyen, 2nd floor.",
      "trigger_at": "2026-04-12T14:00:00Z",
      "created_by_user_id": "12",
      "created_at": "2026-04-11T09:00:00Z",
      "updated_at": "2026-04-11T09:00:00Z"
    }
  ]
}
```

### 5.2 `GET /api/patients/{patient_id}/reminders/upcoming`

Query params: `?window_seconds=600` (default 600, max 3600)

Purpose: Vision polling endpoint. Returns reminders whose `trigger_at` is within `[now, now + window_seconds]`.

Response 200: same shape as 5.1 but filtered.

### 5.3 `POST /api/patients/{patient_id}/reminders`

Request:
```json
{
  "title": "Take medication",
  "description": "Blue pill with water.",
  "trigger_at": "2026-04-12T09:00:00Z"
}
```

| Field         | Type   | Required | Validation                      |
|---------------|--------|----------|---------------------------------|
| `title`       | string | yes      | 1–80                            |
| `description` | string | no       | 0–280                           |
| `trigger_at`  | string | yes      | ISO 8601 UTC; must be in future |

Response 201: full reminder object.

### 5.4 `PATCH /api/reminders/{reminder_id}`

Any subset of `title`, `description`, `trigger_at`. Response 200.

### 5.5 `DELETE /api/reminders/{reminder_id}`

Response 204.

---

## 6. Conversation / Memory Ingest

### 6.1 `POST /api/conversations`

Purpose: submit a conversation transcript for async LLM memory extraction.

Request:
```json
{
  "patient_id": "7",
  "transcript": "Sarah said she flew in from Seattle on Thursday and brought lemon cake.",
  "recorded_at": "2026-04-11T16:03:22Z",
  "duration_seconds": 42.5,
  "recognized_face_ids": ["42"]
}
```

| Field                 | Type     | Required | Validation                                          |
|-----------------------|----------|----------|-----------------------------------------------------|
| `patient_id`          | string   | yes      | must match token's patient                          |
| `transcript`          | string   | yes      | 10–8000 chars                                        |
| `recorded_at`         | string   | yes      | ISO 8601 UTC                                         |
| `duration_seconds`    | number   | yes      | must be ≥ 5.0                                       |
| `recognized_face_ids` | string[] | yes      | all must belong to `patient_id`; may be empty array |

Response 202:
```json
{
  "transcript_id": "88",
  "status": "queued"
}
```

No memories are returned synchronously. Client MUST NOT block on this response.

### 6.2 `GET /api/conversations/{transcript_id}` (optional)

Purpose: retrieve processing status + resulting memories.

Response 200:
```json
{
  "transcript_id": "88",
  "patient_id": "7",
  "status": "completed",
  "processed_at": "2026-04-11T16:03:48Z",
  "derived_memory_ids": ["301", "302"]
}
```

`status` enum: `queued`, `processing`, `completed`, `failed`.

---

## 7. ElevenLabs Proxy

### 7.1 `POST /api/tts/synthesize`

Purpose: generate audio from text using ElevenLabs.

Request:
```json
{
  "text": "This is your daughter, Sarah.",
  "voice_id": "default"
}
```

| Field      | Type   | Required | Validation                      |
|------------|--------|----------|---------------------------------|
| `text`     | string | yes      | 1–1000 chars                    |
| `voice_id` | string | no       | ElevenLabs voice id; default = server-configured |

Response 200:
- Content-Type: `audio/mpeg`
- Body: raw MP3 bytes

Response 502: `UPSTREAM_ERROR` if ElevenLabs fails.

Rate limit: 10 req/min per user token; exceeds → 429.

### 7.2 `POST /api/stt/transcribe`

Purpose: transcribe audio to text.

Request:
- Content-Type: `multipart/form-data`
- Fields:
  - `audio` (file): audio blob (webm/ogg/wav/mp3)
  - `patient_id` (string, form field)

Response 200:
```json
{
  "transcript": "Sarah said she flew in from Seattle on Thursday.",
  "confidence": 0.92,
  "duration_seconds": 42.5
}
```

Response 413 if file > 10 MB.

---

## 8. Dashboard Snapshot Endpoints

### 8.1 `GET /api/patients/{patient_id}/quick-info`

Purpose: single call for the quick-info panel.

Response 200:
```json
{
  "patient_id": "7",
  "display_name": "Alice Patient",
  "face_count": 14,
  "recent_memories": [
    {
      "memory_id": "301",
      "face_id": "42",
      "face_name": "Sarah",
      "content": "Visited last Tuesday and brought flowers.",
      "source": "conversation",
      "created_at": "2026-04-08T16:20:00Z"
    }
  ],
  "upcoming_reminders": [
    {
      "reminder_id": "55",
      "title": "Doctor appointment",
      "trigger_at": "2026-04-12T14:00:00Z"
    }
  ]
}
```

`recent_memories` returns up to 10 newest across all faces.
`upcoming_reminders` returns up to 5 next reminders within the next 7 days.

### 8.2 `GET /api/patients/{patient_id}/activity`

Purpose: caretaker monitoring view.

Response 200:
```json
{
  "patient_id": "7",
  "newly_recognized_faces": [
    { "face_id": "43", "name": "Tom", "first_seen_at": "2026-04-10T11:20:00Z" }
  ],
  "recent_conversation_memories": [
    {
      "memory_id": "301",
      "face_id": "42",
      "face_name": "Sarah",
      "content": "Visited last Tuesday and brought flowers.",
      "created_at": "2026-04-08T16:20:00Z",
      "transcript_id": "88"
    }
  ],
  "upcoming_reminders": [ /* same shape as quick-info */ ]
}
```

`newly_recognized_faces`: faces first recognized in the last 7 days.
`recent_conversation_memories`: `source=conversation` memories from the last 7 days.

---

## 9. Health

### 9.1 `GET /api/health`

Purpose: liveness.

Response 200:
```json
{ "status": "ok", "version": "0.1.0" }
```

No auth required.

---

## 10. WebSocket — `/ws/recognize`

### 10.1 Connection

- URL: `ws://{BACKEND_ORIGIN}/ws/recognize?token=<access_token>&patient_id=<id>`
- The token must belong to a patient.
- `patient_id` must match the token's patient.
- On invalid token → server closes with code `4401` and reason `"invalid_token"`.
- On mismatched patient → close code `4403`, reason `"forbidden"`.

### 10.2 Message framing

- All frames are **JSON text frames**.
- Every message has a top-level `type` field.
- Every message carries a client-generated `msg_id` string (client messages) or echoes it back (server responses tied to a request).

### 10.3 Handshake

On connect, server immediately sends:

```json
{
  "type": "session_ready",
  "patient_id": "7",
  "server_time": "2026-04-11T14:00:00Z",
  "embedding_cache_loaded": true,
  "face_count": 14
}
```

If the server fails to load the cache, it sends:

```json
{ "type": "session_error", "code": "CACHE_LOAD_FAILED", "message": "..." }
```

...then closes with code `4500`.

### 10.4 Client → Server: `recognize`

```json
{
  "type": "recognize",
  "msg_id": "c-0001",
  "frame_id": "f-1234",
  "captured_at": "2026-04-11T14:00:01.250Z",
  "image_b64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "image_mime": "image/jpeg",
  "bbox": { "x": 120, "y": 80, "w": 200, "h": 200 }
}
```

| Field         | Type    | Required | Notes                                        |
|---------------|---------|----------|----------------------------------------------|
| `msg_id`      | string  | yes      | client-unique per session                    |
| `frame_id`    | string  | yes      | client's detector-level ID for this face     |
| `captured_at` | string  | yes      | when frame was captured, client clock        |
| `image_b64`   | string  | yes      | base64 of the cropped face thumbnail; ≤200 KB after decode; recommended 112×112 or 160×160 |
| `image_mime`  | string  | yes      | `image/jpeg` or `image/png`                   |
| `bbox`        | object  | no       | the original frame's bbox (for overlay correlation) |

Throttling: client MUST NOT send more than one `recognize` per 500 ms. Server will respond with `error` of code `RATE_LIMITED` and ignore the frame.

### 10.5 Server → Client: `recognition_result`

Matched case:
```json
{
  "type": "recognition_result",
  "msg_id": "c-0001",
  "frame_id": "f-1234",
  "matched": true,
  "face_id": "42",
  "name": "Sarah",
  "title": "daughter",
  "confidence": 0.87,
  "margin": 0.21,
  "recent_memory_summary": "Visited last Tuesday and brought lemon cake. Works as a nurse.",
  "server_time": "2026-04-11T14:00:01.410Z"
}
```

Unknown case:
```json
{
  "type": "recognition_result",
  "msg_id": "c-0001",
  "frame_id": "f-1234",
  "matched": false,
  "embedding": [ /* 512 floats */ ],
  "best_similarity": 0.31,
  "server_time": "2026-04-11T14:00:01.410Z"
}
```

| Field                   | Type        | When                              |
|-------------------------|-------------|-----------------------------------|
| `matched`               | bool        | always                            |
| `face_id`               | string      | only when `matched=true`          |
| `name`                  | string      | only when `matched=true`          |
| `title`                 | string\|null| only when `matched=true`          |
| `confidence`            | number 0–1  | only when `matched=true` — cosine similarity of best match |
| `margin`                | number      | only when `matched=true` — best minus second-best similarity |
| `recent_memory_summary` | string      | only when `matched=true` — a concatenation of up to the 3 most recent memories, truncated to 280 chars |
| `embedding`             | float[]     | only when `matched=false` — 512 floats; for registration flow |
| `best_similarity`       | number 0–1  | only when `matched=false` — similarity of closest non-match |

### 10.6 Client → Server: `ping`

```json
{ "type": "ping", "msg_id": "c-p-0001" }
```

Server replies:
```json
{ "type": "pong", "msg_id": "c-p-0001", "server_time": "2026-04-11T14:00:02Z" }
```

Client SHOULD ping every 30 s.

### 10.7 Server → Client: `error`

```json
{
  "type": "error",
  "msg_id": "c-0001",
  "code": "RATE_LIMITED",
  "message": "Throttle is 500ms; last frame received 120ms ago"
}
```

Error codes on WS:

| Code                 | Meaning                              | Fatal to session? |
|----------------------|--------------------------------------|-------------------|
| `RATE_LIMITED`       | Throttle exceeded                    | No                |
| `BAD_FRAME`          | Malformed JSON or missing fields     | No                |
| `IMAGE_TOO_LARGE`    | Decoded image > 200 KB               | No                |
| `UNSUPPORTED_MIME`   | `image_mime` not allowed             | No                |
| `RECOGNIZER_FAILED`  | InsightFace inference error          | No                |
| `CACHE_LOAD_FAILED`  | Could not load embeddings on connect | Yes (closes 4500) |
| `INTERNAL_ERROR`     | Other                                | No                |

### 10.8 Close codes

| Code | Meaning                                              |
|------|------------------------------------------------------|
| 1000 | Normal closure                                       |
| 4401 | Invalid or expired token                             |
| 4403 | Token does not own the requested patient             |
| 4409 | Duplicate session for same patient already connected |
| 4500 | Server could not initialize session                  |

---

## 11. Rate Limits (summary)

| Resource                                     | Limit                    |
|----------------------------------------------|--------------------------|
| WS `recognize` per session                   | 2 per second (500 ms)    |
| REST `/api/tts/synthesize`                   | 10 per minute per user   |
| REST `/api/stt/transcribe`                   | 30 per minute per user   |
| REST `/api/conversations`                    | 30 per minute per user   |
| REST write endpoints (POST/PATCH/DELETE)     | 120 per minute per user  |
| REST read endpoints                          | 600 per minute per user  |

Exceeding returns `429 RATE_LIMITED`.

---

## 12. Payload size limits

| Payload                         | Max size |
|---------------------------------|----------|
| WS `image_b64` (decoded)        | 200 KB   |
| REST `transcript`               | 8000 chars |
| REST STT `audio` file           | 10 MB    |
| REST general JSON body          | 1 MB     |
