-- Pending faces queue — unknown embeddings captured by Vision awaiting a name.
-- Source of truth: docs/DATA_SCHEMAS.md §7b.
--
-- Rows are created by POST /api/patients/{id}/pending-faces, merged in-place
-- when a near-duplicate arrives (cosine ≥ 0.85), and deleted on accept/dismiss.
-- Embeddings are stored L2-normalized (2048 bytes, 512 × float32 little-endian)
-- so accept can copy them straight into the faces table.

CREATE TABLE IF NOT EXISTS pending_faces (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id     INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    embedding      BLOB NOT NULL,
    thumbnail_b64  TEXT NOT NULL,
    thumbnail_mime TEXT NOT NULL,
    captured_at    TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_faces_patient_id
    ON pending_faces (patient_id);

CREATE INDEX IF NOT EXISTS idx_pending_faces_patient_id_updated_at_desc
    ON pending_faces (patient_id, updated_at DESC);
