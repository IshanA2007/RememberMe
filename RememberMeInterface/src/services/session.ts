// Session singleton for the Vision SPA.
//
// Vision does NOT use the Auth0 SDK. It is launched from the Dashboard with
// `?token=<jwt>&patient_id=<id>` in the URL (FRONTEND_SPEC.md §3.1,
// PIPELINE.md §6.3). This module parses those query parameters once at module
// load and exposes accessors. Tokens live only in-memory; we never touch
// `localStorage` (CLAUDE.md §4, FRONTEND_SPEC.md §3.1).
//
// If either `token` or `patient_id` is missing, `hasSession()` returns false
// and App.tsx should render the ErrorScreen per plan Task V3 Step 8.
import type { Id } from "../types/api";

function readQuery(): { token: string | null; patientId: Id | null } {
  // window.location.search includes the leading `?` if present.
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const patientId = params.get("patient_id");
  return {
    token: token && token.length > 0 ? token : null,
    patientId: patientId && patientId.length > 0 ? patientId : null,
  };
}

const initial = readQuery();

let tokenState: string | null = initial.token;
const patientIdState: Id | null = initial.patientId;

export function getToken(): string | null {
  return tokenState;
}

export function getPatientId(): Id | null {
  return patientIdState;
}

/**
 * Replace the in-memory token. Used only if/when the Dashboard re-delivers a
 * fresh token (e.g. via postMessage after a WS 4401 close). Never persists.
 */
export function setToken(t: string): void {
  tokenState = t;
}

/** True iff we have both a token and a patient_id. */
export function hasSession(): boolean {
  return tokenState !== null && patientIdState !== null;
}
