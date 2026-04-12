# RememberMe — Data Schemas

All tables live in a single SQLite file at `backend/data/rememberme.db`. WAL mode is enabled for concurrent reads.

IDs are SQLite `INTEGER PRIMARY KEY AUTOINCREMENT`. Timestamps are stored as ISO 8601 strings in UTC. Embeddings are stored as raw `BLOB` of 2048 bytes (512 × float32, little-endian).

---

## 1. `patients`

| Column        | Type    | Null | Default       | Notes                                   |
|---------------|---------|------|---------------|-----------------------------------------|
| `id`          | INTEGER | no   | autoincrement | PK                                      |
| `auth0_sub`   | TEXT    | no   | —             | UNIQUE; `auth0|abc123` form             |
| `display_name`| TEXT    | no   | —             | 1–80 chars                              |
| `email`       | TEXT    | yes  | NULL          | from Auth0 profile, nullable            |
| `created_at`  | TEXT    | no   | CURRENT_TIMESTAMP | ISO 8601 UTC                         |

Indexes:
- UNIQUE `auth0_sub`

JSON shape returned to clients:
```json
{
  "patient_id": "7",
  "display_name": "Alice Patient",
  "email": "alice@example.com",
  "created_at": "2026-01-15T10:00:00Z"
}
```

---

## 2. `caretakers`

| Column        | Type    | Null | Default       | Notes                                   |
|---------------|---------|------|---------------|-----------------------------------------|
| `id`          | INTEGER | no   | autoincrement | PK                                      |
| `auth0_sub`   | TEXT    | no   | —             | UNIQUE                                  |
| `display_name`| TEXT    | no   | —             | 1–80 chars                              |
| `email`       | TEXT    | yes  | NULL          |                                         |
| `created_at`  | TEXT    | no   | CURRENT_TIMESTAMP |                                     |

Indexes:
- UNIQUE `auth0_sub`

---

## 3. `patient_caretakers` (many-to-many)

| Column         | Type    | Null | Default       | Notes                                   |
|----------------|---------|------|---------------|-----------------------------------------|
| `patient_id`   | INTEGER | no   | —             | FK → `patients.id` ON DELETE CASCADE    |
| `caretaker_id` | INTEGER | no   | —             | FK → `caretakers.id` ON DELETE CASCADE  |
| `created_at`   | TEXT    | no   | CURRENT_TIMESTAMP |                                     |

Composite PK: (`patient_id`, `caretaker_id`).

Indexes:
- `idx_patient_caretakers_patient_id`
- `idx_patient_caretakers_caretaker_id`

Authority rule: caretaker may act on patient iff a row exists here.

---

## 4. `faces`

| Column          | Type    | Null | Default       | Notes                                 |
|-----------------|---------|------|---------------|---------------------------------------|
| `id`            | INTEGER | no   | autoincrement | PK                                    |
| `patient_id`    | INTEGER | no   | —             | FK → `patients.id` ON DELETE CASCADE  |
| `name`          | TEXT    | no   | —             | 1–80 chars                            |
| `title`         | TEXT    | yes  | NULL          | 0–40 chars                            |
| `description`   | TEXT    | yes  | NULL          | 0–500 chars                           |
| `embedding`     | BLOB    | yes  | NULL          | 2048 bytes when set (512 × float32)   |
| `created_at`    | TEXT    | no   | CURRENT_TIMESTAMP |                                   |
| `updated_at`    | TEXT    | no   | CURRENT_TIMESTAMP | updated on every PATCH            |

Indexes:
- `idx_faces_patient_id`
- UNIQUE (`patient_id`, `lower(name)`) — soft uniqueness per patient (enforced with a trigger on insert/update)

Notes:
- `embedding` NULL is valid during the "caretaker pre-registered, Vision hasn't seen them yet" phase
- L2-normalize before storage so cosine similarity reduces to dot product

JSON shape:
```json
{
  "face_id": "42",
  "patient_id": "7",
  "name": "Sarah",
  "title": "daughter",
  "description": "Lives in Seattle.",
  "has_embedding": true,
  "created_at": "2026-02-15T09:30:00Z",
  "updated_at": "2026-04-01T11:00:00Z"
}
```

`has_embedding` is computed in the API layer as `embedding IS NOT NULL`.

---

## 5. `memories`

| Column                | Type    | Null | Default       | Notes                                   |
|-----------------------|---------|------|---------------|-----------------------------------------|
| `id`                  | INTEGER | no   | autoincrement | PK                                      |
| `face_id`             | INTEGER | no   | —             | FK → `faces.id` ON DELETE CASCADE       |
| `content`             | TEXT    | no   | —             | 1–280 chars                             |
| `source`              | TEXT    | no   | —             | CHECK IN ('conversation','manual','caretaker') |
| `created_by_user_id`  | INTEGER | yes  | NULL          | `patients.id` or `caretakers.id` depending on source; NULL for `conversation` |
| `created_by_role`     | TEXT    | yes  | NULL          | `'patient'` or `'caretaker'`; NULL for `conversation` |
| `transcript_id`       | INTEGER | yes  | NULL          | FK → `conversation_transcripts.id`; non-NULL only when source='conversation' |
| `created_at`          | TEXT    | no   | CURRENT_TIMESTAMP |                                     |
| `updated_at`          | TEXT    | no   | CURRENT_TIMESTAMP |                                     |

Indexes:
- `idx_memories_face_id`
- `idx_memories_face_id_created_at_desc` (composite, for "recent memories per face" query)
- `idx_memories_transcript_id`

Constraints:
- CHECK (`source != 'conversation' OR transcript_id IS NOT NULL`)
- CHECK (`source = 'conversation' OR created_by_user_id IS NOT NULL`)

JSON shape:
```json
{
  "memory_id": "301",
  "face_id": "42",
  "content": "Visited last Tuesday and brought flowers.",
  "source": "conversation",
  "created_by_user_id": null,
  "created_by_role": null,
  "transcript_id": "88",
  "created_at": "2026-04-08T16:20:00Z",
  "updated_at": "2026-04-08T16:20:00Z"
}
```

---

## 6. `conversation_transcripts`

| Column            | Type    | Null | Default       | Notes                                  |
|-------------------|---------|------|---------------|----------------------------------------|
| `id`              | INTEGER | no   | autoincrement | PK                                     |
| `patient_id`      | INTEGER | no   | —             | FK → `patients.id` ON DELETE CASCADE   |
| `transcript`      | TEXT    | no   | —             | 10–8000 chars                          |
| `recorded_at`     | TEXT    | no   | —             | ISO 8601 UTC (client clock)            |
| `duration_seconds`| REAL    | no   | —             | ≥ 5.0                                  |
| `status`          | TEXT    | no   | `'queued'`    | CHECK IN ('queued','processing','completed','failed') |
| `processed_at`    | TEXT    | yes  | NULL          | set on status transition to completed/failed |
| `error_message`   | TEXT    | yes  | NULL          | set when status = 'failed'             |
| `created_at`      | TEXT    | no   | CURRENT_TIMESTAMP |                                    |

Indexes:
- `idx_conversation_transcripts_patient_id`
- `idx_conversation_transcripts_status`

Side table `conversation_recognized_faces` binds a transcript to face IDs:

| Column         | Type    | Null | Notes                                        |
|----------------|---------|------|----------------------------------------------|
| `transcript_id`| INTEGER | no   | FK → `conversation_transcripts.id` ON DELETE CASCADE |
| `face_id`      | INTEGER | no   | FK → `faces.id` ON DELETE CASCADE            |

Composite PK (`transcript_id`, `face_id`).

JSON shape:
```json
{
  "transcript_id": "88",
  "patient_id": "7",
  "transcript": "Sarah said she flew in from Seattle...",
  "recorded_at": "2026-04-11T16:03:22Z",
  "duration_seconds": 42.5,
  "recognized_face_ids": ["42"],
  "status": "completed",
  "processed_at": "2026-04-11T16:03:48Z",
  "derived_memory_ids": ["301", "302"]
}
```

---

## 7. `reminders`

| Column               | Type    | Null | Default       | Notes                                   |
|----------------------|---------|------|---------------|-----------------------------------------|
| `id`                 | INTEGER | no   | autoincrement | PK                                      |
| `patient_id`         | INTEGER | no   | —             | FK → `patients.id` ON DELETE CASCADE    |
| `title`              | TEXT    | no   | —             | 1–80 chars                              |
| `description`        | TEXT    | yes  | NULL          | 0–280 chars                             |
| `trigger_at`         | TEXT    | no   | —             | ISO 8601 UTC; MUST be future at create  |
| `created_by_user_id` | INTEGER | no   | —             | `patients.id` or `caretakers.id`        |
| `created_by_role`    | TEXT    | no   | —             | CHECK IN ('patient','caretaker')        |
| `created_at`         | TEXT    | no   | CURRENT_TIMESTAMP |                                     |
| `updated_at`         | TEXT    | no   | CURRENT_TIMESTAMP |                                     |

Indexes:
- `idx_reminders_patient_id_trigger_at` (composite; for upcoming query)

JSON shape:
```json
{
  "reminder_id": "55",
  "patient_id": "7",
  "title": "Doctor appointment",
  "description": "Dr. Nguyen, 2nd floor.",
  "trigger_at": "2026-04-12T14:00:00Z",
  "created_by_user_id": "12",
  "created_by_role": "caretaker",
  "created_at": "2026-04-11T09:00:00Z",
  "updated_at": "2026-04-11T09:00:00Z"
}
```

---

## 7b. `pending_faces`

Unknown faces captured by Vision, awaiting a name. Embedding stored so the server can promote to a real `faces` row on accept, and can dedupe near-duplicate submissions on subsequent frames.

| Column          | Type    | Null | Default       | Notes                                 |
|-----------------|---------|------|---------------|---------------------------------------|
| `id`            | INTEGER | no   | autoincrement | PK                                    |
| `patient_id`    | INTEGER | no   | —             | FK → `patients.id` ON DELETE CASCADE  |
| `embedding`     | BLOB    | no   | —             | 2048 bytes (512 × float32 LE), L2-normalized |
| `thumbnail_b64` | TEXT    | no   | —             | base64 JPEG/PNG (≤50 KB decoded)      |
| `thumbnail_mime`| TEXT    | no   | —             | `image/jpeg` or `image/png`           |
| `captured_at`   | TEXT    | no   | —             | ISO 8601 UTC (client clock)           |
| `created_at`    | TEXT    | no   | CURRENT_TIMESTAMP |                                   |
| `updated_at`    | TEXT    | no   | CURRENT_TIMESTAMP | bumped on dedupe merge            |

Indexes:
- `idx_pending_faces_patient_id`
- `idx_pending_faces_patient_id_updated_at_desc` (composite, for list view ordering)

Dedupe rule (server-enforced): on `POST`, cosine-compare the new embedding against every existing pending face for this patient. If any similarity ≥ **0.85**, update the matched row in place (new embedding, new thumbnail, bump `updated_at`) instead of inserting. The server also matches the submission against registered `faces`: if cosine ≥ 0.50 AND margin ≥ 0.05, respond `already_known` and create nothing.

JSON shape (full, returned from POST):
```json
{
  "pending_face_id": "17",
  "patient_id": "7",
  "thumbnail_b64": "...",
  "thumbnail_mime": "image/jpeg",
  "captured_at": "2026-04-11T16:03:22Z",
  "created_at": "2026-04-11T16:03:22Z",
  "updated_at": "2026-04-11T16:10:44Z",
  "merged": false,
  "already_known": false
}
```

Embeddings are NOT returned in any client-facing response; they stay server-side until acceptance.

---

## 8. In-Memory Only Schemas

### 8.1 Embedding cache entry

Not persisted per session; rebuilt from `faces` table.

```
EmbeddingCacheEntry {
  face_id: int
  name: str
  title: str | None
  description: str | None
  embedding: np.ndarray[float32, (512,)]  # L2-normalized
  loaded_at: datetime (UTC)
}
```

Cache index (per-patient):
```
PatientEmbeddingCache {
  patient_id: int
  entries: list[EmbeddingCacheEntry]
  last_refreshed_at: datetime
  version: int  # increments on every mutation invalidation
}
```

### 8.2 Recognition result (internal)

```
RecognitionResult {
  matched: bool
  face_id: int | None
  confidence: float | None      # cosine similarity of best match
  margin: float | None          # best - second_best
  embedding: np.ndarray | None  # returned when unknown
}
```

### 8.3 WebSocket session state

```
RecognizeSession {
  session_id: UUID
  patient_id: int
  user_id: int
  connected_at: datetime
  last_recognize_at: datetime | None
  last_ping_at: datetime | None
  cache_ref: PatientEmbeddingCache
}
```

---

## 9. WebSocket Message Schemas

### 9.1 Client → Server

```ts
type ClientMessage =
  | { type: "recognize"; msg_id: string; frame_id: string;
      captured_at: string; image_b64: string; image_mime: "image/jpeg" | "image/png";
      bbox?: { x: number; y: number; w: number; h: number } }
  | { type: "ping"; msg_id: string }
```

### 9.2 Server → Client

```ts
type ServerMessage =
  | { type: "session_ready"; patient_id: string; server_time: string;
      embedding_cache_loaded: boolean; face_count: number }
  | { type: "session_error"; code: string; message: string }
  | { type: "recognition_result"; msg_id: string; frame_id: string;
      matched: true; face_id: string; name: string; title: string | null;
      confidence: number; margin: number; recent_memory_summary: string;
      server_time: string }
  | { type: "recognition_result"; msg_id: string; frame_id: string;
      matched: false; embedding: number[]; best_similarity: number;
      server_time: string }
  | { type: "pong"; msg_id: string; server_time: string }
  | { type: "error"; msg_id?: string; code: string; message: string }
```

---

## 10. Seed Data (hackathon dev fixture)

Minimum to get the system demoable:

```json
{
  "patients": [
    { "id": 1, "auth0_sub": "auth0|demo-patient", "display_name": "Alice Patient", "email": "alice@demo.test" }
  ],
  "caretakers": [
    { "id": 1, "auth0_sub": "auth0|demo-caretaker", "display_name": "Carol Caretaker", "email": "carol@demo.test" }
  ],
  "patient_caretakers": [
    { "patient_id": 1, "caretaker_id": 1 }
  ],
  "faces": [
    { "id": 1, "patient_id": 1, "name": "Sarah", "title": "daughter", "description": "Lives in Seattle.", "embedding": null }
  ],
  "memories": [
    { "id": 1, "face_id": 1, "content": "Works as a nurse.", "source": "caretaker", "created_by_user_id": 1, "created_by_role": "caretaker", "transcript_id": null }
  ],
  "reminders": [
    { "id": 1, "patient_id": 1, "title": "Take medication", "description": "Blue pill with water.", "trigger_at": "<future>", "created_by_user_id": 1, "created_by_role": "caretaker" }
  ]
}
```
