# RememberMe — Repository Structure

Monorepo. Three top-level deployable units plus shared docs. Each unit is independently runnable.

```
RememberMe/
  backend/                  # FastAPI service
  dashboard/                # React dashboard SPA (patient + caretaker)
  RememberMeInterface/      # React vision SPA (patient-only)
  docs/                     # Source of truth for architecture and contracts
  .gitignore
  README.md                 # root readme (optional)
```

---

## 1. `backend/`

```
backend/
  app/
    main.py
    config.py
    db.py
    models.py
    deps.py
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
      health.py
      auth.py
      patients.py
      faces.py
      memories.py
      reminders.py
      conversations.py
      tts.py
      stt.py
      ws.py
    migrations/
      0001_initial.sql
  data/
    rememberme.db             # gitignored
  tests/
    test_auth.py
    test_faces.py
    test_memories.py
    test_reminders.py
    test_recognition.py
    test_conversations.py
  venv/                       # gitignored
  requirements.txt
  .env                        # gitignored
  .env.example
  .gitignore
```

### Run
```
cd backend
source venv/Scripts/activate      # Git Bash on Windows
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 5000
```

---

## 2. `dashboard/`

```
dashboard/
  public/
  src/
    main.tsx
    App.tsx
    routes.tsx                 # react-router config
    auth/
      AuthProvider.tsx         # @auth0/auth0-react wrapper
      useAuthedFetch.ts
    components/
      Header.tsx
      PortalHomeCard.tsx
      MemoryTree.tsx
      FaceCard.tsx
      MemoryList.tsx
      MemoryRow.tsx
      EditModeToggle.tsx
      ReminderList.tsx
      ReminderRow.tsx
      CalendarGrid.tsx
      ActivityFeed.tsx
      PatientSelector.tsx
    pages/
      Home.tsx
      patient/
        PatientHome.tsx
        Faces.tsx
        FaceDetail.tsx
        Reminders.tsx
        Settings.tsx
      caretaker/
        CaretakerHome.tsx
        CaretakerPatientHome.tsx
        CaretakerFaces.tsx
        CaretakerFaceDetail.tsx
        CaretakerReminders.tsx
    services/
      rest_client.ts
    types/
      api.ts                   # mirror of docs/API_SPEC.md
    styles/
      index.css
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  .gitignore
```

### Run
```
cd dashboard
npm install
npm run dev                    # serves on :3000
```

---

## 3. `RememberMeInterface/`

```
RememberMeInterface/
  public/
  src/
    main.tsx
    App.tsx
    components/
      VideoCanvas.tsx
      IdentityCard.tsx
      ReminderCard.tsx
      UnknownBadge.tsx
      AudioIndicator.tsx
      BootScreen.tsx
      ErrorScreen.tsx
    services/
      ws_client.ts
      rest_client.ts
      detector.ts
      tracker.ts
      audio_player.ts
      voice_trigger.ts
      conversation_capture.ts
      reminder_poller.ts
    state/
      session.ts
      recognition.ts
      reminders.ts
    types/
      api.ts                   # mirror of docs/API_SPEC.md
    styles/
      index.css
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  .gitignore
```

### Run
```
cd RememberMeInterface
npm install
npm run dev                    # serves on :3001
```

---

## 4. `docs/`

Source of truth for design, API contracts, pipelines, and schemas. Any AI agent working in this repo MUST read these before writing code.

```
docs/
  DESIGN_DOC.md         # purpose, philosophy, decisions
  ARCHITECTURE.md       # component topology and data flow
  API_SPEC.md           # REST + WS contracts — authoritative
  DATA_SCHEMAS.md       # SQLite schema + in-memory types
  PIPELINE.md           # step-by-step real-time and async flows
  FRONTEND_SPEC.md      # both SPAs' UIs and behaviors
  SERVICE_BACKEND.md    # backend service responsibilities
  REPO_STRUCTURE.md     # this file
```

---

## 5. Agent Navigation Guide

This repo is worked on by multiple AI coding agents (Cursor, Claude) in parallel. To avoid drift, follow these rules.

### 5.1 Before editing ANY code

| Editing…                             | Read first                                |
|--------------------------------------|-------------------------------------------|
| `backend/app/routers/*`              | `docs/API_SPEC.md` + `docs/SERVICE_BACKEND.md` |
| `backend/app/services/*`             | `docs/SERVICE_BACKEND.md` + `docs/PIPELINE.md` |
| `backend/app/models.py` or migrations| `docs/DATA_SCHEMAS.md`                    |
| `RememberMeInterface/src/services/ws_client.ts` | `docs/API_SPEC.md` §10 + `docs/PIPELINE.md` §1 |
| `RememberMeInterface/src/services/conversation_capture.ts` | `docs/PIPELINE.md` §2 |
| `RememberMeInterface/src/services/reminder_poller.ts` | `docs/PIPELINE.md` §3 |
| `dashboard/src/pages/patient/*`      | `docs/FRONTEND_SPEC.md` §2.3              |
| `dashboard/src/pages/caretaker/*`    | `docs/FRONTEND_SPEC.md` §2.4              |
| `dashboard/src/services/rest_client.ts` or `src/types/api.ts` | `docs/API_SPEC.md` |

### 5.2 Contract drift prevention

- `docs/API_SPEC.md` is the single source of truth for the REST and WS contracts.
- `backend/app/models.py` pydantic models and BOTH frontends' `src/types/api.ts` MUST match it byte-for-byte on shape.
- Any contract change MUST modify `docs/API_SPEC.md` in the same commit as the code change, and update all three consumers.
- If a field is ambiguous, the spec wins — do not "improve" the shape in isolation.

### 5.3 Separation of concerns

- **Backend is the only writer** to SQLite.
- **Backend is the only holder** of ElevenLabs and LLM keys.
- **Dashboard does not talk to Vision**, and vice versa.
- **Vision holds no persistent state** beyond the in-session recognition state and reminder poller.
- **Dashboard holds no camera, no mic, no MediaPipe**.

### 5.4 Environment files

Each unit has its own `.env`:

| File                                | Owner            | Contents                       |
|-------------------------------------|------------------|--------------------------------|
| `backend/.env`                      | backend only     | Auth0, ElevenLabs, LLM keys    |
| `dashboard/.env`                    | dashboard only   | `VITE_BACKEND_HTTP`, Auth0 SPA client ID |
| `RememberMeInterface/.env`          | vision only      | `VITE_BACKEND_HTTP`, `VITE_BACKEND_WS` |

Root `.env` does NOT exist.

### 5.5 Gitignore expectations

Each unit owns its own `.gitignore`:

- `backend/.gitignore` — `venv/`, `__pycache__/`, `.env`, `data/*.db*`
- `dashboard/.gitignore` — `node_modules/`, `dist/`, `.env`
- `RememberMeInterface/.gitignore` — same as dashboard

### 5.6 Testing boundaries

- Backend has `tests/` with pytest; each router + service has coverage.
- Frontends have no unit tests for hackathon scope; smoke-test by running `npm run dev` and exercising flows.

### 5.7 Ports (dev)

| Service               | Port |
|-----------------------|------|
| Backend (FastAPI)     | 5000 |
| Dashboard             | 3000 |
| RememberMeInterface   | 3001 |

Each frontend's `vite.config.ts` proxies `/api` to `http://localhost:5000`. WebSocket connections use `VITE_BACKEND_WS` directly (no proxy for WS).

### 5.8 Launch order

1. Start backend (port 5000).
2. Start Dashboard (port 3000).
3. Log in as patient in Dashboard. Click "Open Vision" (the Dashboard launches the Vision app in a new tab/window with token + patient_id on the URL).
4. Vision opens on port 3001, reads token, opens WS.

### 5.9 What NOT to do

- Do NOT add a new shared package (e.g. `packages/shared-types`). Keep each unit self-contained for hackathon velocity; duplicate `types/api.ts` across frontends and keep in lockstep via code review.
- Do NOT add Redis, a message queue, or Postgres. SQLite + in-process asyncio is the target.
- Do NOT move `docs/` inside any unit. `docs/` lives at root.
- Do NOT create mobile builds, Electron wrappers, or Docker compose for hackathon scope.
