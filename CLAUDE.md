# CLAUDE.md — RememberMe Agent Configuration

This file governs the behavior of every Claude instance operating inside this repository. It is binding. Do not deviate. Do not "improve" the rules in isolation.

---

## 0. The One Rule

**`docs/` is the single source of truth.**

Before writing or modifying ANY code, you MUST read the relevant docs. If code and docs disagree, docs win — update the code, not the docs, unless the user has explicitly requested a contract change (see §6).

Authoritative documents:

| Document                  | Governs                                              |
|---------------------------|------------------------------------------------------|
| `docs/DESIGN_DOC.md`      | Purpose, philosophy, non-goals, decisions            |
| `docs/ARCHITECTURE.md`    | Component topology, subsystem boundaries             |
| `docs/API_SPEC.md`        | REST + WebSocket contracts — byte-for-byte binding   |
| `docs/DATA_SCHEMAS.md`    | SQLite schema + in-memory types                      |
| `docs/PIPELINE.md`        | Step-by-step real-time and async flows               |
| `docs/FRONTEND_SPEC.md`   | Both SPAs' UI, routing, and behavior                 |
| `docs/SERVICE_BACKEND.md` | Backend service responsibilities and budgets        |
| `docs/REPO_STRUCTURE.md`  | File layout, env files, ports, launch order         |

---

## 1. Project Overview

RememberMe is an assistive memory tool for dementia patients. The system has THREE user-facing surfaces and ONE backend.

**Surfaces**
- `RememberMeInterface/` — real-time vision SPA (patient, port 3001)
- `dashboard/` — patient + caretaker SPA (port 3000)
- `backend/` — FastAPI service (port 5000)

**External dependencies (server-side only)**
- Auth0 (identity, passkey-first)
- ElevenLabs (TTS + STT)
- LLM provider (conversation → memory extraction)

**Persistence**: single SQLite file at `backend/data/rememberme.db` (WAL mode).

This is NOT a simple frontend/backend split. Read `docs/ARCHITECTURE.md` before reasoning about boundaries.

---

## 2. Role Assignment

Every Claude session operates in exactly ONE role. Declare it at the start of every task.

### 2.1 Frontend-focused Claude

**Owns**:
- `RememberMeInterface/**`
- `dashboard/**`

**Must**:
- Follow `docs/FRONTEND_SPEC.md` strictly for routes, components, states, and UI transitions.
- Apply `.cursor/rules/frontend.mdc` aesthetic philosophy in full.
- Mirror `docs/API_SPEC.md` types into each SPA's `src/types/api.ts` by hand. Keep them in lockstep.
- Treat the backend as a black box described entirely by `docs/API_SPEC.md`.

**Must NOT**:
- Touch `backend/**`.
- Invent, infer, or assume API endpoints or fields not in `docs/API_SPEC.md`.
- Share state between the two SPAs via anything other than backend HTTP/WS.
- Cache server-authoritative data beyond the current view.
- Add shared packages (no `packages/shared-types` — see `docs/REPO_STRUCTURE.md` §5.9).
- Place camera, mic, MediaPipe, or VAD inside `dashboard/`.
- Place WebSockets or polling inside `dashboard/` (beyond react-query focus refetch).

### 2.2 Backend-focused Claude

**Owns**:
- `backend/**`

**Must**:
- Follow `docs/SERVICE_BACKEND.md` for module layout, service boundaries, and performance budgets.
- Follow `docs/DATA_SCHEMAS.md` exactly for tables, columns, indexes, and constraints.
- Follow `docs/PIPELINE.md` for the step-by-step behavior of recognition, conversation, reminder, cache, and auth pipelines.
- Return responses that match `docs/API_SPEC.md` byte-for-byte (field names, types, enums, error envelope).
- Keep ElevenLabs and LLM keys server-side only. Never return them in any response. Never log them.

**Must NOT**:
- Touch `RememberMeInterface/**` or `dashboard/**`.
- Introduce a second database, Redis, Postgres, or a message broker.
- Add a framework other than FastAPI.
- Perform face recognition client-side or face detection server-side.
- Call ElevenLabs or the LLM from any frontend.

### 2.3 Role violations

If a task crosses roles (e.g. "add an endpoint and wire it into the dashboard"), STOP and split the work:
1. Backend Claude lands the endpoint + updates `docs/API_SPEC.md` in the same commit.
2. Frontend Claude mirrors the type into `src/types/api.ts` and wires the UI.

Never attempt both in one session without explicit operator approval.

---

## 3. Global Rules (Both Roles)

1. **Docs before code.** Read the specific doc section named in `docs/REPO_STRUCTURE.md` §5.1 before editing the corresponding file.
2. **Docs before behavior change.** If a change alters observable behavior (response shape, status code, pipeline order, UI state machine), update the governing doc in the SAME commit.
3. **No invention.** Do not add endpoints, fields, enums, error codes, routes, or UI states that are not in the docs.
4. **No drift.** If `backend/app/models.py`, `dashboard/src/types/api.ts`, and `RememberMeInterface/src/types/api.ts` disagree on a shape, treat it as a P0 bug.
5. **Modularity.** Keep each unit self-contained. No cross-unit imports. No shared packages.
6. **Determinism.** Use the exact constants in the docs (thresholds `0.50`/`0.05`, throttle `500 ms`, poll `30 s`, T-5min `300 s`, embedding dim `512`, L2-normalize before storage).
7. **Security boundaries.** Auth0 is the only identity authority. ElevenLabs and LLM keys never leave the server. All `/api/*` endpoints except `GET /api/health` require a valid JWT.
8. **One scope.** Don't refactor adjacent code, rename files, or introduce abstractions beyond what the task requires.
9. **No new dependencies without approval.** If you need a new package, ask first.
10. **No commented-out code, no TODOs without a linked issue, no dead files.**

---

## 4. Forbidden Patterns

| Pattern                                                | Why forbidden                         |
|--------------------------------------------------------|---------------------------------------|
| Client-side InsightFace / embedding computation        | Violates `DESIGN_DOC.md` §8.1         |
| Server-side MediaPipe / per-frame face detection       | Same                                  |
| Any endpoint not documented in `API_SPEC.md`           | Contract drift                        |
| `localStorage` of raw Auth0 access tokens              | Violates `FRONTEND_SPEC.md` §3.1      |
| Returning `ELEVENLABS_API_KEY` / `LLM_API_KEY` in any response | Violates `DESIGN_DOC.md` §G4          |
| Cross-patient face matching                            | Violates `DESIGN_DOC.md` §8.4         |
| Recognition throttle faster than 500 ms                | Violates `DESIGN_DOC.md` §8.2         |
| Open-ended chat / companion behavior from the LLM      | Violates `DESIGN_DOC.md` §2           |
| Mocking the database in backend tests                  | Tests must hit a real SQLite fixture  |
| Introducing Redis / Postgres / a message queue         | Violates `REPO_STRUCTURE.md` §5.9     |
| Dashboard opening a WebSocket                          | Violates `FRONTEND_SPEC.md` §2.8      |
| Vision app using Auth0 SDK                             | Vision receives token from Dashboard  |
| Flashing, blinking, pulsing elements in Vision         | Violates `DESIGN_DOC.md` §9.2         |
| More than one identity card or audio cue at once       | Violates `DESIGN_DOC.md` §9.2         |
| Frontend-to-frontend communication                     | Violates `ARCHITECTURE.md` §6         |

---

## 5. Deterministic Constants

These values appear verbatim in the docs. Do not change them without updating every doc that references them.

| Constant                        | Value          | Source                      |
|---------------------------------|----------------|-----------------------------|
| Embedding dimension             | 512            | `DATA_SCHEMAS.md` §4        |
| Embedding dtype                 | float32        | `DATA_SCHEMAS.md` §4        |
| Embedding BLOB size             | 2048 bytes     | `DATA_SCHEMAS.md` intro     |
| Recognition threshold           | 0.50           | `DESIGN_DOC.md` §8.3        |
| Recognition margin              | 0.05           | `DESIGN_DOC.md` §8.3        |
| WS `recognize` throttle         | 500 ms         | `API_SPEC.md` §10.4         |
| Cache refresh timer             | 30 s           | `DESIGN_DOC.md` §8.5        |
| Reminder poll interval          | 30 s           | `DESIGN_DOC.md` §8.10       |
| Reminder fire window            | T−5 min (300 s)| `DESIGN_DOC.md` §2          |
| Conversation min duration       | 5.0 s          | `API_SPEC.md` §6.1          |
| Silence gate                    | 2 s            | `PIPELINE.md` §2.1          |
| Memory content max              | 280 chars      | `DATA_SCHEMAS.md` §5        |
| LLM per-memory hard cap         | 180 chars      | `SERVICE_BACKEND.md` §2.5   |
| TTS text max                    | 1000 chars     | `API_SPEC.md` §7.1          |
| STT file max                    | 10 MB          | `API_SPEC.md` §7.2          |
| WS image_b64 decoded max        | 200 KB         | `API_SPEC.md` §12           |
| Auth0 role claim path           | `https://rememberme.app/role` | `DESIGN_DOC.md` §8.8 |

---

## 6. Contract Change Protocol

When (and only when) the operator explicitly asks you to change a contract:

1. **Propose** the change in text first. Enumerate every consumer: backend models, `dashboard/src/types/api.ts`, `RememberMeInterface/src/types/api.ts`, pydantic models, router handlers, doc sections.
2. **Update docs first**: `API_SPEC.md` and (if relevant) `DATA_SCHEMAS.md`, `PIPELINE.md`, `FRONTEND_SPEC.md` in the same commit.
3. **Update all consumers in lockstep** in the SAME pull request. A contract change landing without all consumers updated is a revert candidate.
4. **Add migration** if the schema changed: new SQL file in `backend/app/migrations/` following the `NNNN_*.sql` pattern. Never edit an existing migration.

See `.cursor/rules/api-contracts.mdc` for the full enforcement checklist.

---

## 7. Testing Discipline

- Backend: `pytest` under `backend/tests/`. Each router and service must have coverage. Tests MUST exercise a real SQLite fixture, not mocks — mock/prod divergence has historically masked broken migrations.
- Frontend: no unit tests for hackathon scope. Smoke-test by running `npm run dev` and exercising the flow described in `docs/PIPELINE.md`.
- Before claiming "done" on UI work, start the dev server and click through the feature in the browser. Type-check passing is not feature-correct.
- Before claiming "done" on backend work, hit the endpoint with `curl` or `httpx` and verify the response matches `API_SPEC.md` field-for-field.

---

## 8. Communication Between Parallel Claude Sessions

Multiple Claude instances work in this repo concurrently — typically one on the frontend, one on the backend. They do not share memory. Coordinate through:

1. **The docs.** Every cross-cutting decision is encoded there.
2. **Commit messages.** Reference the spec section you changed (e.g. `API_SPEC §4.2`).
3. **Never assume** what the other session did. Re-read the spec and the code before wiring.

If you find a contract disagreement between backend and frontend in the live code, STOP and report it to the operator — do not silently "fix" one side to match the other.

---

## 9. Hackathon Scope Reminders

- Single host, single SQLite file. No SaaS scaling concerns.
- Web only. No mobile, no Electron, no Docker compose.
- Single active WebSocket session per patient (server closes duplicates with `4409`).
- STT fallback to browser `SpeechRecognition` is acceptable per `DESIGN_DOC.md` §11.3.

See `docs/DESIGN_DOC.md` §11 for cuttable scope. Do not cut things outside that list without approval.

---

## 10. When You're Unsure

1. Re-read the relevant doc section.
2. If the doc is ambiguous, surface the ambiguity to the operator and propose a spec clarification. Do not guess.
3. If the doc is silent, the behavior is out of scope. Do not invent it.
