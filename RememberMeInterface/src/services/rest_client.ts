// Thin fetch wrapper for the Vision SPA.
//
// All REST calls in Vision go through this module (frontend.mdc §8.5). Every
// request auto-attaches the in-memory Bearer token from `session.ts`. Response
// shapes mirror `docs/API_SPEC.md` exactly via `types/api.ts`. Non-2xx
// responses are surfaced as `ApiError` carrying the parsed ErrorEnvelope
// (API_SPEC §0.3).
//
// No retries are performed here. Callers decide whether to retry.

import { getToken } from "./session";
import type {
  ConversationSubmitRequest,
  ConversationSubmitResponse,
  ErrorBody,
  ErrorEnvelope,
  FaceEmbeddingRequest,
  FaceObject,
  Id,
  PendingFaceCreateRequest,
  PendingFaceObject,
  ReminderObject,
  SttResponse,
} from "../types/api";

/**
 * Reminder list payload — mirrored from API_SPEC §5.1 / §5.2. Not in
 * `types/api.ts` today because the plan deferred the container shape to this
 * consumer; keep the inner element in lockstep with `ReminderObject`.
 */
export interface ReminderListResponse {
  reminders: ReminderObject[];
}

const BASE: string = import.meta.env.VITE_BACKEND_HTTP ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(`[${status}] ${body.code}: ${body.message}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function buildAuthHeader(): Record<string, string> {
  const token = getToken();
  if (token === null) return {};
  return { Authorization: `Bearer ${token}` };
}

function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const envelope = v as { error?: unknown };
  if (typeof envelope.error !== "object" || envelope.error === null) return false;
  const body = envelope.error as { code?: unknown; message?: unknown };
  return typeof body.code === "string" && typeof body.message === "string";
}

async function parseErrorBody(res: Response): Promise<ErrorBody> {
  // Servers are supposed to always return an envelope per API_SPEC §0.3, but
  // handle the degenerate cases so a caller never sees a raw parse failure.
  const fallback: ErrorBody = {
    code: "INTERNAL_ERROR",
    message: `Request failed with status ${res.status}`,
  };
  try {
    const data: unknown = await res.json();
    if (isErrorEnvelope(data)) return data.error;
    return fallback;
  } catch {
    return fallback;
  }
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, await parseErrorBody(res));
  return (await res.json()) as T;
}

async function handleBlob(res: Response): Promise<Blob> {
  if (!res.ok) throw new ApiError(res.status, await parseErrorBody(res));
  return await res.blob();
}

interface JsonRequestInit {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: object;
  accept?: "application/json" | "audio/mpeg";
}

async function request(path: string, init: JsonRequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: init.accept ?? "application/json",
    ...buildAuthHeader(),
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return await fetch(`${BASE}${path}`, {
    method: init.method,
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/tts/synthesize (API_SPEC §7.1). Returns the raw MP3 blob.
 * `voice_id` omitted → backend uses its configured default.
 */
export async function tts(text: string, voice_id?: string): Promise<Blob> {
  const body: { text: string; voice_id?: string } = { text };
  if (voice_id !== undefined) body.voice_id = voice_id;
  const res = await request("/api/tts/synthesize", {
    method: "POST",
    body,
    accept: "audio/mpeg",
  });
  return handleBlob(res);
}

/**
 * POST /api/stt/transcribe (API_SPEC §7.2). Multipart form upload with the
 * recorded audio blob plus the patient_id.
 */
export async function stt(audioBlob: Blob, patientId: Id): Promise<SttResponse> {
  const form = new FormData();
  // Filename is informational; backend uses bytes + MIME. Default to webm
  // when the caller didn't set a type on the Blob.
  const mime = audioBlob.type !== "" ? audioBlob.type : "audio/webm";
  const extMatch = /audio\/(webm|ogg|wav|mpeg|mp3)/.exec(mime);
  const ext = extMatch !== null ? (extMatch[1] === "mpeg" ? "mp3" : extMatch[1]) : "webm";
  form.append("audio", audioBlob, `segment.${ext}`);
  form.append("patient_id", patientId);
  const res = await fetch(`${BASE}/api/stt/transcribe`, {
    method: "POST",
    headers: { ...buildAuthHeader() },
    body: form,
  });
  return handleJson<SttResponse>(res);
}

/** POST /api/conversations (API_SPEC §6.1). Async; returns 202 + transcript_id. */
export async function postConversation(
  body: ConversationSubmitRequest,
): Promise<ConversationSubmitResponse> {
  const res = await request("/api/conversations", { method: "POST", body });
  return handleJson<ConversationSubmitResponse>(res);
}

/**
 * GET /api/patients/{patient_id}/reminders/upcoming?window_seconds=600
 * (API_SPEC §5.2). Returns reminders with `trigger_at` in [now, now+600s].
 */
export async function getUpcomingReminders(
  patientId: Id,
): Promise<ReminderListResponse> {
  const res = await request(
    `/api/patients/${encodeURIComponent(patientId)}/reminders/upcoming?window_seconds=600`,
    { method: "GET" },
  );
  return handleJson<ReminderListResponse>(res);
}

/**
 * POST /api/faces/{face_id}/embedding (API_SPEC §3.4). Attaches the 512-float
 * embedding from an unknown recognition to a caretaker-pre-registered face.
 */
export async function postFaceEmbedding(
  faceId: Id,
  embedding: number[],
): Promise<FaceObject> {
  const body: FaceEmbeddingRequest = { embedding };
  const res = await request(
    `/api/faces/${encodeURIComponent(faceId)}/embedding`,
    { method: "POST", body },
  );
  return handleJson<FaceObject>(res);
}

/**
 * POST /api/patients/{patient_id}/pending-faces (API_SPEC §3b.1). Vision
 * submits an unknown face's embedding + thumbnail to the caretaker-facing
 * pending queue. The server may respond with a newly-inserted row, a merged
 * row (dedupe against an existing pending face), or `already_known: true` if
 * the embedding actually matches a registered face.
 */
export async function submitPendingFace(
  patientId: Id,
  body: PendingFaceCreateRequest,
): Promise<PendingFaceObject> {
  const res = await request(
    `/api/patients/${encodeURIComponent(patientId)}/pending-faces`,
    { method: "POST", body },
  );
  return handleJson<PendingFaceObject>(res);
}
