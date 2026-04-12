# RememberMe — Pipelines

This document specifies every end-to-end pipeline in deterministic, ordered steps. Each step names the actor (`[C]` client, `[S]` server, `[X]` external) and any state mutation.

---

## 1. Vision Recognition Pipeline

### 1.1 Session establishment

1. **[C]** Dashboard has already authenticated patient via Auth0. RememberMeInterface boots with a valid access token in memory.
2. **[C]** Open WebSocket: `ws://HOST/ws/recognize?token=<jwt>&patient_id=<id>`.
3. **[S]** Validate JWT against Auth0 JWKS. On failure → close `4401`.
4. **[S]** Look up `patient_id` in `patients`. Confirm JWT `sub` matches `patients.auth0_sub`. On mismatch → close `4403`.
5. **[S]** If another live session exists for this `patient_id`, close the new one with `4409`. (Simplification for hackathon; single active session per patient.)
6. **[S]** Load all `(id, name, title, description, embedding)` rows for `faces WHERE patient_id = ?`.
7. **[S]** L2-normalize each embedding. Store in `PatientEmbeddingCache`.
8. **[S]** Send `session_ready` message.
9. **[C]** Start camera + detector + REST polling + voice trigger listener.

### 1.2 Frame-level detection loop (client-only, per animation frame)

10. **[C]** `requestAnimationFrame` fires.
11. **[C]** Pull latest frame from `<video>` element into `<canvas>`.
12. **[C]** Run MediaPipe BlazeFace on the canvas → array of `{bbox, confidence}`.
13. **[C]** For each detection with confidence ≥ 0.70, assign or re-use a local `frame_id` via IoU tracking against last frame.
14. **[C]** Draw bounding boxes + current overlay state. No identity label for faces not yet recognized.
15. **[C]** If `now - last_recognize_sent_at < 500 ms`, return — throttle window still open.
16. **[C]** Pick the largest face not currently labeled, or the face whose overlay has gone stale (>2 s since last match). Call this the `focus face`.
17. **[C]** Crop focus face bbox padded by 20%, resize to 160×160 JPEG, quality 80.
18. **[C]** Base64-encode the JPEG.
19. **[C]** Send WS message (see §4.4 of API_SPEC).
20. **[C]** Update `last_recognize_sent_at = now`.

### 1.3 Server recognition handling

21. **[S]** Receive `recognize` message. Parse JSON; validate shape.
22. **[S]** If `now - session.last_recognize_at < 500 ms` → send `error` `RATE_LIMITED`, return.
23. **[S]** Decode base64 → bytes. Validate ≤ 200 KB. Validate MIME.
24. **[S]** Decode image with PIL/Pillow. Convert to RGB numpy array.
25. **[S]** Run InsightFace face alignment + embedding extraction → `embedding ∈ R^512`.
    - If InsightFace finds zero faces in the crop, treat as `matched=false` with `embedding = zeros`. (This rarely happens because MediaPipe already confirmed a face.)
    - If InsightFace raises → send `error` `RECOGNIZER_FAILED`, return.
26. **[S]** L2-normalize `embedding`.
27. **[S]** Compute cosine similarity vs every entry in `PatientEmbeddingCache.entries` (dot product, since both sides normalized).
28. **[S]** Sort similarities descending. `best`, `second_best`.
29. **[S]** Decide:
    - If `best.similarity >= 0.50 AND (best.similarity - second_best.similarity) >= 0.05`:
      - `matched = true`
      - `face_id = best.face_id`
    - else:
      - `matched = false`
30. **[S]** If matched:
    - Query the 3 most recent memories for this `face_id`: `SELECT content FROM memories WHERE face_id=? ORDER BY created_at DESC LIMIT 3`.
    - Concatenate with `" "` separator, truncate to 280 chars → `recent_memory_summary`.
31. **[S]** Construct `recognition_result` message. Send.
32. **[S]** Update `session.last_recognize_at = now`.

### 1.4 Client response handling

33. **[C]** Receive `recognition_result`.
34. **[C]** If `matched=true`:
    - Attach overlay card to the bbox whose `frame_id` matches (or nearest if tracker moved it).
    - Card content: `name`, `title`, `recent_memory_summary`.
    - Overlay stays visible for 3 s OR until the face leaves frame.
35. **[C]** If `matched=false`:
    - Store `embedding` in an ephemeral `pendingRegistration` slot keyed by `frame_id`.
    - Render a subtle "unknown person" indicator.
    - Do NOT prompt immediately; wait for user interaction or caretaker later (hackathon: show a small `?` badge).

### 1.5 Voice-triggered memory dictation

36. **[C]** Voice trigger listener (see §4) fires `who_is_this` for the most recently matched face.
37. **[C]** If no currently matched face, ignore.
38. **[C]** Cancel any in-flight TTS audio.
39. **[C]** `POST /api/tts/synthesize` with text = `f"This is your {title or 'friend'}, {name}. {recent_memory_summary}"`.
40. **[S]** Backend forwards to ElevenLabs, streams MP3 back.
41. **[C]** Play MP3 via `HTMLAudioElement`. On `ended`, clear playing state.

### 1.6 Unknown face registration (server-persisted pending queue)

Unknown embeddings captured by Vision are persisted server-side in `pending_faces` and surfaced in the Dashboard for naming. This lets patients and caretakers register new people on the fly without ever pre-inputting data.

42. **[C]** Vision receives `matched=false` for a focus face. It crops a small (96×96) JPEG thumbnail of the same face bbox, base64-encodes it, and `POST /api/patients/{patient_id}/pending-faces` with `{embedding, thumbnail_b64, thumbnail_mime, captured_at}`.
43. **[C]** Vision throttles per-`frame_id` submissions to at most once every 10 seconds to avoid spamming the pending queue while the face stays in frame.
44. **[S]** Server cosine-compares the submission to every existing pending face for the patient. If any has similarity ≥ 0.85, the server updates that row in place (new embedding, new thumbnail, bump `updated_at`) and returns `merged: true`.
45. **[S]** Server also cosine-compares the submission to every registered face in the embedding cache. If best ≥ 0.50 AND best - second_best ≥ 0.05, no pending face is created: the server returns `already_known: true` plus the matched `face_id`. Client drops the pending state locally.
46. **[S]** Otherwise, server inserts a new `pending_faces` row and returns it with `merged: false, already_known: false`.
47. **[C]** Dashboard patient and caretaker portals both include a "Pending faces" section inside their `/faces` pages. The section polls `GET /api/patients/{patient_id}/pending-faces` on mount and on react-query focus refetch.
48. **[C]** Each pending face renders as: thumbnail + inline fields (`name`, `title`, `description`). Two actions: `Accept` (naming the face) and `Dismiss`.
49. **[C]** On Accept: `POST /api/pending-faces/{id}/accept` with `{name, title, description}`.
50. **[S]** Server atomically inserts a `faces` row with the stored embedding, deletes the pending row, and calls `cache_service.invalidate(patient_id)`.
51. **[S]** On Dismiss: `DELETE /api/pending-faces/{id}`. Row removed.
52. **[C]** Within the recognition cache refresh window (≤30 s), Vision starts seeing the newly-accepted face as `matched=true` on the next recognize tick.

### 1.7 Pending face lifecycle

- Pending faces persist indefinitely until accepted or dismissed (no TTL for hackathon scope).
- Re-submission of a very similar face (≥0.85 cosine) refreshes the stored thumbnail and embedding so the Dashboard view reflects the most recent capture.
- Pending faces are scoped strictly per patient; caretakers see only pending faces for patients in their `patient_caretakers` list.

---

## 2. Conversation → Memory Pipeline

### 2.1 Capture (client)

1. **[C]** On vision session start, acquire mic via `getUserMedia`.
2. **[C]** Feed mic to a VAD (voice activity detector) — `@ricky0123/vad-web` or similar.
3. **[C]** Maintain a rolling audio buffer. Each "segment" starts at speech onset and ends at the first 2-second silence.
4. **[C]** When a segment ends:
    - If `segment.duration < 5.0 s`, discard.
    - If `segment.duration ≥ 5.0 s`, proceed.
5. **[C]** Capture the list of currently recognized `face_id`s (those whose overlay is active in the last 10 s). Call this `recognized_face_ids`.
6. **[C]** Transcribe the audio:
    - Option A (preferred): `POST /api/stt/transcribe` with the audio blob.
    - Option B (fallback): use browser `SpeechRecognition` API and use its final transcript.
7. **[C]** If transcript is empty or < 10 chars, discard.

### 2.2 Submission

8. **[C]** `POST /api/conversations` with:
    ```json
    {
      "patient_id": "7",
      "transcript": "...",
      "recorded_at": "<segment_start>",
      "duration_seconds": 42.5,
      "recognized_face_ids": ["42", "55"]
    }
    ```
9. **[S]** Validate fields. Ensure all `recognized_face_ids` belong to `patient_id`.
10. **[S]** Insert row into `conversation_transcripts` with `status='queued'`.
11. **[S]** Insert rows into `conversation_recognized_faces`.
12. **[S]** Enqueue background task `process_transcript(transcript_id)`.
13. **[S]** Respond `202 { transcript_id, status: "queued" }`.

### 2.3 Server-side async processing

14. **[S]** Background worker dequeues `transcript_id`.
15. **[S]** Update `status='processing'`.
16. **[S]** Build LLM prompt (deterministic template):
    ```
    You extract short factual memories from spoken conversations involving a dementia patient.
    Each memory must be:
      - At most 180 characters
      - A single self-contained fact (no pronouns requiring outside context)
      - Attributable to one of the people present

    People present (by face_id): [ { "face_id": "42", "name": "Sarah", "title": "daughter" }, ... ]

    Conversation transcript:
    """
    {transcript}
    """

    Output JSON only, schema:
    { "memories": [ { "face_id": "<string>", "content": "<string>" } ] }

    Rules:
      - Only include face_ids from the "People present" list
      - If a fact has no clear owner, omit it
      - Return an empty memories array if no clear facts
    ```
17. **[S]** Call LLM. Parse response. Validate JSON + each `face_id` is in `recognized_face_ids`.
18. **[S]** For each valid memory, insert into `memories` with:
    ```
    source='conversation',
    transcript_id=<this>,
    created_by_user_id=NULL,
    created_by_role=NULL,
    content=<validated>
    ```
19. **[S]** Update transcript `status='completed'`, `processed_at=now`. Store the list of derived memory IDs for the `GET /api/conversations/{id}` response.
20. **[S]** Call `cache_service.invalidate(patient_id)` (this triggers the 30-second-max refresh window OR immediate refresh on the live WS session's next recognize cycle).

### 2.4 Failure handling

21. **[S]** On LLM error or parse failure:
    - Update `status='failed'`, `error_message=<reason>`
    - Do NOT retry automatically (hackathon simplification)
    - Do NOT insert any memories
- Transcript remains in the table for audit / caretaker review.

---

## 3. Reminder Pipeline

### 3.1 Creation (dashboard)

1. **[C]** Caretaker (or patient) selects "Add reminder" in the Dashboard schedule view.
2. **[C]** Fill `title`, `description`, `trigger_at`. Validate `trigger_at > now` client-side.
3. **[C]** `POST /api/patients/{patient_id}/reminders`.
4. **[S]** Validate authority (caller must own patient or be assigned caretaker).
5. **[S]** Validate `trigger_at` is a valid future ISO 8601 UTC.
6. **[S]** Insert row into `reminders` with `created_by_user_id` + `created_by_role`.
7. **[S]** Respond `201` with full reminder object.

### 3.2 Polling (vision)

8. **[C]** At vision session start, begin a 30-second interval timer.
9. **[C]** Every tick: `GET /api/patients/{patient_id}/reminders/upcoming?window_seconds=600`.
10. **[S]** Return reminders where `trigger_at BETWEEN now AND now + 600s`, ordered by `trigger_at` ASC.
11. **[C]** Merge returned list into a local `upcomingReminders` state keyed by `reminder_id`. Drop local entries no longer returned (deleted/edited past window).

### 3.3 Firing

12. **[C]** Each render frame (or each second via a 1 Hz timer), iterate `upcomingReminders`:
13. **[C]** If `reminder.trigger_at - now ≤ 300 s` AND this reminder has not yet fired in this session:
    - Mark it fired (local set of `firedReminderIds`).
    - Render a non-intrusive bottom-right card for 15 seconds with `title`.
    - `POST /api/tts/synthesize` with text = `f"Reminder: {title}. {description or ''}"`.
    - Play returned audio. Cancel any prior audio playback.
14. **[C]** If the same `reminder_id` is returned in a later poll (e.g. same minute re-poll), do not re-fire thanks to the local `firedReminderIds` set. The set persists for the session only.

### 3.4 Edit / delete propagation

15. Reminder edits via dashboard: next Vision poll (≤30 s later) returns the updated object. If the edit changed `trigger_at` such that the reminder should no longer fire, and it has not yet fired, remove it from local state. If it already fired (in `firedReminderIds`), leave it alone.
16. Reminder deletion: next poll no longer returns it → drop from local state. If already fired, nothing to undo.

---

## 4. Voice Trigger Pipeline (Vision)

1. **[C]** Create a persistent `SpeechRecognition` instance (webkitSpeechRecognition) with `continuous: true, interimResults: false, lang: 'en-US'`.
2. **[C]** On `result` event, check the transcript for the exact phrase OR one of these substrings (case-insensitive, trimmed):
   - "who is this"
   - "who's this"
   - "who is that"
3. **[C]** If matched AND a recognized face has been shown in the last 10 s: fire `who_is_this` event with that face's data.
4. **[C]** If matched AND no recent match: ignore.
5. **[C]** The voice recognition stream does NOT feed into conversation ingest. Conversation ingest uses the mic VAD pipeline separately.
6. **[C]** On `error` event of type `no-speech`: restart the recognition loop.

---

## 5. Embedding Cache Refresh Pipeline

### 5.1 On demand (mutation-triggered)

1. Every write to `faces` (INSERT, UPDATE of embedding, DELETE) calls `cache_service.invalidate(patient_id)`.
2. Invalidation sets `cache.dirty = true` and bumps `cache.version`.
3. Before each recognition, if `cache.dirty == true` OR `now - cache.last_refreshed_at > 30 s`, reload from DB.

### 5.2 On timer

4. A background task ticks every 30 s per active session.
5. If `cache.dirty`, reload embeddings synchronously.
6. Update `cache.last_refreshed_at = now`, `cache.dirty = false`.

### 5.3 Refresh operation

7. Acquire a short-lived read lock on the cache.
8. `SELECT id, name, title, description, embedding FROM faces WHERE patient_id=? AND embedding IS NOT NULL`.
9. Deserialize each BLOB → numpy `float32[512]`. L2-normalize.
10. Atomically swap `cache.entries` with the new list.

---

## 6. Authentication Pipeline

### 6.1 First-time login

1. **[C]** Dashboard user opens `/`. Clicks "Patient Portal" or "Caregiver Portal".
2. **[C]** Auth0 SPA SDK redirects to Auth0 Universal Login.
3. **[X]** Auth0 handles passkey flow; redirects back with authorization code.
4. **[C]** SPA exchanges code for tokens. Stores access token in memory.
5. **[C]** `GET /api/auth/me` with token.
6. **[S]** Validate JWT. Look up by `auth0_sub`.
7. **[S]** If no matching row → respond `404 NOT_FOUND`.
8. **[C]** On 404: `POST /api/auth/register` with `role` (derived from JWT custom claim `https://rememberme.app/role`) and `display_name` (from Auth0 profile).
9. **[S]** Create row in `patients` or `caretakers`. Respond `201`.
10. **[C]** Navigate to `/patient` or `/caretaker`.

### 6.2 Returning login

1. Steps 1–5 as above.
2. **[S]** `GET /api/auth/me` returns `200` with full profile.
3. **[C]** Navigate to role-appropriate route.

### 6.3 Vision handshake

1. **[C]** Patient-facing RememberMeInterface is launched from the Dashboard via a button/link that passes the access token (in-memory, e.g. via `window.open` + postMessage, or a shared query param on the launch URL — hackathon: dashboard opens `http://HOST:3001/?token=<jwt>&patient_id=<id>`).
2. **[C]** Vision SPA reads the token, stores in memory, opens WS.

---

## 7. Ordering Guarantees

- **Within a WS session**: recognition results are sent in the order of corresponding `recognize` messages. Client correlates by `msg_id`.
- **REST writes to `faces`**: ordered, single SQLite transaction each. A subsequent `GET` always reflects the write.
- **Conversation memory creation**: NOT ordered relative to other writes. Memories may appear up to 30 s after the underlying transcript was accepted.
- **Reminder fire**: within ±5 s of wall-clock `trigger_at` when `now` is within 5 minutes of trigger, assuming client was polling.
