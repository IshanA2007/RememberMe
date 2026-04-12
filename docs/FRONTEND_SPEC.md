# RememberMe — Frontend Specification

Two SPAs, distinct scopes, one shared REST/WS backend.

| App                   | Folder                   | Port | Consumer role(s)        |
|-----------------------|--------------------------|------|-------------------------|
| RememberMeInterface   | `RememberMeInterface/`   | 3001 | Patient (vision only)   |
| Dashboard             | `dashboard/`             | 3000 | Patient + Caretaker     |

Both use React 18, Vite 5, TypeScript strict mode. Auth0 SPA SDK (`@auth0/auth0-react`) is used only in the Dashboard; the Vision app receives a short-lived token from the Dashboard at launch.

---

## 1. RememberMeInterface (Vision)

### 1.1 Purpose

Single-screen, full-viewport, low-chrome interface. The camera feed fills the screen. Overlays are drawn on top.

### 1.2 Scenes / states

Only one scene — there is no navigation within this app.

| State            | Trigger                                 | Visible elements                                         |
|------------------|-----------------------------------------|----------------------------------------------------------|
| `booting`        | App mount                               | Centered status text: "Starting camera..."               |
| `ready`          | Camera + WS ready                       | Live video only                                          |
| `tracking`       | ≥1 face detected                        | Video + bounding box(es)                                 |
| `identified`     | `recognition_result matched=true`       | Video + id card on matched bbox                          |
| `unknown`        | `recognition_result matched=false`      | Video + subtle `?` badge on bbox                         |
| `reminding`      | Reminder fires (T-5min)                 | Video + bottom-right reminder card (15 s)                |
| `speaking`       | TTS audio playing                       | Subtle audio indicator (wave icon) in corner             |
| `error`          | WS closed, camera denied, etc.          | Centered error with one retry button                     |

### 1.3 Overlay design

- **Identity card** (one at a time):
  - Large name (≥32 px, bold, high-contrast white on semi-opaque dark)
  - Title on the next line (≥24 px)
  - One-line memory summary underneath (≥20 px, up to 2 lines, text wrapped at 40 chars)
  - Rendered immediately above the face bbox
  - Lifetime: 3 s after last matching result OR until face leaves frame
- **Unknown badge**:
  - Small `?` icon in the top-right of the bbox
  - No prompting in-stream; caretaker handles via Dashboard
- **Reminder card**:
  - Bottom-right anchored, 320 px wide
  - Title (bold, 28 px) + description (regular, 20 px)
  - Fades in (200 ms), stays 15 s, fades out (200 ms)
  - Only one at a time; a new reminder cancels the previous card

### 1.4 Cognitive-load constraints

| Rule                                     | Enforcement                                |
|------------------------------------------|--------------------------------------------|
| Max 1 identity card                      | Singleton state; new match replaces prior  |
| Max 1 audio cue                          | Audio player cancels prior on `.load()`    |
| No flashing or pulsing                   | Linting rule: no `animation-iteration-count: infinite` except spinners on `booting` state |
| Base text ≥24 px                         | Root font-size 20 px, min Tailwind size `text-2xl` on any visible copy |
| Palette ≤4 hues                          | Tokens: bg-black, text-white, accent-blue, warn-amber |
| No modals, no layered UI                 | Vision has no dialog components             |

### 1.5 API usage patterns

| Channel          | Endpoint                               | Frequency                         |
|------------------|----------------------------------------|-----------------------------------|
| WS (persistent)  | `/ws/recognize`                        | open for session                  |
| WS send          | `recognize`                            | ≤ 2 Hz (500 ms throttle)          |
| WS send          | `ping`                                 | every 30 s                        |
| REST GET         | `/api/patients/{id}/reminders/upcoming`| every 30 s                         |
| REST POST        | `/api/tts/synthesize`                  | on voice trigger + on reminder fire |
| REST POST        | `/api/stt/transcribe`                  | on each completed conversation segment (fallback: browser STT) |
| REST POST        | `/api/conversations`                   | after each segment is transcribed |
| REST POST        | `/api/faces/{id}/embedding`            | occasional, on pending-face resolution |

### 1.6 Module layout

```
RememberMeInterface/src/
  main.tsx
  App.tsx
  components/
    VideoCanvas.tsx       # camera + MediaPipe overlay
    IdentityCard.tsx
    ReminderCard.tsx
    UnknownBadge.tsx
    AudioIndicator.tsx
    BootScreen.tsx
    ErrorScreen.tsx
  services/
    ws_client.ts          # /ws/recognize wrapper; throttle; reconnect
    rest_client.ts        # fetch wrapper with token
    detector.ts           # MediaPipe init + detect() per frame
    tracker.ts            # IoU tracker for stable frame_ids
    audio_player.ts       # cancel-on-new semantics
    voice_trigger.ts      # "who is this" listener
    conversation_capture.ts # VAD + segment + transcribe + POST
    reminder_poller.ts    # 30s tick; fire at T-5min
  state/
    session.ts            # token, patient_id, ws state
    recognition.ts        # last match per frame_id
    reminders.ts          # upcoming + fired ids
  types/
    api.ts                # typed mirror of API_SPEC schemas
```

### 1.7 UI state transitions

```
booting ─(camera+ws ok)─▶ ready
ready   ─(face seen)   ─▶ tracking
tracking─(match)       ─▶ identified
tracking─(no match)    ─▶ unknown
identified─(3s elapsed)─▶ tracking
any     ─(reminder T-5)─▶ +reminding layer (compositional, not exclusive)
any     ─(tts starts)  ─▶ +speaking layer (compositional)
any     ─(ws closed)   ─▶ error
```

`reminding` and `speaking` are additive layers, not modes. They do not pause the video or disable detection.

---

## 2. Dashboard

### 2.1 Purpose

Single React SPA serving both roles. The root renders a "choose your portal" screen; the JWT custom claim gates which sub-app loads.

### 2.2 Route map

```
/                          Home (portal selector)
/login                     Auth0 redirect target
/patient                   Patient portal home (quick info)
/patient/faces             Memory tree (for patient's own faces)
/patient/faces/:id         Face detail + memory list
/patient/reminders         Schedule view
/patient/settings          Basic profile

/caretaker                 Patient selector (if multiple) OR dashboard of sole patient
/caretaker/:patient_id     Caretaker home for a patient (activity view)
/caretaker/:patient_id/faces
/caretaker/:patient_id/faces/:face_id
/caretaker/:patient_id/reminders
```

Role enforcement: on mount of any `/patient/*` or `/caretaker/*` route, check `authContext.role`. If mismatched, redirect to `/`.

### 2.3 Patient portal UI

**Header** (always visible):
- Role tag: pill reading `PATIENT` on left
- Name + short description centered
- Distinct color scheme: `bg-blue-100` header band

**Main**: two primary navigation buttons at the top:
- `Reminders & Lists` → `/patient/reminders`
- `My People` (memory tree) → `/patient/faces`

**Memory tree view** (`/patient/faces`):
- Central node: ME (patient's name, age if provided, short description)
- Surrounding nodes: each face with `name`, `title`, and first line of `description`
- Clicking a node navigates to `/patient/faces/:id`
- Layout: force-directed or concentric; hackathon fallback = simple concentric grid with lines drawn to center node

**Face detail view** (`/patient/faces/:id`):
- Name, title, description at top (editable when Edit Mode is on)
- Memory list below, chronological desc
- Each memory row: content, source badge, timestamp
- Patient may:
  - Add a new person (name + optional title + optional description); the face scan is captured next time Vision sees them
  - Delete a person (cascades memories)
  - Clear an existing face scan so Vision captures a fresh embedding on next sighting (keeps the person and their memories)
  - Add new memory (source=`manual`)
  - Edit any memory on their own faces, regardless of source — including `conversation` memories the LLM produced verbally (the `source` field itself is never changed)
  - Delete any memory on their own faces

**Edit Mode toggle**:
- Bottom-center button labeled `Edit`; toggles mode for the whole face-detail screen
- Enabled fields show input borders; disabled fields are static text
- `Save` / `Cancel` pair appears in Edit Mode

**Persistent navigation**:
- Bottom-left: `Home` (→ `/patient`)
- Bottom-right: `Logout` (Auth0 logout, returns to `/`)

**Reminders view** (`/patient/reminders`):
- Top: `TODAY` banner with current date
- Below: list of today's reminders
- Further below: calendar grid (7-day week view) with reminder dots on each day
- Clicking a day filters the list below
- Bottom-right: `Edit` button → enables add/edit/delete

### 2.4 Caretaker portal UI

Same shape as Patient portal with these differences:

| Concern                     | Patient portal                     | Caretaker portal                        |
|-----------------------------|------------------------------------|-----------------------------------------|
| Role pill                   | `PATIENT` (blue)                   | `CARETAKER` (green)                     |
| Color scheme                | blue-based                          | green-based                              |
| Memory edit authority       | any on own face (incl. conversation) | any memory on assigned patients           |
| Face add                    | enabled (name+title only; embedding deferred) | enabled (name+title only; embedding deferred) |
| Face delete                 | enabled (cascades memories)        | enabled (cascades memories)               |
| Clear face embedding        | enabled (keeps row, drops scan)    | enabled (keeps row, drops scan)           |
| Multi-patient selector      | n/a                                 | `/caretaker` shows selector when `patients.length > 1` |
| Activity view               | not shown                           | `/caretaker/:patient_id` top section shows recent recognitions + recent conversation memories |
| Reminder authority          | CRUD own                            | CRUD for patient                         |

**Activity feed** (caretaker home):
- Section: `Newly recognized faces` (last 7 days) — each with name and first-seen time
- Section: `Recent conversation memories` (last 7 days) — each with face name, content, and a quick `Delete` / `Edit` button for corrections
- Section: `Upcoming reminders` (next 7 days)

### 2.5 Auth & home screen

**Home screen** (`/`, unauthenticated or ambiguous):
- Centered card with app name
- Two large buttons:
  - `Patient Portal`
  - `Caregiver Portal`
- Clicking either triggers `loginWithRedirect({ appState: { target: "/<role>" } })` on the Auth0 SDK with a hint about the expected role
- After auth, the app reads the role claim from the returned JWT; on mismatch, signs out and shows an error toast

### 2.6 Shared component library

```
dashboard/src/components/
  Header.tsx                  # role pill + name + color band
  PortalHomeCard.tsx
  MemoryTree.tsx              # consumed by both portals
  FaceCard.tsx
  MemoryList.tsx
  MemoryRow.tsx
  EditModeToggle.tsx
  ReminderList.tsx
  ReminderRow.tsx
  CalendarGrid.tsx
  ActivityFeed.tsx            # caretaker only
  PatientSelector.tsx         # caretaker only
```

### 2.7 Data-fetching strategy

- Use `@tanstack/react-query` for all REST calls.
- Query keys are strongly typed mirrors of endpoint paths.
- Stale time: 15 s for lists, 60 s for quick-info panel, 0 for mutations.
- Mutations invalidate the related query keys on success.

### 2.8 Polling vs WebSocket

- Dashboard uses **no WebSockets**.
- Dashboard uses **no polling** (beyond react-query refetch-on-focus defaults).
- The Dashboard does not need to stay in real-time sync with the Vision interface; the activity feed refreshes on navigation.

### 2.9 Error states

| Condition                              | UI                                           |
|----------------------------------------|----------------------------------------------|
| 401 on any call                        | Redirect to `/login`                         |
| 403 (caretaker on unassigned patient)  | Toast + redirect to `/caretaker`             |
| 404 on face/memory                     | Inline "not found" state with back link      |
| Network error                          | Inline retry button on the failing view       |
| Backend 5xx                            | Toast + auto-retry once after 2 s             |

### 2.10 UI state transitions (Patient portal example)

```
unauth ─(login)─▶ patient-home
patient-home ─(click My People)─▶ memory-tree
memory-tree ─(select face)─▶ face-detail(readonly)
face-detail(readonly) ─(toggle Edit)─▶ face-detail(editable)
face-detail(editable) ─(Save)─▶ face-detail(readonly, refreshed)
face-detail(editable) ─(Cancel)─▶ face-detail(readonly)
any ─(Home)─▶ patient-home
any ─(Logout)─▶ unauth
```

---

## 3. Cross-cutting Frontend Rules

### 3.1 Token handling
- Access token held in a single `AuthContext` in memory; never persisted to localStorage in plain text.
- Attach `Authorization: Bearer <token>` to every REST request.
- Vision WS opens with `?token=<jwt>&patient_id=<id>`; on 4401 close, attempt a silent re-auth via the Dashboard (Vision cannot re-auth on its own).

### 3.2 Type safety
- Each SPA includes `src/types/api.ts` hand-written to match `docs/API_SPEC.md`. No generated client; keep manual parity.
- Any endpoint change MUST update `api.ts` and `API_SPEC.md` together.

### 3.3 Styling
- Tailwind CSS 3.x in both apps.
- Vision app tokens constrained to the 4-hue palette described in §1.4.
- Dashboard may use a wider palette but still restrained; all copy ≥14 px, primary copy ≥16 px.

### 3.4 Accessibility
- All interactive elements have a visible focus outline.
- All icons have `aria-label`.
- Color contrast ≥4.5:1 on all text.
- Vision overlays include hidden `aria-live="polite"` text mirrors so screen-reader users hear matches too.

### 3.5 Environment variables (Vite)
```
VITE_BACKEND_HTTP=http://localhost:5000
VITE_BACKEND_WS=ws://localhost:5000
VITE_AUTH0_DOMAIN=<tenant>.auth0.com
VITE_AUTH0_CLIENT_ID=<spa client id>
VITE_AUTH0_AUDIENCE=https://rememberme.app/api
```
Dashboard reads all of the above. Vision reads only `VITE_BACKEND_HTTP` and `VITE_BACKEND_WS`; it receives its token from the Dashboard launcher.
