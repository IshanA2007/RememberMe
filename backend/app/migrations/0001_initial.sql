-- RememberMe initial schema.
-- Source of truth: docs/DATA_SCHEMAS.md §1-7 (+ conversation_recognized_faces side table).
-- Constants locked by CLAUDE.md §5.
--
-- Notes:
--   * IDs are INTEGER PRIMARY KEY AUTOINCREMENT.
--   * Timestamps are TEXT (ISO 8601 UTC).
--   * Embeddings are BLOB of 2048 bytes (512 float32 LE). NULL is valid during
--     the caretaker-pre-registered phase.
--   * Soft case-insensitive uniqueness on (patient_id, name) is enforced via a
--     unique functional index; no trigger required.
--   * Table creation order: tables with outgoing FKs come AFTER their targets
--     so SQLite accepts the schema regardless of deferred-FK mode.

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- §1. patients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    auth0_sub    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email        TEXT,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS patients_auth0_sub
    ON patients (auth0_sub);

-- ---------------------------------------------------------------------------
-- §2. caretakers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS caretakers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    auth0_sub    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email        TEXT,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS caretakers_auth0_sub
    ON caretakers (auth0_sub);

-- ---------------------------------------------------------------------------
-- §3. patient_caretakers (many-to-many)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patient_caretakers (
    patient_id   INTEGER NOT NULL REFERENCES patients (id)   ON DELETE CASCADE,
    caretaker_id INTEGER NOT NULL REFERENCES caretakers (id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (patient_id, caretaker_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_caretakers_patient_id
    ON patient_caretakers (patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_caretakers_caretaker_id
    ON patient_caretakers (caretaker_id);

-- ---------------------------------------------------------------------------
-- §4. faces
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS faces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id  INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    embedding   BLOB,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faces_patient_id
    ON faces (patient_id);

-- Soft case-insensitive uniqueness per patient (DATA_SCHEMAS §4).
CREATE UNIQUE INDEX IF NOT EXISTS faces_patient_lower_name
    ON faces (patient_id, lower(name));

-- ---------------------------------------------------------------------------
-- §6. conversation_transcripts (created before `memories` because memories.FK
--     points here)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_transcripts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id       INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    transcript       TEXT NOT NULL,
    recorded_at      TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    processed_at     TEXT,
    error_message    TEXT,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_transcripts_patient_id
    ON conversation_transcripts (patient_id);

CREATE INDEX IF NOT EXISTS idx_conversation_transcripts_status
    ON conversation_transcripts (status);

CREATE TABLE IF NOT EXISTS conversation_recognized_faces (
    transcript_id INTEGER NOT NULL
        REFERENCES conversation_transcripts (id) ON DELETE CASCADE,
    face_id       INTEGER NOT NULL
        REFERENCES faces (id) ON DELETE CASCADE,
    PRIMARY KEY (transcript_id, face_id)
);

-- ---------------------------------------------------------------------------
-- §5. memories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memories (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    face_id            INTEGER NOT NULL REFERENCES faces (id) ON DELETE CASCADE,
    content            TEXT NOT NULL,
    source             TEXT NOT NULL
        CHECK (source IN ('conversation', 'manual', 'caretaker')),
    created_by_user_id INTEGER,
    created_by_role    TEXT
        CHECK (created_by_role IS NULL OR created_by_role IN ('patient', 'caretaker')),
    transcript_id      INTEGER
        REFERENCES conversation_transcripts (id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (source != 'conversation' OR transcript_id IS NOT NULL),
    CHECK (source = 'conversation' OR created_by_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_memories_face_id
    ON memories (face_id);

CREATE INDEX IF NOT EXISTS idx_memories_face_id_created_at_desc
    ON memories (face_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_transcript_id
    ON memories (transcript_id);

-- ---------------------------------------------------------------------------
-- §7. reminders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reminders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id         INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    description        TEXT,
    trigger_at         TEXT NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    created_by_role    TEXT NOT NULL
        CHECK (created_by_role IN ('patient', 'caretaker')),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reminders_patient_id_trigger_at
    ON reminders (patient_id, trigger_at);
