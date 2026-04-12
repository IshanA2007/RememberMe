# RememberMe — Architecture

## 1. Topology

```
 +--------------------+        +--------------------+
 |  RememberMeInterface|       |     Dashboard      |
 |    (vision SPA)    |        | (patient + caretaker|
 |                    |        |        SPA)        |
 |  React+Vite+TS     |        |   React+Vite+TS    |
 +---------+----------+        +----------+---------+
           |                              |
           |  WS /ws/recognize            |  REST /api/*
           |  REST /api/*                 |
           v                              v
     +-----+------------------------------+-----+
     |              FastAPI Backend             |
     |------------------------------------------|
     | HTTP router (REST)   WS router (/ws/*)   |
     |------------------------------------------|
     | auth_service      scheduling_service     |
     | recognition_svc   memory_service         |
     | cache_service     conversation_service   |
     | tts_proxy         stt_proxy              |
     +---+---------+---------+---------+--------+
         |         |         |         |
         v         v         v         v
     +-------+ +-------+ +-------+ +-------+
     |SQLite | |InsightF| |Auth0 | |Eleven |
     |(WAL)  | |(ArcFace)| |JWKS | |Labs + |
     |       | |512-d   | |      | |LLM    |
     +-------+ +-------+ +-------+ +-------+
```

Legend:
- Solid line = network call
- All external APIs (Auth0 JWKS, ElevenLabs, LLM) are called ONLY from the backend.

---

## 2. Subsystems

### 2.1 RememberMeInterface (Vision SPA)

| Module                | Responsibility                                               |
|-----------------------|--------------------------------------------------------------|
| `camera`              | Acquire webcam stream; publish `MediaStream` to consumers   |
| `detector`            | MediaPipe BlazeFace over animation frame loop               |
| `tracker`             | Smooth bounding boxes; assign stable local IDs              |
| `ws_client`           | Persistent connection to `/ws/recognize`; 500 ms throttle   |
| `overlay`             | Draws ID card over the face box                              |
| `voice_trigger`       | Listens for "who is this" or equivalent hotword             |
| `audio_player`        | Plays TTS blobs; cancels prior playback on new cue          |
| `conversation_capture`| VAD; 5 s min segment, 2 s silence gate; POSTs transcripts   |
| `reminder_poller`     | 30 s poll; fires T-5min events                              |
| `rest_client`         | Auth0 token attach; typed wrappers over REST endpoints      |

### 2.2 Dashboard (SPA)

| Module                | Responsibility                                               |
|-----------------------|--------------------------------------------------------------|
| `auth`                | Auth0 SPA SDK; passkey-first flow                           |
| `router`              | `/`, `/patient/*`, `/caretaker/*`                            |
| `patient_portal`      | Memory tree, schedule, quick-info for self                  |
| `caretaker_portal`    | Patient selector, memory tree, schedule editor, activity    |
| `memory_tree_view`    | Renders face network centered on "ME"                       |
| `schedule_view`       | Calendar + today's reminders + edit mode                    |
| `rest_client`         | Shared REST wrapper                                         |

### 2.3 Backend (FastAPI)

| Service                   | Responsibility                                          |
|---------------------------|---------------------------------------------------------|
| `auth_service`            | Validate JWT against Auth0 JWKS; resolve user; enforce role+patient access |
| `recognition_service`     | Load embeddings into cache; run InsightFace; cosine match; return result |
| `memory_service`          | CRUD on `memories`; enforce source + edit-authority     |
| `conversation_service`    | Accept transcript; invoke LLM; persist derived memories |
| `scheduling_service`      | CRUD on `reminders`; serve "upcoming" view              |
| `tts_proxy`               | Proxy to ElevenLabs TTS; streams audio back to client  |
| `stt_proxy`               | Proxy to ElevenLabs STT                                 |
| `cache_service`           | Per-patient in-memory embedding cache + TTL refresh     |

---

## 3. Communication Channels

### 3.1 WebSocket — `/ws/recognize`

- One connection per vision session
- Carries: auth handshake, face crop frames, recognition results, errors, ping/pong
- JSON-encoded text frames only
- Throttle: client must not send `recognize` more than once per 500 ms

### 3.2 REST — `/api/*`

- All mutations and non-real-time reads
- JSON body + JSON response
- JWT in `Authorization: Bearer <token>` header
- Versioning via path prefix (`/api/v1/...`) is out of scope for hackathon; endpoints live at `/api/...`

### 3.3 External

- Auth0 JWKS fetched at backend startup and cached; verified on each request
- ElevenLabs and LLM called only from inside backend services

---

## 4. Data Flow Diagrams

### 4.1 Recognition (real-time)

```
Client                          Server
------                          ------
frame loop ─► detect ─┐
                      ├─ crop ─► WS send {type: recognize, image_b64, ...}
                      │                                         │
                      │                              InsightFace embed
                      │                                         │
                      │                              cosine vs cache
                      │                                         │
                      │                              memory_service.recent()
                      │                                         │
                      ◄───────── WS recv {type: recognition_result, ...} ◄
overlay.render                                               │
voice_trigger? ─► POST /api/tts/synthesize ─────────────────►│
                   ◄── audio/mpeg ─────────────────────────── │
audio_player.play
```

### 4.2 Conversation → Memory (async)

```
Client                          Server                 External
------                          ------                 --------
VAD segment closes (2s silence)
  transcribe (ElevenLabs STT or browser)
  POST /api/conversations
                                accept payload
                                store transcript row
                                202 Accepted
                                                       ─► LLM summarize
                                                       ◄─ JSON array
                                INSERT memories
                                cache_service.invalidate(patient_id)
```

Client receives `202 Accepted` immediately; processing continues server-side.

### 4.3 Reminder delivery

```
Caretaker (Dashboard)
  POST /api/patients/{id}/reminders
           │
           ▼
        SQLite
           ▲
           │
Vision polls every 30s
  GET /api/patients/{id}/reminders/upcoming?window_seconds=600
           │
           ▼
  On trigger_time - now ≤ 300s:
    render overlay
    POST /api/tts/synthesize → audio
    play audio
    mark reminder 'fired' locally (do not re-fire until reload)
```

---

## 5. Real-time vs Async Pipeline Separation

| Pipeline              | Channel | Trigger                 | Blocking |
|-----------------------|---------|-------------------------|----------|
| Face recognition      | WS      | Every 500 ms per session | Yes, but bounded to 300 ms |
| Memory retrieval for ID card | Same WS msg | In-line with recognition | Yes; must finish with recognition reply |
| TTS on voice trigger  | REST    | Voice event             | No (client plays when audio returns) |
| Conversation ingest   | REST    | 2 s silence             | No (202 Accepted + async processing) |
| Reminder polling      | REST    | 30 s timer              | No |
| Cache refresh         | Internal| 30 s timer OR mutation  | No (runs in background task) |

---

## 6. Subsystem Boundaries

- **Backend owns ALL persistence.** Frontends MUST NOT cache server-authoritative data beyond the current view. The Vision in-memory face set lives on the server.
- **Frontend-to-frontend communication is forbidden.** The Dashboard and Vision SPAs never call each other; they only share state through the backend.
- **No client direct to ElevenLabs, LLM, or SQLite.** Every external call and every DB write is mediated by a backend service.
- **Auth0 is the only identity authority.** The backend does not mint tokens; it only validates them.

---

## 7. Deployment Shape (Hackathon)

- Single FastAPI process (`uvicorn`) on port 5000 (or 8000)
- Dashboard served on port 3000
- RememberMeInterface served on port 3001
- SQLite file at `backend/data/rememberme.db`
- `.env` holds `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `ELEVENLABS_API_KEY`, `LLM_API_KEY`
- CORS on backend must allow both frontend origins
