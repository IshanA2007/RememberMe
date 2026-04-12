/**
 * Error primitives for the Dashboard REST client.
 *
 * Every backend non-2xx response conforms to `ErrorEnvelope`
 * (see docs/API_SPEC.md §0.3). We surface that envelope through a typed
 * `ApiError` so routes and pages can branch on `error.status` (HTTP) and
 * `error.envelope.error.code` (semantic code).
 */

import type { ErrorEnvelope } from '../types/api';

export class ApiError extends Error {
  public readonly status: number;
  public readonly envelope: ErrorEnvelope;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
  }

  /** Convenience accessor for the semantic error code. */
  get code(): ErrorEnvelope['error']['code'] {
    return this.envelope.error.code;
  }
}

/**
 * Guard for throw/catch sites that want a typed envelope without `instanceof`
 * ceremony (useful when crossing module boundaries during HMR).
 */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
