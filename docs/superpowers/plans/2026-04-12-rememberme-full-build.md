# RememberMe Full Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working RememberMe MVP — FastAPI backend + Dashboard SPA + Vision SPA — that demos the face-recognition-to-memory-narration flow end-to-end, strictly adhering to the contracts in `docs/`.

**Architecture:** Three independently-runnable units talk through the contracts in `docs/API_SPEC.md`. Backend owns all state (SQLite+WAL). Dashboard handles identity/CRUD. Vision handles real-time camera+WS+TTS playback. No shared packages; types are hand-mirrored.

**Tech Stack:**
- Backend: Python 3.11, FastAPI, uvicorn, SQLite, python-jose, httpx, pydantic-settings, insightface, numpy, Pillow, pytest
- Frontend (both): React 18, Vite 5, TypeScript strict, Tailwind 3
- Dashboard only: @auth0/auth0-react, @tanstack/react-query, react-router-dom, lucide-react
- Vision only: @mediapipe/tasks-vision, @ricky0123/vad-web

---

## 0. Binding Decisions (locked before any code)

These are decisions the plan commits to up front so subagents don't re-invent them.

### 0.1 Fonts

Imported via `@fontsource` packages or Google Fonts CDN.

- **Display**: `Fraunces` — warm humanist serif with optical sizes; carries identity without AI-slop feel
- **Text**: `Newsreader` — contemporary humanist serif that pairs cleanly with Fraunces
- **Mono** (timestamps only): `JetBrains Mono`

Banned fonts (from `.cursor/rules/frontend.mdc` §1.1) MUST NOT appear anywhere.

### 0.2 Color tokens (per SPA)

All colors live in `src/styles/index.css` as CSS variables. Components consume `var(--token)`.

**Vision (`RememberMeInterface/`)** — ≤4 hues + neutral:
```
--bg-base:        #0A0908        /* near-black, for overlay cards */
--bg-elevated:    #1A1816        /* card fill */
--ink-primary:    #F5EEDC        /* warm cream text */
--ink-secondary:  #B8AF9E        /* muted cream */
--accent:         #D4A65A        /* warm ochre — identification */
--signal-cool:    #6B8A8E        /* muted teal — reminder/status */
--signal-warm:    #C6733D        /* burnt sienna — unknown badge */
--rule:           #2B2825        /* borders */
--focus-ring:     #D4A65A
```

**Dashboard (`dashboard/`)** — shared base, per-role accent:
```
--bg-base:        #F4EFE6        /* aged cream */
--bg-elevated:    #FBF8F1        /* card fill */
--bg-sunken:      #EAE3D4        /* inset */
--ink-primary:    #1A1816        /* deep ink */
--ink-secondary:  #6B6458        /* taupe-grey */
--ink-inverse:    #F4EFE6

--accent-patient:   #5B7A6A      /* bottle green-slate — calming */
--accent-caretaker: #B8693D      /* burnt sienna — warmth */
--accent:           var(--accent-patient)   /* default; overridden on /caretaker */
--accent-ink:       #FBF8F1

--signal-warm:    #C6733D
--signal-cool:    #5B7A6A
--rule:           #C5BEAE
--focus-ring:     #B8693D
```

Role-scoped accent is toggled by adding a class `role-caretaker` to `<body>` in the caretaker portal, which overrides `--accent: var(--accent-caretaker)`.

### 0.3 Environment files

Do NOT commit `.env`. Commit `.env.example` with safe placeholders.

- `backend/.env.example`: AUTH0_DOMAIN, AUTH0_AUDIENCE, ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_VOICE_ID, LLM_API_KEY, LLM_MODEL, CORS_ALLOWED_ORIGINS
- `dashboard/.env.example`: VITE_BACKEND_HTTP, VITE_BACKEND_WS, VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE, VITE_VISION_URL
- `RememberMeInterface/.env.example`: VITE_BACKEND_HTTP, VITE_BACKEND_WS

### 0.4 LLM choice

- `LLM_MODEL` default: `claude-sonnet-4-5` (via Anthropic API)
- Provider module: `backend/app/services/llm.py` calls Anthropic Messages API with the deterministic prompt from `docs/PIPELINE.md §2.3`, temperature 0.2, max_tokens 512
- Hard per-memory cap: 180 chars (trim at ingestion)

### 0.5 Dev-mode auth bypass (hackathon)

For demos without a fully wired Auth0 tenant, support `BACKEND_DEV_AUTH_BYPASS=true`. When set:
- JWT validation accepts any Bearer token shaped `dev-<role>-<sub>-<display>` (e.g. `dev-patient-1-Alice`)
- Returns synthetic `AuthContext` with those fields
- `CORS_ALLOWED_ORIGINS` must still be respected

Clearly log `DEV AUTH BYPASS ACTIVE` on every request in this mode. NEVER default to true.

### 0.6 File-location invariants

- Plan itself: `docs/superpowers/plans/2026-04-12-rememberme-full-build.md`
- Backend code: `backend/app/**`
- Backend tests: `backend/tests/**`
- Dashboard code: `dashboard/src/**`
- Vision code: `RememberMeInterface/src/**`
- Do NOT create a root-level `package.json`, `.env`, or `tsconfig.json`. Each unit owns its own.

---

## Backend Phase

### Task B1: Backend scaffold — config, db, requirements

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/data/.gitkeep`

- [ ] **Step 1: Write requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
pydantic==2.9.2
pydantic-settings==2.5.2
python-jose[cryptography]==3.3.0
httpx==0.27.2
anthropic==0.40.0
numpy==1.26.4
Pillow==11.0.0
python-multipart==0.0.12
insightface==0.7.3
onnxruntime==1.19.2
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Write config.py**

`pydantic-settings` class `Settings` reading env vars per `docs/SERVICE_BACKEND.md §5`. Singleton `get_settings()` with `@lru_cache`. Include `DEV_AUTH_BYPASS: bool = False` flag.

- [ ] **Step 3: Write db.py**

Synchronous `sqlite3` connection helper. On first open: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON`. Per-request connection via FastAPI dependency. Row factory `sqlite3.Row`.

- [ ] **Step 4: Write .env.example with all vars**

Per §0.3. Use placeholder values like `AUTH0_DOMAIN=your-tenant.auth0.com`.

- [ ] **Step 5: Write .gitignore**

```
venv/
__pycache__/
*.pyc
.env
data/*.db*
.pytest_cache/
```

- [ ] **Step 6: Commit**

```
git add backend/
git commit -m "feat(backend): scaffold config, db helpers, requirements"
```

### Task B2: Initial SQL migration (0001_initial.sql)

**Files:**
- Create: `backend/app/migrations/0001_initial.sql`
- Create: `backend/app/migrations/__init__.py`
- Create: `backend/app/migrations_runner.py`

- [ ] **Step 1: Write 0001_initial.sql**

All seven tables per `docs/DATA_SCHEMAS.md §1-7` plus `conversation_recognized_faces` side table and a `schema_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (...); -- per §1
CREATE TABLE IF NOT EXISTS caretakers (...); -- per §2
CREATE TABLE IF NOT EXISTS patient_caretakers (...); -- per §3
CREATE TABLE IF NOT EXISTS faces (...); -- per §4
CREATE TABLE IF NOT EXISTS memories (...); -- per §5 with both CHECK constraints
CREATE TABLE IF NOT EXISTS conversation_transcripts (...); -- per §6
CREATE TABLE IF NOT EXISTS conversation_recognized_faces (...); -- per §6
CREATE TABLE IF NOT EXISTS reminders (...); -- per §7

-- All indexes listed in §1-7
CREATE UNIQUE INDEX ... patients_auth0_sub ...
CREATE UNIQUE INDEX ... caretakers_auth0_sub ...
CREATE INDEX idx_patient_caretakers_patient_id ...
CREATE INDEX idx_patient_caretakers_caretaker_id ...
CREATE INDEX idx_faces_patient_id ...
CREATE UNIQUE INDEX faces_patient_lower_name ON faces(patient_id, lower(name));
CREATE INDEX idx_memories_face_id ...
CREATE INDEX idx_memories_face_id_created_at_desc ON memories(face_id, created_at DESC);
CREATE INDEX idx_memories_transcript_id ...
CREATE INDEX idx_conversation_transcripts_patient_id ...
CREATE INDEX idx_conversation_transcripts_status ...
CREATE INDEX idx_reminders_patient_id_trigger_at ON reminders(patient_id, trigger_at);
```

Notes: the "UNIQUE (patient_id, lower(name))" constraint in §4 is implemented as a unique functional index in SQLite; no separate trigger required.

- [ ] **Step 2: Write migrations_runner.py**

`apply_pending_migrations(conn)` reads every `*.sql` file in the migrations dir, executes those not yet recorded in `schema_migrations`, records them on success. Idempotent.

- [ ] **Step 3: Verify schema creates cleanly**

```bash
cd backend && python -c "import sqlite3; from app.migrations_runner import apply_pending_migrations; c=sqlite3.connect(':memory:'); apply_pending_migrations(c); print([r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type=\"table\"').fetchall()])"
```
Expect all 8 table names (7 data + schema_migrations).

- [ ] **Step 4: Commit**

### Task B3: Pydantic models

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Write all request/response models**

Every shape in `docs/API_SPEC.md` as a pydantic v2 `BaseModel`. Include:
- `MeResponse`, `RegisterRequest`, `CaretakerAssignRequest`, `CaretakerAssignResponse`
- `FaceObject`, `FaceListResponse`, `FaceCreateRequest`, `FacePatchRequest`, `FaceEmbeddingRequest`
- `MemoryObject`, `MemoryListResponse`, `MemoryCreateRequest`, `MemoryPatchRequest`
- `ReminderObject`, `ReminderListResponse`, `ReminderCreateRequest`, `ReminderPatchRequest`
- `ConversationSubmitRequest`, `ConversationSubmitResponse`, `ConversationDetailResponse`
- `TtsRequest`, `SttResponse`
- `QuickInfoResponse`, `ActivityResponse`, `PatientDirectoryResponse`
- WS: `RecognizeMessage`, `RecognitionResultMatched`, `RecognitionResultUnknown`, `SessionReadyMessage`, `PingMessage`, `PongMessage`, `WsErrorMessage`, `SessionErrorMessage`
- `ErrorEnvelope`

**IDs are `str`** in JSON (see API_SPEC §0.1). In models, use `str`. DB layer converts int ↔ str.

**Timestamps are `str`** (ISO 8601 UTC with `Z`). Build a helper `iso_utc(dt)` that formats any datetime or string to the canonical form.

All enums are `Literal[...]` from typing.

- [ ] **Step 2: Commit**

### Task B4: Auth + deps

**Files:**
- Create: `backend/app/services/__init__.py` (empty)
- Create: `backend/app/services/auth.py`
- Create: `backend/app/deps.py`

- [ ] **Step 1: Write auth.py**

- `JwksCache`: fetches `https://{AUTH0_DOMAIN}/.well-known/jwks.json` at startup and on unknown `kid`; TTL 60 min
- `verify_jwt(token) -> dict[claims]`: RS256, audience check, issuer check, exp check
- Role claim path: `settings.AUTH0_ROLE_CLAIM` (default `https://rememberme.app/role`)
- Dev bypass: when `settings.DEV_AUTH_BYPASS`, parse `dev-<role>-<sub>-<display>` tokens synthetically; set `claims['sub'] = 'auth0|dev-<sub>'`, `claims[role_claim] = '<role>'`
- `resolve_user(claims, db) -> AuthContext` — look up by `auth0_sub`; `AuthContext` is a dataclass with `user_id: int, role: str, auth0_sub: str, display_name: str, email: str|None`
- 401 raised as HTTPException with error envelope body

- [ ] **Step 2: Write deps.py**

FastAPI dependencies:
- `get_db() -> Connection` — yields connection, closes after
- `get_auth(request) -> AuthContext` — extracts Bearer token, verifies, resolves. Raises 401 with envelope.
- `require_patient(patient_id: str)` returns a dependency that asserts `auth.role == 'patient' AND auth.user_id == int(patient_id)`; raises 403 with `FORBIDDEN`.
- `require_caretaker_of(patient_id: str)`: `auth.role == 'caretaker' AND row in patient_caretakers`; 403 otherwise
- `require_patient_or_caretaker_of(patient_id: str)`: OR of above

- [ ] **Step 3: Verify auth module imports cleanly**

```bash
cd backend && python -c "from app.services import auth; from app import deps; print('ok')"
```

- [ ] **Step 4: Commit**

### Task B5: Non-recognition services

**Files:**
- Create: `backend/app/services/memory.py`
- Create: `backend/app/services/scheduling.py`
- Create: `backend/app/services/cache.py`
- Create: `backend/app/services/llm.py`
- Create: `backend/app/services/conversation.py`
- Create: `backend/app/services/tts_proxy.py`
- Create: `backend/app/services/stt_proxy.py`

Each service is a plain module with functions. Signatures below are minimal; implementer should fill in robust bodies matching docs:

- [ ] **Step 1: memory.py**

```
def list_memories(conn, face_id, limit=50, before=None) -> list[MemoryObject]
def create_memory(conn, face_id, content, source, created_by_user_id, created_by_role, transcript_id=None) -> MemoryObject
def update_memory_content(conn, memory_id, content) -> MemoryObject
def delete_memory(conn, memory_id) -> None
def recent_memory_summary(conn, face_id, limit=3, max_chars=280) -> str
def memory_belongs_to_patient(conn, memory_id, patient_id) -> bool
def get_memory(conn, memory_id) -> MemoryObject | None
```

`recent_memory_summary` reads 3 newest `memories.content`, joins with `" "`, truncates to 280 chars.

- [ ] **Step 2: scheduling.py**

```
def list_reminders(conn, patient_id, from_dt=None, to_dt=None) -> list[ReminderObject]
def upcoming_reminders(conn, patient_id, window_seconds=600) -> list[ReminderObject]
def create_reminder(conn, patient_id, title, description, trigger_at, created_by_user_id, created_by_role) -> ReminderObject
def update_reminder(conn, reminder_id, fields: dict) -> ReminderObject
def delete_reminder(conn, reminder_id) -> None
def get_reminder(conn, reminder_id) -> ReminderObject | None
```

Create must validate `trigger_at > now`.

- [ ] **Step 3: cache.py**

In-process singleton dict `caches: dict[int, PatientEmbeddingCache]`. Per-patient `asyncio.Lock`.

```
@dataclass
class EmbeddingCacheEntry:
    face_id: int
    name: str
    title: str | None
    description: str | None
    embedding: np.ndarray  # float32[512], L2-normalized

@dataclass
class PatientEmbeddingCache:
    patient_id: int
    entries: list[EmbeddingCacheEntry]
    last_refreshed_at: datetime
    dirty: bool
    version: int

async def get_cache(patient_id: int) -> PatientEmbeddingCache
async def refresh(patient_id: int) -> None          # reloads from DB
def invalidate(patient_id: int) -> None              # sets dirty=True, bumps version
async def refresh_if_stale(patient_id: int) -> None  # if dirty or >30s old
def load_embeddings_from_db(conn, patient_id) -> list[EmbeddingCacheEntry]  # deserializes BLOBs
```

L2-normalize each embedding on load. BLOB deserialization: `np.frombuffer(blob, dtype=np.float32)` — expect `.shape == (512,)`. Normalize: `v / np.linalg.norm(v)` (guard against zero norm).

- [ ] **Step 4: llm.py**

Anthropic client call. Build prompt from `docs/PIPELINE.md §2.3`. Return `list[{face_id: int, content: str}]`. Validate:
- JSON parse
- Drop items with `face_id` not in the provided set
- Truncate any `content` >180 chars to 180

On any error (network, parse, invalid JSON), raise `LlmError` — caller handles.

- [ ] **Step 5: conversation.py**

```
def submit_transcript(conn, patient_id, transcript, recorded_at, duration_seconds, recognized_face_ids) -> transcript_id
async def process_transcript(transcript_id)  # background task
def get_transcript(conn, transcript_id) -> ConversationDetailResponse
```

`submit_transcript` inserts transcript + side rows in one transaction, returns id with status='queued'. `process_transcript` runs async: set status='processing' → call `llm.summarize` → insert memories → update status='completed' with `processed_at`. On LLM error set status='failed' and `error_message`. Finally call `cache.invalidate(patient_id)`.

- [ ] **Step 6: tts_proxy.py**

Async function `synthesize(text, voice_id) -> AsyncIterator[bytes]`: streams from ElevenLabs. Never log API key. Apply rate limit (see ratelimit utility).

- [ ] **Step 7: stt_proxy.py**

Async `transcribe(audio_bytes, filename, mime) -> SttResponse`. Validate size ≤10 MB upstream in router.

- [ ] **Step 8: Simple in-process rate limiter**

`backend/app/ratelimit.py`: token-bucket per (user_id, scope). Returns True/False. Used by routers via a dependency.

- [ ] **Step 9: Commit**

### Task B6: Routers (all REST endpoints)

**Files:**
- Create: `backend/app/routers/__init__.py` (empty)
- Create: `backend/app/routers/health.py`
- Create: `backend/app/routers/auth.py`
- Create: `backend/app/routers/patients.py`
- Create: `backend/app/routers/faces.py`
- Create: `backend/app/routers/memories.py`
- Create: `backend/app/routers/reminders.py`
- Create: `backend/app/routers/conversations.py`
- Create: `backend/app/routers/tts.py`
- Create: `backend/app/routers/stt.py`

For each, implement exactly the endpoints in `docs/API_SPEC.md §1-9`. Every handler:
1. Declares its auth dependency (none for `/api/health`; `get_auth` for everything else).
2. Declares its authority dependency (`require_patient`, `require_caretaker_of`, or `require_patient_or_caretaker_of`) via `Depends`.
3. Applies rate-limit dependency where the spec specifies.
4. Returns a pydantic response model exactly matching the spec.
5. Raises `HTTPException(status_code, detail=ErrorEnvelope(...))` for errors.

Authorization matrix comes from `docs/API_SPEC.md §0.4`. Translate it line-by-line.

Key traps that subagent must avoid:
- Return IDs as **strings**, not ints, even though DB stores ints. Build a serializer `_row_to_face(row)` etc.
- Return timestamps with `Z` suffix in UTC.
- `POST /api/faces/{id}/memories` rejects `source=conversation` with `422 SEMANTIC_ERROR`.
- `POST /api/patients/{id}/reminders` validates `trigger_at > now`; 422 otherwise.
- `POST /api/auth/register` idempotent: returns 201 on first call, 409 on subsequent with same `auth0_sub`.
- `GET /api/patients` only returns patients the caretaker is linked to.
- 404 distinction: `NOT_FOUND` (generic missing), `FACE_NOT_FOUND`, `MEMORY_NOT_FOUND`, `REMINDER_NOT_FOUND`.

- [ ] **Step 1: health.py (no auth)**

- [ ] **Step 2: auth.py — `/api/auth/me`, `/register`, `/caretaker/assign`**

- [ ] **Step 3: patients.py — `/api/patients`, `/patients/{id}/quick-info`, `/patients/{id}/activity`**

- [ ] **Step 4: faces.py**

- [ ] **Step 5: memories.py**

- [ ] **Step 6: reminders.py**

- [ ] **Step 7: conversations.py**

Uses `BackgroundTasks` to schedule `conversation.process_transcript`.

- [ ] **Step 8: tts.py** — returns `StreamingResponse(media_type="audio/mpeg")`

- [ ] **Step 9: stt.py** — reads UploadFile, checks size, calls stt_proxy

- [ ] **Step 10: Commit**

### Task B7: Recognition service + WebSocket

**Files:**
- Create: `backend/app/services/recognition.py`
- Create: `backend/app/routers/ws.py`

- [ ] **Step 1: recognition.py**

```python
class RecognitionEngine:
    def __init__(self):
        self._app = None  # insightface.app.FaceAnalysis

    def load(self):
        # Lazy initialize once. buffalo_l on CPU provider.
        from insightface.app import FaceAnalysis
        self._app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self._app.prepare(ctx_id=-1, det_size=(320, 320))

    def embed(self, rgb_np) -> np.ndarray:
        faces = self._app.get(rgb_np)
        if not faces:
            return np.zeros(512, dtype=np.float32)
        # Largest face
        faces.sort(key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]), reverse=True)
        emb = faces[0].normed_embedding.astype(np.float32)
        return emb

engine = RecognitionEngine()  # module singleton

def cosine_match(query: np.ndarray, cache: PatientEmbeddingCache) -> tuple[best, second] | None:
    if not cache.entries:
        return None
    M = np.stack([e.embedding for e in cache.entries])
    sims = M @ query
    order = np.argsort(sims)[::-1]
    best = (cache.entries[order[0]], float(sims[order[0]]))
    second = (cache.entries[order[1]], float(sims[order[1]])) if len(order) > 1 else (None, -1.0)
    return best, second
```

Decision: `matched = best_sim >= 0.50 AND (best_sim - second_sim) >= 0.05`.

- [ ] **Step 2: ws.py — handshake**

```python
@router.websocket("/ws/recognize")
async def recognize_ws(websocket: WebSocket):
    token = websocket.query_params.get("token")
    patient_id = websocket.query_params.get("patient_id")
    try:
        claims = verify_jwt(token)
    except Exception:
        await websocket.close(code=4401, reason="invalid_token")
        return

    auth = resolve_user(claims, db)
    if auth.role != "patient" or str(auth.user_id) != patient_id:
        await websocket.close(code=4403, reason="forbidden")
        return

    # Single-session enforcement: if ACTIVE_SESSIONS[patient_id] exists, close new with 4409.
    if patient_id in ACTIVE_SESSIONS:
        await websocket.close(code=4409, reason="duplicate_session")
        return
    ACTIVE_SESSIONS[patient_id] = True

    await websocket.accept()
    try:
        await cache_service.refresh(int(patient_id))
        cache = await cache_service.get_cache(int(patient_id))
    except Exception as e:
        await websocket.send_json({"type":"session_error","code":"CACHE_LOAD_FAILED","message":str(e)})
        await websocket.close(code=4500)
        ACTIVE_SESSIONS.pop(patient_id, None)
        return

    await websocket.send_json({
        "type":"session_ready",
        "patient_id": patient_id,
        "server_time": iso_utc(now()),
        "embedding_cache_loaded": True,
        "face_count": len(cache.entries),
    })

    # Session loop
    last_recognize_at = 0.0
    try:
        while True:
            msg = await websocket.receive_json()
            t = msg.get("type")
            if t == "ping":
                await websocket.send_json({"type":"pong","msg_id":msg["msg_id"],"server_time":iso_utc(now())})
            elif t == "recognize":
                now_ms = time.monotonic()*1000
                if now_ms - last_recognize_at < 500:
                    await websocket.send_json({"type":"error","msg_id":msg.get("msg_id"),"code":"RATE_LIMITED","message":"throttle"})
                    continue
                last_recognize_at = now_ms
                # decode, validate size, embed, match, respond
                ...
            else:
                await websocket.send_json({"type":"error","code":"BAD_FRAME","message":"unknown type"})
    except WebSocketDisconnect:
        pass
    finally:
        ACTIVE_SESSIONS.pop(patient_id, None)
```

Full recognize branch:
- base64-decode `image_b64`; if decoded size >200 KB → error IMAGE_TOO_LARGE
- validate mime in {image/jpeg, image/png}; else UNSUPPORTED_MIME
- open with PIL; convert to RGB numpy
- `await cache_service.refresh_if_stale(int(patient_id))`
- `emb = engine.embed(rgb)` inside `run_in_executor` (CPU-bound, don't block event loop)
- L2-normalize
- `cosine_match`; build matched or unknown payload

- [ ] **Step 3: Commit**

### Task B8: Main app wiring + seed + smoke tests

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/seed.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Create: `backend/tests/test_auth.py`
- Create: `backend/tests/test_faces.py`
- Create: `backend/tests/test_memories.py`
- Create: `backend/tests/test_reminders.py`
- Create: `backend/tests/test_conversations.py`

- [ ] **Step 1: main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .db import ensure_schema
from .routers import health, auth, patients, faces, memories, reminders, conversations, tts, stt, ws

settings = get_settings()
app = FastAPI(title="RememberMe API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(patients.router, prefix="/api")
app.include_router(faces.router, prefix="/api")
app.include_router(memories.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(tts.router, prefix="/api/tts")
app.include_router(stt.router, prefix="/api/stt")
app.include_router(ws.router)  # /ws/recognize has its own prefix

@app.on_event("startup")
async def on_startup():
    ensure_schema()
    if settings.SEED_ON_STARTUP:
        from . import seed
        seed.run()
```

- [ ] **Step 2: seed.py**

Insert fixture rows per `docs/DATA_SCHEMAS.md §10`. Idempotent: check existence before insert. Trigger_at for reminder: `now + 10 minutes`.

- [ ] **Step 3: conftest.py**

Pytest fixtures:
- `settings` overriding `SQLITE_PATH=":memory:"` and `DEV_AUTH_BYPASS=true`
- `client` — TestClient with fresh in-memory DB + schema applied + seed
- `patient_token` / `caretaker_token` — `"dev-patient-1-Alice"`, `"dev-caretaker-1-Carol"`

- [ ] **Step 4: test_health.py**

```python
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 5: test_auth.py**

Covers `/auth/me` (200 with headers, 401 without), `/auth/register` (201 then 409), `/auth/caretaker/assign`.

- [ ] **Step 6: test_faces.py**

Covers list/create/patch/delete; authority 403 for foreign caretaker; 409 on duplicate name.

- [ ] **Step 7: test_memories.py**

Covers CRUD, source authority (patient can't POST `source=caretaker`, etc.), `source=conversation` rejection.

- [ ] **Step 8: test_reminders.py**

Covers CRUD, `trigger_at must be future`, upcoming filter.

- [ ] **Step 9: test_conversations.py**

POST accepts valid payload, returns 202 with `queued`. Patches `llm.summarize` to a stub to avoid calling external API.

- [ ] **Step 10: Run tests**

```bash
cd backend && pytest -q
```
All green.

- [ ] **Step 11: Smoke-run the server**

```bash
cd backend && DEV_AUTH_BYPASS=true AUTH0_DOMAIN=dev.local AUTH0_AUDIENCE=dev ELEVENLABS_API_KEY=x ELEVENLABS_DEFAULT_VOICE_ID=x LLM_API_KEY=x python -m uvicorn app.main:app --port 5000 &
sleep 2
curl http://localhost:5000/api/health
```
Expect `{"status":"ok","version":"0.1.0"}`.

- [ ] **Step 12: Commit**

---

## Vision SPA Phase

### Task V1: Vision scaffold — Tailwind, deps, env, types

**Files:**
- Modify: `RememberMeInterface/package.json`
- Create: `RememberMeInterface/tailwind.config.js`
- Create: `RememberMeInterface/postcss.config.js`
- Create: `RememberMeInterface/.env.example`
- Create: `RememberMeInterface/.gitignore`
- Create: `RememberMeInterface/src/styles/index.css`
- Create: `RememberMeInterface/src/types/api.ts`
- Modify: `RememberMeInterface/vite.config.ts`
- Modify: `RememberMeInterface/src/main.tsx`

- [ ] **Step 1: Install deps**

```bash
cd RememberMeInterface && npm install @mediapipe/tasks-vision @ricky0123/vad-web tailwindcss postcss autoprefixer @fontsource/fraunces @fontsource/newsreader @fontsource/jetbrains-mono
npm install -D @types/node
```

- [ ] **Step 2: tailwind.config.js**

```js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--bg-base)",
        "bg-elevated": "var(--bg-elevated)",
        "ink-primary": "var(--ink-primary)",
        "ink-secondary": "var(--ink-secondary)",
        accent: "var(--accent)",
        "signal-cool": "var(--signal-cool)",
        "signal-warm": "var(--signal-warm)",
        rule: "var(--rule)",
      },
      fontFamily: {
        display: "var(--font-display)",
        text: "var(--font-text)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: postcss.config.js**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: src/styles/index.css**

```css
@import "@fontsource/fraunces/400.css";
@import "@fontsource/fraunces/700.css";
@import "@fontsource/newsreader/400.css";
@import "@fontsource/newsreader/600.css";
@import "@fontsource/jetbrains-mono/400.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-base: #0A0908;
  --bg-elevated: #1A1816;
  --ink-primary: #F5EEDC;
  --ink-secondary: #B8AF9E;
  --accent: #D4A65A;
  --signal-cool: #6B8A8E;
  --signal-warm: #C6733D;
  --rule: #2B2825;
  --focus-ring: #D4A65A;
  --font-display: 'Fraunces', Georgia, serif;
  --font-text: 'Newsreader', Georgia, serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

html, body, #root { height: 100%; width: 100%; margin: 0; background: var(--bg-base); color: var(--ink-primary); font-family: var(--font-text); }

*:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 5: types/api.ts**

Mirror of every client-facing shape from `docs/API_SPEC.md`. Include: `FaceObject`, `MemoryObject`, `ReminderObject`, `ConversationSubmitRequest/Response`, `SttResponse`, `SessionReadyMessage`, `RecognizeMessage`, `RecognitionResultMatched`, `RecognitionResultUnknown`, `PongMessage`, `WsErrorMessage`, `ErrorEnvelope`. Use TypeScript unions for the `matched` discriminant. String IDs everywhere.

- [ ] **Step 6: .env.example**

```
VITE_BACKEND_HTTP=http://localhost:5000
VITE_BACKEND_WS=ws://localhost:5000
```

- [ ] **Step 7: vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:5000", changeOrigin: true } },
  },
});
```

- [ ] **Step 8: main.tsx**

Import `./styles/index.css` before `App`.

- [ ] **Step 9: .gitignore**

```
node_modules/
dist/
.env
```

- [ ] **Step 10: Commit**

### Task V2: Vision services

**Files (all under `RememberMeInterface/src/services/`):**
- `session.ts`
- `rest_client.ts`
- `ws_client.ts`
- `detector.ts`
- `tracker.ts`
- `audio_player.ts`
- `voice_trigger.ts`
- `conversation_capture.ts`
- `reminder_poller.ts`

- [ ] **Step 1: `session.ts`**

Module-level singleton reading `?token=` and `?patient_id=` from `window.location`. Exposes `getToken()`, `getPatientId()`, `setToken(t)`. If missing, mark session as `errored` — App renders ErrorScreen.

- [ ] **Step 2: `rest_client.ts`**

Thin fetch wrapper. Auto-attaches `Authorization: Bearer <token>`. JSON in / JSON out. `tts(text)` returns `Blob` (audio/mpeg). `stt(audioBlob, patient_id)` uses FormData. Surfaces error envelope as thrown `ApiError`.

- [ ] **Step 3: `ws_client.ts`**

Class `WsClient` that:
- opens `${VITE_BACKEND_WS}/ws/recognize?token=...&patient_id=...`
- `onOpen`, `onSessionReady`, `onRecognitionResult`, `onSessionError`, `onClose` callbacks
- `send(msg)`; throttles `recognize` messages to ≤ 1 / 500ms (drops excess silently — the client MUST NOT send if too soon)
- ping every 30s
- exponential-backoff reconnect on close codes 1006/1011; stop reconnecting on 4401/4403/4409

- [ ] **Step 4: `detector.ts`**

MediaPipe BlazeFace via `@mediapipe/tasks-vision` (`FaceDetector`). `init()` loads model. `detect(videoEl) -> Detection[]` where `Detection = { bbox: {x,y,w,h}, score }`. Skip detections with `score < 0.70`.

- [ ] **Step 5: `tracker.ts`**

IoU tracker: maps current detections to persistent `frame_id`s by maximum IoU vs prior frame. Drops a frame_id if not matched for 3 frames. Returns `[{frame_id, bbox, score}]`.

- [ ] **Step 6: `audio_player.ts`**

Module with one `HTMLAudioElement`. `play(blob)` → set `src = URL.createObjectURL(blob)`, `.load()`, `.play()`. Any new call calls `pause()` + revokes old URL first (cancel-on-new). Observable `isPlaying` state.

- [ ] **Step 7: `voice_trigger.ts`**

Wraps `window.webkitSpeechRecognition || window.SpeechRecognition`. `continuous: true, interimResults: false, lang: 'en-US'`. Checks transcripts for `"who is this"`, `"who's this"`, `"who is that"` substrings (case-insensitive). Fires callback with last-known matched face payload if match is recent (≤10s). Auto-restart on `no-speech` error. Gracefully no-op if API unavailable.

- [ ] **Step 8: `conversation_capture.ts`**

Use `@ricky0123/vad-web` MicVAD. Segment = onset → 2s silence. Callback for each ended segment: if duration ≥ 5s, encode to wav via `MicVAD`'s utility, call `rest_client.stt`, then `rest_client.postConversation` with recognized face_ids captured at segment-start + 10s window. Includes degraded-mode using browser SpeechRecognition if STT endpoint returns non-2xx.

- [ ] **Step 9: `reminder_poller.ts`**

`start(patientId, onRemindersChanged)` — setInterval 30s. Each tick: `rest_client.getUpcomingReminders(patientId)`. Locally tracks `firedReminderIds: Set<string>`. On each 1Hz sub-timer: iterate upcoming, if `trigger_at - now <= 300s` and not already fired → fire event.

- [ ] **Step 10: Commit**

### Task V3: Vision components + App

**Files (all under `RememberMeInterface/src/components/`):**
- `VideoCanvas.tsx`
- `IdentityCard.tsx`
- `ReminderCard.tsx`
- `UnknownBadge.tsx`
- `AudioIndicator.tsx`
- `BootScreen.tsx`
- `ErrorScreen.tsx`
- Modify: `RememberMeInterface/src/App.tsx`

- [ ] **Step 1: BootScreen.tsx**

Fullscreen `bg-base`. Centered Fraunces display "RememberMe" 56px + Newsreader "Starting camera…" 24px. Single spinner with `animation-iteration-count: infinite` (allowed only here).

- [ ] **Step 2: ErrorScreen.tsx**

Centered card. Error text ≥24px. One retry button (ghost-style: 2px `--accent` border, no fill). `role="alert"`.

- [ ] **Step 3: VideoCanvas.tsx**

- `<video autoplay muted playsinline>` stretched to viewport, `object-fit: cover`
- Overlay `<canvas>` on top for bounding boxes drawn from detector output
- Starts `getUserMedia({video: {facingMode: 'user', width: 1280, height: 720}})` on mount
- In a `requestAnimationFrame` loop: run detector → tracker → draw boxes with 2px `--accent` stroke (matched) or 2px `--signal-warm` (unknown) — per frame_id state
- Exposes `pickFocusFace() -> frame_id | null` and `cropFace(frame_id) -> Blob|null`
- On each 500ms throttle window, if a focus face exists and no in-flight recognize, call `ws.sendRecognize(cropB64, frame_id, ...)`

- [ ] **Step 4: IdentityCard.tsx**

Absolute-positioned `<div>` above the referenced bbox.
- Fill `var(--bg-elevated)`, 1px `var(--rule)` border (no drop shadow — per §3.2 frontend rules)
- Name (Fraunces 40px bold)
- Title (Newsreader 24px regular, `--ink-secondary`)
- Memory summary (Newsreader 20px, max 2 lines, truncated at ~80 chars)
- `aria-live="polite"` hidden mirror text
- Enters with 200ms scale-from-95% + fade per `.cursor/rules/frontend.mdc §4.4`
- Lifetime 3s after last matching result OR until face leaves frame

- [ ] **Step 5: ReminderCard.tsx**

Bottom-right, 320px wide, 24px padding.
- Title Fraunces 28px bold
- Description Newsreader 20px
- Fade in 200ms / fade out 200ms after 15s
- `aria-live="assertive"`
- One at a time — singleton slot in App state

- [ ] **Step 6: UnknownBadge.tsx**

Small `?` icon over bbox top-right; `--signal-warm` fill; 20px square; no prompt. 200ms fade.

- [ ] **Step 7: AudioIndicator.tsx**

Small wave icon bottom-left corner; visible only when `audio_player.isPlaying` (subscribed via a simple observable).

- [ ] **Step 8: App.tsx**

Orchestrator. Lifecycle:
1. On mount: read `session.ts`; if token missing → show ErrorScreen ("Launch RememberMe from the Dashboard").
2. Mount VideoCanvas.
3. Open ws_client. On `session_ready` → state = `ready`.
4. Wire ws_client callbacks to update `lastMatchByFrameId`.
5. Voice trigger fires → read last match → POST tts/synthesize → audio_player.play.
6. Reminder poller fires → set active reminder + POST tts/synthesize → audio_player.play.
7. Conversation capture running throughout.
8. Render: video always; overlays conditional.

- [ ] **Step 9: Smoke-run**

```bash
cd RememberMeInterface && npm run dev
```
Open `http://localhost:3001/?token=dev-patient-1-Alice&patient_id=1`. Expect ErrorScreen to morph into camera view once backend is up. Camera permission prompt should appear.

- [ ] **Step 10: Commit**

---

## Dashboard SPA Phase

### Task D1: Dashboard scaffold — Tailwind, deps, auth wiring

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/tailwind.config.js`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/.env.example`
- Create: `dashboard/.gitignore`
- Create: `dashboard/src/styles/index.css`
- Create: `dashboard/src/types/api.ts`
- Modify: `dashboard/vite.config.ts`
- Modify: `dashboard/src/main.tsx`

- [ ] **Step 1: Install deps**

```bash
cd dashboard && npm install @auth0/auth0-react @tanstack/react-query react-router-dom lucide-react tailwindcss postcss autoprefixer @fontsource/fraunces @fontsource/newsreader @fontsource/jetbrains-mono
```

- [ ] **Step 2: tailwind.config.js — same structure as Vision but dashboard tokens**

```js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: {
      "bg-base": "var(--bg-base)",
      "bg-elevated": "var(--bg-elevated)",
      "bg-sunken": "var(--bg-sunken)",
      "ink-primary": "var(--ink-primary)",
      "ink-secondary": "var(--ink-secondary)",
      "ink-inverse": "var(--ink-inverse)",
      accent: "var(--accent)",
      "accent-patient": "var(--accent-patient)",
      "accent-caretaker": "var(--accent-caretaker)",
      "accent-ink": "var(--accent-ink)",
      "signal-warm": "var(--signal-warm)",
      "signal-cool": "var(--signal-cool)",
      rule: "var(--rule)",
    },
    fontFamily: { display: "var(--font-display)", text: "var(--font-text)", mono: "var(--font-mono)" },
  }},
  plugins: [],
};
```

- [ ] **Step 3: src/styles/index.css**

Same imports; dashboard tokens from §0.2. Add `body.role-caretaker { --accent: var(--accent-caretaker); }`. Background: base is `--bg-base`, plus a subtle SVG noise overlay at 4% opacity on `<body>::before` for texture (per frontend.mdc §3.1).

- [ ] **Step 4: types/api.ts**

Mirror of every dashboard-relevant shape from API_SPEC. Must agree with Vision's mirror on any shared shape. Include `MeResponse, RegisterRequest, PatientDirectoryResponse, FaceObject/List/Create/Patch, FaceEmbeddingRequest (for consistency), MemoryObject/List/Create/Patch, ReminderObject/List/Create/Patch, QuickInfoResponse, ActivityResponse, ErrorEnvelope`.

- [ ] **Step 5: vite.config.ts — port 3000 + /api proxy**

- [ ] **Step 6: .env.example**

```
VITE_BACKEND_HTTP=http://localhost:5000
VITE_BACKEND_WS=ws://localhost:5000
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=xxxxx
VITE_AUTH0_AUDIENCE=https://rememberme.app/api
VITE_VISION_URL=http://localhost:3001
VITE_DEV_AUTH_BYPASS=false
```

- [ ] **Step 7: Commit**

### Task D2: Dashboard shared — auth, rest, router, components

**Files:**
- `dashboard/src/auth/AuthProvider.tsx`
- `dashboard/src/auth/useAuthedFetch.ts`
- `dashboard/src/auth/useMe.ts`
- `dashboard/src/services/rest_client.ts`
- `dashboard/src/routes.tsx`
- `dashboard/src/components/*.tsx`
- Modify `dashboard/src/App.tsx`

- [ ] **Step 1: AuthProvider.tsx**

Wraps `@auth0/auth0-react` `Auth0Provider` with config from env. Also provides a **dev bypass mode** (`VITE_DEV_AUTH_BYPASS=true`): a light mock that exposes a `devLogin(role: 'patient'|'caretaker')` function returning a synthetic token `dev-<role>-1-<display>` and the shape matching `useAuth0`'s `user`/`getAccessTokenSilently`/`isAuthenticated`/`isLoading`. One hook `useAppAuth()` that normalizes real-vs-dev.

- [ ] **Step 2: useAuthedFetch.ts**

Returns a `fetch` wrapped that calls `getAccessTokenSilently()` and sets Bearer header, parses JSON, throws `ApiError(errorEnvelope)` on non-2xx.

- [ ] **Step 3: rest_client.ts**

Typed wrappers for every endpoint. Built on top of the authed fetch. Returns typed responses matching `types/api.ts`. E.g.:

```ts
export async function listFaces(f: AuthedFetch, patientId: string): Promise<FaceListResponse>
export async function createFace(f: AuthedFetch, patientId: string, body: FaceCreateRequest): Promise<FaceObject>
...
```

- [ ] **Step 4: useMe.ts**

`useQuery` hook: calls `GET /api/auth/me`. On 404 (first-time), calls `POST /api/auth/register` with `role` inferred from the intended portal + `display_name` from `user.name`.

- [ ] **Step 5: routes.tsx**

React Router v6 config:
```
/ → Home
/patient → <RequireRole role="patient"><PatientHome/></RequireRole>
/patient/faces → ...
/patient/faces/:id → ...
/patient/reminders → ...
/patient/settings → ...
/caretaker → ...
/caretaker/:patient_id → ...
/caretaker/:patient_id/faces → ...
/caretaker/:patient_id/faces/:face_id → ...
/caretaker/:patient_id/reminders → ...
```

`RequireRole` checks `useMe()`'s `role` and `toggles body.classList.toggle('role-caretaker', role==='caretaker')` as a side effect.

- [ ] **Step 6: Header.tsx**

Role pill (designed, not a Tailwind badge default):
- Fraunces 14px tracking-wide uppercase "PATIENT" or "CARETAKER"
- 1px `var(--accent)` border, no fill, 4px radius, 6px x 10px padding
- Body middle: patient name (Fraunces 32px) + short description (Newsreader 16px `--ink-secondary`)
- Header band: 1px bottom rule, no shadow

- [ ] **Step 7: PortalHomeCard.tsx**

Two adjacent-but-distinct zones (NOT twin buttons per frontend.mdc §6.4):
- Patient: warm text intro "For patients" + "Patient Portal" CTA (Fraunces 56px display)
- Caretaker: "For caretakers and family" + "Caregiver Portal" CTA
- Connecting hairline rule between them; no card shadows
- Background: layered cream→parchment gradient with subtle noise texture

- [ ] **Step 8: MemoryTree.tsx**

SVG-based concentric layout:
- Center node: patient's name (Fraunces 32px) inside a circle-or-rectangle with accent border
- Faces arrayed in a ring; each rendered as a small FaceCard with name + title + 1-line description
- Radial lines from center to each face (1px `--rule`)
- Click a face → navigate to detail
- Asymmetric spacing (not perfect grid) to feel authored

- [ ] **Step 9: FaceCard.tsx, MemoryList.tsx, MemoryRow.tsx, EditModeToggle.tsx, ReminderList.tsx, ReminderRow.tsx, CalendarGrid.tsx, ActivityFeed.tsx, PatientSelector.tsx**

Each component: typed props from `types/api.ts`, Tailwind + CSS variables only, no drop shadows, hairline rule borders.

- `MemoryRow`: date overline (JetBrains Mono 12px uppercase) + source badge (tiny) + content (Newsreader 18px as visual hero)
- `EditModeToggle`: ghost button bottom-center
- `ReminderRow`: time (JetBrains Mono) + title (Fraunces 20px) + description (Newsreader 16px)
- `CalendarGrid`: 7-day week view; dots on days with reminders
- `ActivityFeed`: three vertical sections with overline headers "NEWLY RECOGNIZED / RECENT CONVERSATIONS / UPCOMING REMINDERS" — NOT three-card-row silhouette

- [ ] **Step 10: Commit**

### Task D3: Dashboard pages

**Files:**
- `dashboard/src/pages/Home.tsx`
- `dashboard/src/pages/patient/PatientHome.tsx`
- `dashboard/src/pages/patient/Faces.tsx`
- `dashboard/src/pages/patient/FaceDetail.tsx`
- `dashboard/src/pages/patient/Reminders.tsx`
- `dashboard/src/pages/patient/Settings.tsx`
- `dashboard/src/pages/caretaker/CaretakerHome.tsx`
- `dashboard/src/pages/caretaker/CaretakerPatientHome.tsx`
- `dashboard/src/pages/caretaker/CaretakerFaces.tsx`
- `dashboard/src/pages/caretaker/CaretakerFaceDetail.tsx`
- `dashboard/src/pages/caretaker/CaretakerReminders.tsx`

- [ ] **Step 1: Home.tsx**

Portal selector. When clicking "Patient Portal" in dev bypass mode: calls `devLogin('patient')`, ensures `/api/auth/register` exists, navigates to `/patient`. Real mode: `loginWithRedirect({ appState: { target: '/patient' }, authorizationParams: { role_hint: 'patient' } })`.

After login, also shows a prominent "Launch Vision" button when on `/patient` that opens `${VITE_VISION_URL}/?token=${encodeURIComponent(accessToken)}&patient_id=${patient_id}` in a new tab.

- [ ] **Step 2: PatientHome.tsx**

Quick-info panel. `useQuery` `/quick-info` (stale 60s). Shows name + description + two large links "My People" / "Reminders & Lists". "Launch Vision" button below.

- [ ] **Step 3: Faces.tsx**

Renders MemoryTree.

- [ ] **Step 4: FaceDetail.tsx**

Header (face name/title/description, editable when Edit Mode on). MemoryList below. Patient can add/edit/delete `manual` memories only. Edit Mode toggle bottom-center, Save/Cancel appears when active.

- [ ] **Step 5: Reminders.tsx**

Today banner + today's reminders list + 7-day calendar grid. Edit button bottom-right for add/edit/delete.

- [ ] **Step 6: Settings.tsx**

Simple: display_name (from `/me`), logout button.

- [ ] **Step 7: CaretakerHome.tsx**

If `patients.length === 1`: redirect to `/caretaker/:patient_id`. Else: PatientSelector list.

- [ ] **Step 8: CaretakerPatientHome.tsx**

ActivityFeed + quick links to `/faces` and `/reminders`.

- [ ] **Step 9: Caretaker Faces/FaceDetail/Reminders**

Similar structure to patient pages but:
- Faces: caretaker may add face (name+title only, no embedding)
- FaceDetail: caretaker may edit ANY memory (including conversation)
- Reminders: caretaker may CRUD for the patient

- [ ] **Step 10: Smoke-run**

```bash
cd dashboard && npm run dev
```
With `VITE_DEV_AUTH_BYPASS=true`: home shows two portals; clicking Patient Portal lands on `/patient` with Alice's data.

- [ ] **Step 11: Commit**

---

## Integration Phase

### Task I1: End-to-end smoke

- [ ] **Step 1: Start all three**

Three separate shells:
- `cd backend && DEV_AUTH_BYPASS=true SEED_ON_STARTUP=true ... python -m uvicorn app.main:app --port 5000`
- `cd dashboard && npm run dev`
- `cd RememberMeInterface && npm run dev` (for the vision dev server, though Vision is normally launched from Dashboard)

- [ ] **Step 2: Dashboard flow**

Open `http://localhost:3000`. Click Patient Portal. Dev bypass signs Alice in. See faces tree with Sarah. Click Sarah → see caretaker memory "Works as a nurse." Add manual memory. Verify it appears.

- [ ] **Step 3: Reminders flow**

Navigate to Reminders. Existing seed reminder visible. Create new reminder with trigger 2 minutes out.

- [ ] **Step 4: Vision launch**

From Patient Portal home, click "Launch Vision". Vision opens in new tab with token. Camera prompt. Grant permission. See video + boxes around detected faces.

- [ ] **Step 5: Recognition**

Since Sarah has `embedding=NULL` from seed, first recognition will be `matched=false`. Verify UnknownBadge appears. (Full recognition needs a real face registered via embedding upload — acceptable to leave as TODO with a note.)

- [ ] **Step 6: Reminder fire**

Wait ~2 min (or create reminder with trigger 30s out). Verify ReminderCard appears bottom-right and TTS plays (requires ELEVENLABS_API_KEY set). If TTS fails, verify card still renders.

- [ ] **Step 7: Commit**

### Task I2: Contract parity check

- [ ] **Step 1: Diff shared shapes**

Open `backend/app/models.py`, `dashboard/src/types/api.ts`, `RememberMeInterface/src/types/api.ts` side-by-side. For each shape referenced in `docs/API_SPEC.md`: confirm fields, types, optionality match.

- [ ] **Step 2: Curl test each GET endpoint**

```bash
T="dev-patient-1-Alice"
curl -H "Authorization: Bearer $T" http://localhost:5000/api/auth/me
curl -H "Authorization: Bearer $T" http://localhost:5000/api/patients/1/faces
curl -H "Authorization: Bearer $T" http://localhost:5000/api/patients/1/quick-info
```

Field-by-field compare to API_SPEC.md.

- [ ] **Step 3: Final commit**

---

## Self-Review Notes

- **Spec coverage**: Every endpoint in API_SPEC.md §1-10 has a task (B4-B7). Every schema in DATA_SCHEMAS.md §1-7 is in B2. Every pipeline in PIPELINE.md has client-side service (V2) or server-side service (B5/B7). Every UI state in FRONTEND_SPEC.md has a component (V3/D2/D3).
- **No placeholders**: File names concrete, token values concrete, font names concrete. Thresholds/throttle values sourced from docs constants.
- **Type consistency**: IDs are strings in JSON everywhere. Timestamps are `Z`-suffixed. Pydantic models and both `api.ts` files agree.
- **Scope**: Hackathon MVP. Excluded: location anchors (not in docs), object scanning (not in docs), full Auth0 tenant setup (dev-bypass is sufficient for demo). These are not P0 for the build.
