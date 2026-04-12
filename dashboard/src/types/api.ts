/**
 * Typed mirror of docs/API_SPEC.md shapes that the Dashboard consumes.
 *
 * Conventions (API_SPEC §0):
 *  - All IDs serialize as decimal strings.
 *  - All timestamps are ISO 8601 UTC with a trailing `Z`.
 *  - Errors use a single envelope with a typed `code`.
 *
 * Hand-maintained parity with docs/API_SPEC.md. Do NOT regenerate.
 * Any endpoint change must update API_SPEC + this file in the same commit.
 */

// ---------- Primitives ----------------------------------------------------

/** ISO 8601 UTC instant with `Z` suffix, e.g. `"2026-04-11T14:30:00Z"`. */
export type IsoUtcString = string;

/** Int64 serialized as decimal string, e.g. `"42"`. */
export type IdString = string;

export type Role = 'patient' | 'caretaker';

export type MemorySource = 'conversation' | 'manual' | 'caretaker';

export type ConversationStatus = 'queued' | 'processing' | 'completed' | 'failed';

// ---------- Error envelope (API_SPEC §0.3) --------------------------------

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'FACE_NOT_FOUND'
  | 'MEMORY_NOT_FOUND'
  | 'REMINDER_NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'SEMANTIC_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'UPSTREAM_ERROR';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ---------- Auth (API_SPEC §1) --------------------------------------------

export interface MeResponse {
  user_id: IdString;
  auth0_sub: string;
  role: Role;
  display_name: string;
  email: string | null;
  created_at: IsoUtcString;
}

export interface RegisterRequest {
  role: Role;
  display_name: string;
}

export interface CaretakerAssignRequest {
  patient_id: IdString;
  caretaker_id: IdString;
}

export interface CaretakerAssignResponse {
  patient_id: IdString;
  caretaker_id: IdString;
  created_at: IsoUtcString;
}

// ---------- Patient directory (API_SPEC §2) -------------------------------

export interface PatientDirectoryEntry {
  patient_id: IdString;
  display_name: string;
  assigned_at: IsoUtcString;
}

export interface PatientDirectoryResponse {
  patients: PatientDirectoryEntry[];
}

// ---------- Faces (API_SPEC §3) -------------------------------------------

export interface FaceObject {
  face_id: IdString;
  patient_id: IdString;
  name: string;
  title: string | null;
  description: string | null;
  has_embedding: boolean;
  created_at: IsoUtcString;
  updated_at: IsoUtcString;
}

export interface FaceListResponse {
  faces: FaceObject[];
}

export interface FaceCreateRequest {
  name: string;
  title?: string | null;
  description?: string | null;
  /** Length exactly 512 when provided. Omitted for Dashboard mode. */
  embedding?: number[];
}

export interface FacePatchRequest {
  name?: string;
  title?: string | null;
  description?: string | null;
}

export interface FaceEmbeddingRequest {
  embedding: number[]; // exactly 512 floats
}

// ---------- Memories (API_SPEC §4) ----------------------------------------

export interface MemoryObject {
  memory_id: IdString;
  face_id: IdString;
  content: string; // 1–280 chars
  source: MemorySource;
  created_at: IsoUtcString;
  created_by_user_id: IdString | null;
  transcript_id: IdString | null;
}

export interface MemoryListResponse {
  memories: MemoryObject[];
  has_more: boolean;
}

export interface MemoryCreateRequest {
  content: string;
  /** Dashboard only ever sends `manual` (patient) or `caretaker`. */
  source: Extract<MemorySource, 'manual' | 'caretaker'>;
}

export interface MemoryPatchRequest {
  content: string;
}

// ---------- Reminders (API_SPEC §5) ---------------------------------------

export interface ReminderObject {
  reminder_id: IdString;
  patient_id: IdString;
  title: string;
  description: string | null;
  trigger_at: IsoUtcString;
  created_by_user_id: IdString;
  created_at: IsoUtcString;
  updated_at: IsoUtcString;
}

export interface ReminderListResponse {
  reminders: ReminderObject[];
}

export interface ReminderCreateRequest {
  title: string;
  description?: string | null;
  trigger_at: IsoUtcString;
}

export interface ReminderPatchRequest {
  title?: string;
  description?: string | null;
  trigger_at?: IsoUtcString;
}

// ---------- Conversations (API_SPEC §6) -----------------------------------
// Dashboard doesn't submit conversations, but may view status/detail.

export interface ConversationDetailResponse {
  transcript_id: IdString;
  patient_id: IdString;
  status: ConversationStatus;
  processed_at: IsoUtcString | null;
  derived_memory_ids: IdString[];
}

// ---------- Dashboard snapshots (API_SPEC §8) -----------------------------

export interface QuickInfoRecentMemory {
  memory_id: IdString;
  face_id: IdString;
  face_name: string;
  content: string;
  source: MemorySource;
  created_at: IsoUtcString;
}

export interface QuickInfoUpcomingReminder {
  reminder_id: IdString;
  title: string;
  trigger_at: IsoUtcString;
}

export interface QuickInfoResponse {
  patient_id: IdString;
  display_name: string;
  face_count: number;
  recent_memories: QuickInfoRecentMemory[];
  upcoming_reminders: QuickInfoUpcomingReminder[];
}

export interface ActivityNewlyRecognizedFace {
  face_id: IdString;
  name: string;
  first_seen_at: IsoUtcString;
}

export interface ActivityRecentConversationMemory {
  memory_id: IdString;
  face_id: IdString;
  face_name: string;
  content: string;
  created_at: IsoUtcString;
  transcript_id: IdString;
}

export interface ActivityResponse {
  patient_id: IdString;
  newly_recognized_faces: ActivityNewlyRecognizedFace[];
  recent_conversation_memories: ActivityRecentConversationMemory[];
  upcoming_reminders: QuickInfoUpcomingReminder[];
}
