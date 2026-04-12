# RememberMe — Backend Service Specification

FastAPI application, Python 3.11+, uvicorn ASGI server. One process per deployment. Services are plain Python modules; no external message broker. Background tasks run in `asyncio.create_task` or `BackgroundTasks`.

---

## 1. Module layout

```
backend/
  app/
    main.py                 # FastAPI app, middleware, routes wiring
    config.py               # env loader
    db.py                   # sqlite connection, pragma, WAL
    models.py               # pydantic request/response models
    deps.py                 # auth / authz dependencies
    services/
      auth.py
      recognition.py
      memory.py
      conversation.py
      scheduling.py
      tts_proxy.py
      stt_proxy.py
      cache.py
      llm.py
    routers/
      auth.py
      patients.py
      faces.py
      memories.py
      reminders.py
      conversations.py
      tts.py
      stt.py
      health.py
      ws.py                 # /ws/recognize
    migrations/
      0001_initial.sql
      0002_*.sql            # future
  data/
    rememberme.db           # SQLite file
  requirements.txt
  .env
```

---

## 2. Services

### 2.1 `auth_service`

**Responsibilities**
- Validate Auth0 JWT on every request (REST) or WS connection.
- Resolve JWT `sub` to internal `patient_id` or `caretaker_id`.
- Enforce role + assignment on every call via `deps.py` dependencies.

**Inputs**
- HTTP header `Authorization: Bearer <JWT>` OR WS query `token=<JWT>`
- Auth0 JWKS (fetched at startup, re-fetched on unknown `kid`)

**Outputs**
- `AuthContext { user_id, role, auth0_sub }` injected into handlers
- Raises `401 UNAUTHENTICATED` or `403 FORBIDDEN`

**Dependencies**
- `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` from env
- `python-jose[cryptography]` for JWT verify
- `httpx` for JWKS fetch

**Constraints**
- JWKS cache TTL 60 minutes (re-fetch on unknown `kid`)
- JWT validation budget: <5 ms
- Role claim path: `https://rememberme.app/role`

**Authority enforcement helpers**
- `require_patient(patient_id: int)` — asserts caller is that patient
- `require_caretaker_of(patient_id: int)` — asserts caller is a caretaker row linked to patient
- `require_patient_or_caretaker_of(patient_id: int)` — OR of the above

---

### 2.2 `recognition_service`

**Responsibilities**
- Consume `recognize` WS messages.
- Run InsightFace embedding extraction on the decoded crop.
- Compute cosine similarity against the in-memory cache.
- Assemble `recognition_result` payloads (including recent memory summary).

**Inputs**
- JSON message `{ image_b64, image_mime, bbox, frame_id, msg_id, captured_at }`
- `PatientEmbeddingCache` for the session

**Outputs**
- `recognition_result` WS message (matched or unknown)
- On error: `error` WS message

**Dependencies**
- `insightface` package (model pack `buffalo_l` recommended; CPU ok for hackathon)
- `numpy`, `Pillow`
- `cache_service`
- `memory_service.recent_memory_summary(face_id)`

**Constraints**
- End-to-end per-message p95 ≤250 ms server-side
- No blocking I/O outside of LLM/TTS/STT paths (recognition is pure CPU + RAM)
- Match rule: cosine ≥0.50 AND margin ≥0.05 (constants in `config.py`, overridable via env)

**Internal algorithm (pseudo)**
```python
def recognize(session, msg) -> ServerMessage:
    if not throttle_ok(session, now()):
        return RATE_LIMITED
    img = decode_b64_image(msg.image_b64, msg.image_mime)
    embed = insightface_embed(img)              # 512 float32
    embed = l2_normalize(embed)
    sims = session.cache.entries_dot(embed)     # dot == cosine
    best, second = top2(sims)
    if best.sim >= THRESHOLD and (best.sim - second.sim) >= MARGIN:
        summary = memory_service.recent_summary(best.face_id)
        return matched_result(msg, best, summary)
    return unknown_result(msg, embed, best.sim)
```

---

### 2.3 `memory_service`

**Responsibilities**
- CRUD on `memories` with authority checks.
- Provide `recent_memory_summary(face_id, limit=3, max_chars=280)`.
- Enforce source rules (`manual` only by patient, `caretaker` only by caretaker, `conversation` only by internal pipeline).

**Inputs**
- Face ID, requesting user, payload

**Outputs**
- Memory rows or error

**Dependencies**
- `db.py`
- No external services

**Constraints**
- All queries indexed by `face_id` + `created_at DESC`
- Recent summary must return in <20 ms

---

### 2.4 `conversation_service`

**Responsibilities**
- Accept transcripts via `POST /api/conversations`.
- Insert transcript row and binding rows synchronously.
- Launch background task to call LLM and persist derived memories.

**Inputs**
- Validated `ConversationSubmit` request
- `recognized_face_ids` (already authority-checked against `patient_id`)

**Outputs**
- `202 { transcript_id, status: "queued" }` immediate
- Asynchronously: `N` `memories` rows + transcript status update

**Dependencies**
- `llm_service`
- `memory_service.create_from_llm(...)`
- `cache_service.invalidate(patient_id)`

**Constraints**
- Immediate response must complete in <100 ms
- Background LLM call may take up to 15 s; client never blocks
- On LLM failure: set transcript status `failed`, do not insert memories, do not retry

---

### 2.5 `llm_service`

**Responsibilities**
- Call the external LLM provider with the deterministic prompt.
- Parse and validate JSON response.
- Return a list of `{face_id, content}` tuples OR raise.

**Inputs**
- Transcript text, recognized face list (id, name, title)

**Outputs**
- `list[{face_id: int, content: str}]`

**Dependencies**
- `LLM_API_KEY`, `LLM_MODEL` env vars
- `httpx`

**Constraints**
- Temperature 0.2, max tokens 512
- Must return JSON only; parse fails → error
- Drop any returned `face_id` not in the provided set
- Drop any `content` >180 chars (hard cap, server-side trim)

---

### 2.6 `tts_proxy` service

**Responsibilities**
- Accept text + voice_id.
- Call ElevenLabs TTS.
- Stream `audio/mpeg` bytes to the client.

**Inputs**
- `{ text, voice_id? }`
- Auth token (for rate limit accounting)

**Outputs**
- `200 audio/mpeg` streaming body
- `502 UPSTREAM_ERROR` on ElevenLabs failure
- `429 RATE_LIMITED` if per-user budget exceeded

**Dependencies**
- `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`
- `httpx.AsyncClient`

**Constraints**
- Never log API key
- Per-user rate: 10 calls / minute
- Per-call text ≤1000 chars

---

### 2.7 `stt_proxy` service

**Responsibilities**
- Accept multipart audio file.
- Call ElevenLabs STT.
- Return `{transcript, confidence, duration_seconds}` JSON.

**Inputs**
- `multipart/form-data` with `audio` file and `patient_id`

**Outputs**
- `200 { transcript, confidence, duration_seconds }`
- `413 PAYLOAD_TOO_LARGE` if >10 MB
- `502` on upstream failure

**Dependencies**
- `ELEVENLABS_API_KEY`

**Constraints**
- File size ≤10 MB
- Per-user rate: 30 calls / minute

---

### 2.8 `scheduling_service`

**Responsibilities**
- CRUD on `reminders` with authority checks.
- Serve `upcoming` filtered view.

**Inputs**
- Patient ID, reminder payload, time window

**Outputs**
- Reminder rows

**Dependencies**
- `db.py`

**Constraints**
- `trigger_at` MUST be future at create time (server validates against `now`)
- `upcoming` query uses composite index on `(patient_id, trigger_at)`
- Response time <50 ms

---

### 2.9 `cache_service`

**Responsibilities**
- Maintain `PatientEmbeddingCache` per active patient.
- Load from DB on first request per patient.
- Invalidate on face mutations.
- Refresh on 30 s timer and on-demand.

**Inputs**
- `patient_id`, mutation events

**Outputs**
- Access to `entries: list[EmbeddingCacheEntry]`
- Version number for staleness checks

**Dependencies**
- `db.py`, `numpy`

**Constraints**
- Cache lives in the backend process (single-process deploy). No Redis.
- Concurrent access safe via asyncio `Lock` per patient.
- Refresh swap is atomic (build new list, then replace reference).

**API (internal)**
```python
async def get_cache(patient_id: int) -> PatientEmbeddingCache: ...
def invalidate(patient_id: int) -> None: ...
async def refresh_if_stale(patient_id: int) -> None: ...
```

---

## 3. Routing map

| HTTP / WS                                         | Router file         | Handler                         |
|---------------------------------------------------|---------------------|---------------------------------|
| `GET /api/health`                                 | `routers/health.py` | `get_health`                    |
| `GET /api/auth/me`                                | `routers/auth.py`   | `get_me`                        |
| `POST /api/auth/register`                         | `routers/auth.py`   | `register`                      |
| `POST /api/auth/caretaker/assign`                 | `routers/auth.py`   | `assign_caretaker`              |
| `GET /api/patients`                               | `routers/patients.py` | `list_assigned_patients`     |
| `GET /api/patients/{id}/faces`                    | `routers/faces.py`  | `list_faces`                    |
| `POST /api/patients/{id}/faces`                   | `routers/faces.py`  | `create_face`                   |
| `PATCH /api/faces/{id}`                           | `routers/faces.py`  | `update_face`                   |
| `DELETE /api/faces/{id}`                          | `routers/faces.py`  | `delete_face`                   |
| `POST /api/faces/{id}/embedding`                  | `routers/faces.py`  | `set_face_embedding`            |
| `GET /api/faces/{id}/memories`                    | `routers/memories.py` | `list_memories`              |
| `POST /api/faces/{id}/memories`                   | `routers/memories.py` | `create_memory`              |
| `PATCH /api/memories/{id}`                        | `routers/memories.py` | `update_memory`              |
| `DELETE /api/memories/{id}`                       | `routers/memories.py` | `delete_memory`              |
| `GET /api/patients/{id}/reminders`                | `routers/reminders.py` | `list_reminders`            |
| `GET /api/patients/{id}/reminders/upcoming`       | `routers/reminders.py` | `upcoming_reminders`        |
| `POST /api/patients/{id}/reminders`               | `routers/reminders.py` | `create_reminder`           |
| `PATCH /api/reminders/{id}`                       | `routers/reminders.py` | `update_reminder`           |
| `DELETE /api/reminders/{id}`                      | `routers/reminders.py` | `delete_reminder`           |
| `POST /api/conversations`                         | `routers/conversations.py` | `submit_transcript`    |
| `GET /api/conversations/{id}`                     | `routers/conversations.py` | `get_transcript`        |
| `POST /api/tts/synthesize`                        | `routers/tts.py`    | `synthesize`                    |
| `POST /api/stt/transcribe`                        | `routers/stt.py`    | `transcribe`                    |
| `GET /api/patients/{id}/quick-info`               | `routers/patients.py` | `quick_info`                 |
| `GET /api/patients/{id}/activity`                 | `routers/patients.py` | `activity`                   |
| `WS /ws/recognize`                                | `routers/ws.py`     | `recognize_ws`                  |

---

## 4. Dependency graph

```
routers/* ─────────────────────────────┐
                                       ▼
                               services/auth.py  (every request)
routers/ws.py ───────▶ services/recognition.py ──▶ services/cache.py ──▶ db.py
                                                         │
                                                         └─▶ services/memory.py ──▶ db.py
routers/conversations.py ──▶ services/conversation.py ──▶ services/llm.py
                                     │                       │
                                     ▼                       ▼
                              services/memory.py      external LLM API
                                     │
                                     ▼
                              services/cache.py (invalidate)
routers/tts.py ────▶ services/tts_proxy.py ────▶ external ElevenLabs
routers/stt.py ────▶ services/stt_proxy.py ────▶ external ElevenLabs
routers/reminders.py ▶ services/scheduling.py ─▶ db.py
```

---

## 5. Configuration

Environment variables loaded at startup via `config.py` (`pydantic-settings`):

| Var                            | Required | Default                              |
|--------------------------------|----------|--------------------------------------|
| `BACKEND_HOST`                 | no       | `0.0.0.0`                            |
| `BACKEND_PORT`                 | no       | `5000`                               |
| `SQLITE_PATH`                  | no       | `./data/rememberme.db`               |
| `AUTH0_DOMAIN`                 | yes      | —                                    |
| `AUTH0_AUDIENCE`               | yes      | —                                    |
| `AUTH0_ROLE_CLAIM`             | no       | `https://rememberme.app/role`        |
| `ELEVENLABS_API_KEY`           | yes      | —                                    |
| `ELEVENLABS_DEFAULT_VOICE_ID`  | yes      | —                                    |
| `LLM_API_KEY`                  | yes      | —                                    |
| `LLM_MODEL`                    | no       | `claude-sonnet-4-6`                  |
| `RECOGNITION_THRESHOLD`        | no       | `0.50`                               |
| `RECOGNITION_MARGIN`           | no       | `0.05`                               |
| `CACHE_REFRESH_SECONDS`        | no       | `30`                                 |
| `CORS_ALLOWED_ORIGINS`         | yes      | `http://localhost:3000,http://localhost:3001` |

---

## 6. Performance targets

| Target                                      | Budget      |
|---------------------------------------------|-------------|
| JWT validate per request                    | <5 ms       |
| SQLite single-row read                      | <2 ms       |
| SQLite upsert memory                        | <5 ms       |
| InsightFace embedding (CPU)                 | <150 ms     |
| Cosine match vs 50 embeddings               | <1 ms       |
| Cosine match vs 1000 embeddings             | <5 ms       |
| WS recognize handler total (p95)            | <250 ms     |
| LLM summarize call                          | <15 s       |
| TTS synthesis (proxy pass-through)          | <4 s        |

---

## 7. Startup sequence

1. Load `.env` via `config.py`.
2. Open SQLite; set `journal_mode=WAL`, `synchronous=NORMAL`.
3. Run migrations: apply any SQL in `migrations/` not yet recorded in `schema_migrations`.
4. Fetch Auth0 JWKS; cache.
5. Load InsightFace model into memory (warm one call with a dummy image).
6. Mount routers.
7. Start background: `cache_refresh_loop` (30 s tick over active sessions).
8. Start uvicorn.

---

## 8. Shutdown sequence

1. Stop accepting new WS connections.
2. Close open WS sessions with 1001.
3. Flush pending background tasks (up to 5 s grace).
4. Close SQLite.
