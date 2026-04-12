/**
 * REST client — hand-typed wrappers over every API_SPEC endpoint the
 * Dashboard consumes. No fetch() calls outside this module.
 *
 * Each function takes `(f: AuthedFetch, ...args)` so the calling layer
 * can be a page/hook that obtains `f` once via `useAuthedFetch()`. This
 * keeps these functions pure, easy to reuse inside `useQuery` / `useMutation`,
 * and free of React hook rules.
 *
 * Coverage:
 *   - Auth: getMe, register, assignCaretaker
 *   - Caretaker directory: listPatients
 *   - Snapshots: getQuickInfo, getActivity
 *   - Faces: listFaces, createFace, updateFace, deleteFace, setFaceEmbedding
 *   - Memories: listMemories, createMemory, updateMemory, deleteMemory
 *   - Reminders: listReminders, getUpcomingReminders, createReminder,
 *                updateReminder, deleteReminder
 *   - Conversations: getConversationDetail (caretaker correction context)
 */

import type { AuthedFetch } from '../auth/useAuthedFetch';
import type {
  ActivityResponse,
  CaretakerAssignRequest,
  CaretakerAssignResponse,
  ConversationDetailResponse,
  FaceCreateRequest,
  FaceEmbeddingRequest,
  FaceListResponse,
  FaceObject,
  FacePatchRequest,
  MemoryCreateRequest,
  MemoryListResponse,
  MemoryObject,
  MemoryPatchRequest,
  MeResponse,
  PatientDirectoryResponse,
  PendingFaceAcceptRequest,
  PendingFaceAcceptResponse,
  PendingFaceListResponse,
  QuickInfoResponse,
  RegisterRequest,
  ReminderCreateRequest,
  ReminderListResponse,
  ReminderObject,
  ReminderPatchRequest,
} from '../types/api';

// ---------- Helpers -------------------------------------------------------

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonInit(body: unknown, method: string): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
  };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ---------- Auth (API_SPEC §1) --------------------------------------------

export async function getMe(f: AuthedFetch): Promise<MeResponse> {
  const res = await f('/api/auth/me');
  return parseJson<MeResponse>(res);
}

export async function register(f: AuthedFetch, body: RegisterRequest): Promise<MeResponse> {
  const res = await f('/api/auth/register', jsonInit(body, 'POST'));
  return parseJson<MeResponse>(res);
}

export async function assignCaretaker(
  f: AuthedFetch,
  body: CaretakerAssignRequest,
): Promise<CaretakerAssignResponse> {
  const res = await f('/api/auth/caretaker/assign', jsonInit(body, 'POST'));
  return parseJson<CaretakerAssignResponse>(res);
}

// ---------- Patient directory (API_SPEC §2) -------------------------------

export async function listPatients(f: AuthedFetch): Promise<PatientDirectoryResponse> {
  const res = await f('/api/patients');
  return parseJson<PatientDirectoryResponse>(res);
}

// ---------- Dashboard snapshots (API_SPEC §8) -----------------------------

export async function getQuickInfo(f: AuthedFetch, patientId: string): Promise<QuickInfoResponse> {
  const res = await f(`/api/patients/${encodeURIComponent(patientId)}/quick-info`);
  return parseJson<QuickInfoResponse>(res);
}

export async function getActivity(f: AuthedFetch, patientId: string): Promise<ActivityResponse> {
  const res = await f(`/api/patients/${encodeURIComponent(patientId)}/activity`);
  return parseJson<ActivityResponse>(res);
}

// ---------- Faces (API_SPEC §3) -------------------------------------------

export async function listFaces(f: AuthedFetch, patientId: string): Promise<FaceListResponse> {
  const res = await f(`/api/patients/${encodeURIComponent(patientId)}/faces`);
  return parseJson<FaceListResponse>(res);
}

export async function createFace(
  f: AuthedFetch,
  patientId: string,
  body: FaceCreateRequest,
): Promise<FaceObject> {
  const res = await f(
    `/api/patients/${encodeURIComponent(patientId)}/faces`,
    jsonInit(body, 'POST'),
  );
  return parseJson<FaceObject>(res);
}

export async function updateFace(
  f: AuthedFetch,
  faceId: string,
  body: FacePatchRequest,
): Promise<FaceObject> {
  const res = await f(`/api/faces/${encodeURIComponent(faceId)}`, jsonInit(body, 'PATCH'));
  return parseJson<FaceObject>(res);
}

export async function deleteFace(f: AuthedFetch, faceId: string): Promise<void> {
  await f(`/api/faces/${encodeURIComponent(faceId)}`, { method: 'DELETE' });
}

export async function setFaceEmbedding(
  f: AuthedFetch,
  faceId: string,
  body: FaceEmbeddingRequest,
): Promise<FaceObject> {
  const res = await f(
    `/api/faces/${encodeURIComponent(faceId)}/embedding`,
    jsonInit(body, 'POST'),
  );
  return parseJson<FaceObject>(res);
}

// ---------- Pending Faces (API_SPEC §3b) ----------------------------------

export async function listPendingFaces(
  f: AuthedFetch,
  patientId: string,
): Promise<PendingFaceListResponse> {
  const res = await f(`/api/patients/${encodeURIComponent(patientId)}/pending-faces`);
  return parseJson<PendingFaceListResponse>(res);
}

export async function acceptPendingFace(
  f: AuthedFetch,
  pendingFaceId: string,
  body: PendingFaceAcceptRequest,
): Promise<PendingFaceAcceptResponse> {
  const res = await f(
    `/api/pending-faces/${encodeURIComponent(pendingFaceId)}/accept`,
    jsonInit(body, 'POST'),
  );
  return parseJson<PendingFaceAcceptResponse>(res);
}

export async function dismissPendingFace(
  f: AuthedFetch,
  pendingFaceId: string,
): Promise<void> {
  await f(`/api/pending-faces/${encodeURIComponent(pendingFaceId)}`, { method: 'DELETE' });
}

// ---------- Memories (API_SPEC §4) ----------------------------------------

export interface ListMemoriesOpts {
  limit?: number;
  before?: string; // ISO 8601 UTC
}

export async function listMemories(
  f: AuthedFetch,
  faceId: string,
  opts: ListMemoriesOpts = {},
): Promise<MemoryListResponse> {
  const q = buildQuery({ limit: opts.limit, before: opts.before });
  const res = await f(`/api/faces/${encodeURIComponent(faceId)}/memories${q}`);
  return parseJson<MemoryListResponse>(res);
}

export async function createMemory(
  f: AuthedFetch,
  faceId: string,
  body: MemoryCreateRequest,
): Promise<MemoryObject> {
  const res = await f(
    `/api/faces/${encodeURIComponent(faceId)}/memories`,
    jsonInit(body, 'POST'),
  );
  return parseJson<MemoryObject>(res);
}

export async function updateMemory(
  f: AuthedFetch,
  memoryId: string,
  body: MemoryPatchRequest,
): Promise<MemoryObject> {
  const res = await f(`/api/memories/${encodeURIComponent(memoryId)}`, jsonInit(body, 'PATCH'));
  return parseJson<MemoryObject>(res);
}

export async function deleteMemory(f: AuthedFetch, memoryId: string): Promise<void> {
  await f(`/api/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
}

// ---------- Reminders (API_SPEC §5) ---------------------------------------

export interface ListRemindersOpts {
  from?: string;
  to?: string;
}

export async function listReminders(
  f: AuthedFetch,
  patientId: string,
  opts: ListRemindersOpts = {},
): Promise<ReminderListResponse> {
  const q = buildQuery({ from: opts.from, to: opts.to });
  const res = await f(`/api/patients/${encodeURIComponent(patientId)}/reminders${q}`);
  return parseJson<ReminderListResponse>(res);
}

export async function getUpcomingReminders(
  f: AuthedFetch,
  patientId: string,
  windowSeconds?: number,
): Promise<ReminderListResponse> {
  const q = buildQuery({ window_seconds: windowSeconds });
  const res = await f(
    `/api/patients/${encodeURIComponent(patientId)}/reminders/upcoming${q}`,
  );
  return parseJson<ReminderListResponse>(res);
}

export async function createReminder(
  f: AuthedFetch,
  patientId: string,
  body: ReminderCreateRequest,
): Promise<ReminderObject> {
  const res = await f(
    `/api/patients/${encodeURIComponent(patientId)}/reminders`,
    jsonInit(body, 'POST'),
  );
  return parseJson<ReminderObject>(res);
}

export async function updateReminder(
  f: AuthedFetch,
  reminderId: string,
  body: ReminderPatchRequest,
): Promise<ReminderObject> {
  const res = await f(`/api/reminders/${encodeURIComponent(reminderId)}`, jsonInit(body, 'PATCH'));
  return parseJson<ReminderObject>(res);
}

export async function deleteReminder(f: AuthedFetch, reminderId: string): Promise<void> {
  await f(`/api/reminders/${encodeURIComponent(reminderId)}`, { method: 'DELETE' });
}

// ---------- Conversations (API_SPEC §6.2) ---------------------------------

export async function getConversationDetail(
  f: AuthedFetch,
  transcriptId: string,
): Promise<ConversationDetailResponse> {
  const res = await f(`/api/conversations/${encodeURIComponent(transcriptId)}`);
  return parseJson<ConversationDetailResponse>(res);
}
