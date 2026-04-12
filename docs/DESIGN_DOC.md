# RememberMe — Design Document

## 1. Purpose

RememberMe is a context-aware assistive memory support tool for individuals with mild-to-moderate dementia. It helps patients:

- Recognize familiar people through a camera-based interface
- Recall a short, factual description of those people on demand
- Receive scheduled reminders with synchronized visual and audio cues

The system has two user-facing surfaces: a real-time **Vision Interface** (RememberMeInterface) and a shared **Dashboard** for patient and caretaker data management. Both are clients of a single **FastAPI Backend** that owns all persistent state.

---

## 2. Philosophy

**Assistive, not companion.**

- The system does NOT hold open-ended conversations with the patient.
- The system does NOT roleplay as a friend, relative, or personality.
- The system does NOT give advice, emotional support, or medical guidance.

It reinforces memory through three tightly scoped mechanisms:

1. Visual overlays bound to real-world recognition events
2. Short, factual audio cues generated from stored memories (e.g. "This is your daughter, Sarah. She visited last Tuesday.")
3. Scheduled reminders delivered 5 minutes ahead of their trigger time

LLM usage is scoped to a **single task**: compacting conversation transcripts into short factual memory entries. LLMs are never used for dialogue, narration, or companionship.

---

## 3. Goals

- **G1** — Real-time recognition: familiar faces identified on-camera with p95 <300 ms end-to-end latency.
- **G2** — Low cognitive load: never more than one active overlay or audio cue at a time.
- **G3** — Data correctness: caretakers can correct any memory (including LLM-generated ones).
- **G4** — Key hygiene: third-party API keys (ElevenLabs, LLM) never leave the server.
- **G5** — Role-separated access: patients edit their own memories; caretakers can manage any assigned patient.
- **G6** — Decoupled surfaces: each frontend consumes a stable JSON contract; no shared state outside of HTTP/WS.

---

## 4. Non-Goals

- Open-ended AI chat or companionship
- Medical diagnosis, advice, or symptom interpretation
- Emotion or mood detection
- Identification of people not explicitly registered by patient or caretaker
- Passive, always-on audio recording without patient-initiated session
- Cross-patient face sharing ("global" identity)
- Multi-tenant / SaaS scaling (hackathon target: single-host deploy)
- Mobile-native apps (web-only)

---

## 5. High-Level Architecture

Three independently-deployable surfaces, one backend, one database.

| Surface               | Role                         | Tech                | Channel       |
|-----------------------|------------------------------|---------------------|---------------|
| RememberMeInterface   | Patient-facing vision UI     | React+Vite+TS       | WebSocket + REST |
| Dashboard             | Patient & Caretaker UI       | React+Vite+TS       | REST          |
| Backend               | State + recognition + proxy  | FastAPI (Python)    | HTTP + WS     |
| Database              | Single source of truth       | SQLite (file)       | —             |
| Auth0                 | Identity + passkeys          | External            | OAuth2/OIDC   |
| ElevenLabs            | TTS (and STT)                | External (server-only) | HTTPS     |
| LLM provider          | Conversation → memory        | External (server-only) | HTTPS     |

Single source of truth is the backend. Frontends hold ephemeral UI state only.

---

## 6. System Components

### 6.1 RememberMeInterface (Vision)
- Camera capture + MediaPipe BlazeFace detection (client-side, every frame)
- Persistent WebSocket to `/ws/recognize` for server-side recognition
- Voice-trigger handling ("who is this") → TTS playback of memory summary
- Background conversation capture (5+ second segments, 2 s silence gate) → transcript POST
- Reminder polling + T-5min overlay and TTS

### 6.2 Dashboard
- Auth0 login (passkey-first)
- Role router: `Patient Portal` vs `Caretaker Portal` (both served by this SPA)
- Memory tree view per face, edit mode, scheduling UI
- Caretaker-only: multi-patient selection + write access to any patient's memory

### 6.3 Backend (FastAPI)
- Services: `recognition`, `memory`, `conversation`, `scheduling`, `tts_proxy`, `stt_proxy`, `auth`, `cache`
- Owns SQLite, InsightFace model, in-memory face-embedding cache
- Validates all Auth0 JWTs at the edge
- Reverse-proxies ElevenLabs and LLM calls

### 6.4 Database (SQLite)
- Tables: `patients`, `caretakers`, `patient_caretakers`, `faces`, `memories`, `reminders`, `conversation_transcripts`
- Single-writer, WAL-mode for concurrent reads
- Embeddings stored as `BLOB` (512 × float32 = 2048 bytes)

---

## 7. Real-time vs Async Separation

The system has two tiers. Nothing in the async tier can block the real-time tier.

### 7.1 Real-time tier

| Operation                                       | Budget        | Owner    |
|-------------------------------------------------|---------------|----------|
| MediaPipe detection per frame                   | ≤16 ms        | client   |
| Crop + base64 encode                            | ≤5 ms         | client   |
| WebSocket recognition round-trip (p95)          | ≤300 ms       | both     |
| Overlay render after `recognition_result`       | ≤50 ms        | client   |
| Reminder fires within ±5 s of trigger time      | ±5 s          | both     |

### 7.2 Async tier (fire-and-forget; user never waits)

| Operation                                       | Typical        | Owner    |
|-------------------------------------------------|----------------|----------|
| Conversation transcript → memory entries        | 2–15 s         | server   |
| ElevenLabs TTS synthesis                        | 1–4 s          | server   |
| New memory becomes visible in recognition       | ≤30 s (cache refresh) | server |
| Cache refresh after dashboard mutation          | ≤30 s          | server   |

---

## 8. Key Design Decisions

### 8.1 Detection on client, recognition on server
Detection (find faces) runs in the browser at animation-frame rate using MediaPipe. Recognition (identify faces) runs server-side on InsightFace at a throttled 2 Hz. This keeps the overlay smooth at 60 fps while the server handles the heavy numeric work asynchronously.

### 8.2 2 Hz recognition throttle
Exactly **500 ms** minimum between `recognize` messages per WebSocket session. The client enforces this; the server drops frames that arrive faster as a second-layer defense.

### 8.3 512-d embeddings with cosine similarity
- Model: InsightFace ArcFace (`buffalo_l` or compatible)
- Embedding dim: **512**, dtype: **float32**, L2-normalized before storage
- Match rule: `cosine_similarity ≥ 0.50` AND `(best - second_best) ≥ 0.05`
- Below threshold or ambiguous → `unknown` result (embedding returned to client for registration)

### 8.4 Per-patient face isolation
Every recognition call is scoped to one `patient_id`. Faces registered to patient A are NEVER matched against patient B.

### 8.5 In-memory embedding cache
On WebSocket session start, the backend loads all `(face_id, embedding)` pairs for the active patient into RAM. Recognition reads from RAM, never SQLite. Cache refreshes on:
- Timer: every **30 s**
- Invalidation: any mutation to this patient's faces via REST

### 8.6 Source-tagged memories
Every memory row has a `source` enum:
- `conversation` — LLM-summarized from captured audio
- `manual` — patient-created via dashboard
- `caretaker` — caretaker-created or caretaker-edited

Edit authority:
- Patient may CRUD any memory on their own faces, including `conversation`-source memories — the LLM sometimes mis-paraphrases what was said and the patient should be able to correct their own record without needing to ask the caretaker. The `source` tag is still immutable (a `conversation` memory stays tagged `conversation` after edit so the audit trail is preserved).
- Caretaker may CRUD any memory on any assigned patient's faces. This remains the path for caretakers who want to correct an LLM error on a patient's behalf.
- Patients and caretakers may both CRUD faces on the patient's own roster, including creating a face with name + title only (embedding captured later by Vision) and clearing an existing face's embedding so Vision captures a fresh one.

### 8.7 ElevenLabs key stays server-side
All TTS/STT calls go through `/tts/synthesize` and `/stt/transcribe`. The client never sees the ElevenLabs API key.

### 8.8 Auth0 is the only credential store
- Passkey-first login (configured at the Auth0 tenant level)
- Backend stores Auth0 `sub` claim keyed to an internal integer user ID
- No password fields in the local database
- Role is carried in a custom Auth0 claim: `https://rememberme.app/role ∈ {patient, caretaker}`

### 8.9 Single SPA for both dashboard roles
Both patient and caretaker use the same dashboard SPA. The home screen offers a `Patient Portal` and `Caretaker Portal` entry; the role claim in the JWT gates which routes load.

### 8.10 Reminders use polling, not WebSocket
The Vision Interface polls `GET /patients/{id}/reminders/upcoming` every 30 s. Real-time reminder push is not required because fire windows are T-5min and polling error is ≤30 s.

---

## 9. Constraints

### 9.1 Performance
- Face detection: ≤16 ms per frame on commodity laptop CPU
- WebSocket recognition round-trip (p95): ≤300 ms on local network
- Embedding cache load: <1 s for ≤1000 faces (hackathon target ≤50)
- Reminder polling loop: 30 s fixed interval
- Conversation transcript upload: must trigger within 2 s of silence

### 9.2 Cognitive load (Vision Interface)
- At most **one** active identity card on screen
- At most **one** audio cue playing at a time — new cues cancel old ones
- No animation longer than 400 ms
- Base text size ≥24 px; critical text ≥32 px
- Color palette ≤4 hues + neutral background
- No flashing, blinking, or pulsing elements

### 9.3 Data consistency
- Dashboard mutation → Vision recognition visibility: ≤30 s
- All mutations are single-transaction on SQLite; no partial writes

### 9.4 Security
- All REST endpoints require a valid Auth0 JWT except `GET /health`
- WebSocket authentication: access token passed as query parameter `?token=...` on connect; connection closes with code `4401` if invalid
- Caretaker may only act on patients in their `patient_caretakers` list; enforced server-side on every request
- ElevenLabs and LLM keys loaded from environment, never returned in any API response

---

## 10. Data Flow Summary

```
[camera] → MediaPipe detect (client) → crop → WS recognize
         → InsightFace embed → cosine match → {face, recent memories}
         → overlay + (voice trigger?) → TTS proxy → audio playback

[mic]    → VAD (client) → 5+s segments, 2s silence
         → REST /stt/transcribe (optional) → /conversations
         → LLM summarize (server, async) → memories INSERT
         → cache refresh within 30s → visible on next recognition

[caretaker]→ Dashboard → POST /patients/{id}/reminders
         → SQLite
         → Vision polls every 30s
         → T-5min → overlay + TTS
```

---

## 11. Hackathon Feasibility

### 11.1 Difficulty tiers

| Tier     | Item                                                             |
|----------|------------------------------------------------------------------|
| Hard     | Real-time WebSocket pipeline, in-memory cache correctness, voice trigger reliability |
| Medium   | LLM prompt for memory extraction, TTS audio queueing, Auth0 custom claim for role |
| Easy     | Dashboard CRUD, reminders table, many-to-many relationship       |

### 11.2 Build order (critical-path first)

1. FastAPI skeleton + SQLite migrations + Auth0 JWT validation
2. Dashboard CRUD with one seeded patient and one seeded caretaker
3. `/ws/recognize` with a **stubbed** recognizer (returns a fixed match)
4. RememberMeInterface with MediaPipe detection only, rendering stubbed matches
5. Swap in real InsightFace; tune threshold
6. ElevenLabs TTS proxy + audio playback on voice trigger
7. Conversation capture + LLM summarization pipeline
8. Reminder polling + T-5min firing
9. Caretaker multi-patient flow

### 11.3 Cuttable scope (if time-constrained)
- STT via ElevenLabs can be replaced with browser `SpeechRecognition` API for hackathon demo
- "Recent activity" dashboard view can be a single query, no real-time stream
- Voice trigger can be a button tap for demo fallback
