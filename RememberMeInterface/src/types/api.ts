// Types mirrored by hand from docs/API_SPEC.md.
// IDs are signed 64-bit integers rendered as decimal strings.
// Timestamps are ISO 8601 UTC strings ending in `Z`.
//
// Keep this file in lockstep with docs/API_SPEC.md. See CLAUDE.md §6
// (contract change protocol).

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type Id = string;
export type IsoUtc = string;

// ---------------------------------------------------------------------------
// Error envelope (API_SPEC §0.3)
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "FACE_NOT_FOUND"
  | "MEMORY_NOT_FOUND"
  | "REMINDER_NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SEMANTIC_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR";

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: ErrorBody;
}

// ---------------------------------------------------------------------------
// Faces (API_SPEC §3)
// ---------------------------------------------------------------------------

export interface FaceObject {
  face_id: Id;
  patient_id: Id;
  name: string;
  title: string | null;
  description: string | null;
  has_embedding: boolean;
  created_at: IsoUtc;
  updated_at: IsoUtc;
}

/** Vision posts this against POST /api/faces/{face_id}/embedding (§3.4). */
export interface FaceEmbeddingRequest {
  embedding: number[]; // length 512
}

// ---------------------------------------------------------------------------
// Pending Faces (API_SPEC §3b)
// ---------------------------------------------------------------------------

/** Thumbnail MIME types accepted by /api/patients/{id}/pending-faces. */
export type PendingFaceThumbnailMime = "image/jpeg" | "image/png";

/** Vision → server: §3b.1 body. */
export interface PendingFaceCreateRequest {
  embedding: number[]; // length 512
  thumbnail_b64: string;
  thumbnail_mime: PendingFaceThumbnailMime;
  captured_at: IsoUtc;
}

/** Server response for §3b.1 (new row, merged row, or already_known). */
export interface PendingFaceObject {
  pending_face_id: Id | null;
  patient_id: Id;
  thumbnail_b64: string;
  thumbnail_mime: PendingFaceThumbnailMime;
  captured_at: IsoUtc;
  created_at: IsoUtc;
  updated_at: IsoUtc;
  merged: boolean;
  already_known: boolean;
  face_id?: Id | null;
}

/** Server → client list row (no embedding) for §3b.2. */
export interface PendingFaceListItem {
  pending_face_id: Id;
  patient_id: Id;
  thumbnail_b64: string;
  thumbnail_mime: PendingFaceThumbnailMime;
  captured_at: IsoUtc;
  created_at: IsoUtc;
  updated_at: IsoUtc;
}

/** Container for §3b.2. */
export interface PendingFaceListResponse {
  pending_faces: PendingFaceListItem[];
}

/** Dashboard → server: §3b.3 accept body. */
export interface PendingFaceAcceptRequest {
  name: string;
  title?: string | null;
  description?: string | null;
}

/** Server → client for §3b.3. */
export interface PendingFaceAcceptResponse {
  face: FaceObject;
}

// ---------------------------------------------------------------------------
// Memories (API_SPEC §4)
// ---------------------------------------------------------------------------

export type MemorySource = "conversation" | "manual" | "caretaker";

export interface MemoryObject {
  memory_id: Id;
  face_id: Id;
  content: string;
  source: MemorySource;
  created_at: IsoUtc;
  created_by_user_id: Id | null;
  transcript_id: Id | null;
}

// ---------------------------------------------------------------------------
// Reminders (API_SPEC §5)
// ---------------------------------------------------------------------------

export interface ReminderObject {
  reminder_id: Id;
  patient_id: Id;
  title: string;
  description: string | null;
  trigger_at: IsoUtc;
  created_by_user_id: Id;
  created_at: IsoUtc;
  updated_at: IsoUtc;
}

// ---------------------------------------------------------------------------
// Conversations (API_SPEC §6)
// ---------------------------------------------------------------------------

export type ConversationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface ConversationSubmitRequest {
  patient_id: Id;
  transcript: string;
  recorded_at: IsoUtc;
  duration_seconds: number;
  recognized_face_ids: Id[];
}

export interface ConversationSubmitResponse {
  transcript_id: Id;
  status: ConversationStatus;
}

// ---------------------------------------------------------------------------
// STT (API_SPEC §7.2)
// ---------------------------------------------------------------------------

export interface SttResponse {
  transcript: string;
  confidence: number;
  duration_seconds: number;
}

// ---------------------------------------------------------------------------
// WebSocket — /ws/recognize (API_SPEC §10)
// ---------------------------------------------------------------------------

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Client → server: §10.4 */
export interface RecognizeMessage {
  type: "recognize";
  msg_id: string;
  frame_id: string;
  captured_at: IsoUtc;
  image_b64: string;
  image_mime: "image/jpeg" | "image/png";
  bbox?: BBox;
}

/** Client → server: §10.6 */
export interface PingMessage {
  type: "ping";
  msg_id: string;
}

/** Server → client handshake: §10.3 */
export interface SessionReadyMessage {
  type: "session_ready";
  patient_id: Id;
  server_time: IsoUtc;
  embedding_cache_loaded: boolean;
  face_count: number;
}

/** Server → client on fatal cache load failure: §10.3 */
export interface SessionErrorMessage {
  type: "session_error";
  code: "CACHE_LOAD_FAILED";
  message: string;
}

/** Matched recognition result: §10.5 */
export interface RecognitionResultMatched {
  type: "recognition_result";
  msg_id: string;
  frame_id: string;
  matched: true;
  face_id: Id;
  name: string;
  title: string | null;
  confidence: number;
  margin: number;
  recent_memory_summary: string;
  server_time: IsoUtc;
}

/** Unknown recognition result: §10.5 */
export interface RecognitionResultUnknown {
  type: "recognition_result";
  msg_id: string;
  frame_id: string;
  matched: false;
  embedding: number[]; // length 512
  best_similarity: number;
  server_time: IsoUtc;
}

/** Union discriminated on `matched`. */
export type RecognitionResultMessage =
  | RecognitionResultMatched
  | RecognitionResultUnknown;

/** Server → client pong: §10.6 */
export interface PongMessage {
  type: "pong";
  msg_id: string;
  server_time: IsoUtc;
}

export type WsErrorCode =
  | "RATE_LIMITED"
  | "BAD_FRAME"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_MIME"
  | "RECOGNIZER_FAILED"
  | "CACHE_LOAD_FAILED"
  | "INTERNAL_ERROR";

/** Server → client non-fatal error: §10.7 */
export interface WsErrorMessage {
  type: "error";
  msg_id: string;
  code: WsErrorCode;
  message: string;
}

/** All server → client frames on /ws/recognize. */
export type WsServerMessage =
  | SessionReadyMessage
  | SessionErrorMessage
  | RecognitionResultMessage
  | PongMessage
  | WsErrorMessage;

/** All client → server frames on /ws/recognize. */
export type WsClientMessage = RecognizeMessage | PingMessage;
