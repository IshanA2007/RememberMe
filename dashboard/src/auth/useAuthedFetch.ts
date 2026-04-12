/**
 * useAuthedFetch — returns an async `(path, init?) => Promise<Response>` that
 *
 *   1. Prefixes `path` with `VITE_BACKEND_HTTP`.
 *   2. Injects `Authorization: Bearer <token>` from `useAppAuth().getAccessToken()`.
 *   3. Sets a JSON `Content-Type` header when `init.body` is a string / object.
 *   4. Throws a typed `ApiError` on any non-2xx (envelope per API_SPEC §0.3).
 *   5. Returns the raw `Response` so callers can decide to `.json()` or
 *      stream (e.g. TTS audio isn't consumed in the Dashboard, but the
 *      primitive stays general).
 *
 * rest_client.ts builds on top of this primitive and handles JSON parsing
 * per-endpoint.
 */

import { useCallback, useMemo } from 'react';
import { useAppAuth } from './useAppAuth';
import { ApiError } from '../services/errors';
import type { ErrorEnvelope } from '../types/api';

const BACKEND_HTTP: string = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:5000';

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Build a full URL from a backend-relative path. Absolute URLs pass through. */
function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = BACKEND_HTTP.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function toEnvelope(res: Response): Promise<ErrorEnvelope> {
  try {
    const data = (await res.json()) as unknown;
    if (
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'object'
    ) {
      return data as ErrorEnvelope;
    }
  } catch {
    // fall through to synthesized envelope
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: `HTTP ${res.status} ${res.statusText}`,
    },
  };
}

export function useAuthedFetch(): AuthedFetch {
  const { getAccessToken } = useAppAuth();

  const fetcher = useCallback<AuthedFetch>(
    async (path, init) => {
      const token = await getAccessToken();

      const headers = new Headers(init?.headers ?? {});
      headers.set('Authorization', `Bearer ${token}`);

      // Only attach JSON content-type for string bodies; FormData handles
      // its own boundary header.
      const body = init?.body;
      const isJsonBody = typeof body === 'string' && !headers.has('Content-Type');
      if (isJsonBody) {
        headers.set('Content-Type', 'application/json');
      }
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }

      const res = await fetch(resolveUrl(path), { ...init, headers });

      if (!res.ok) {
        const envelope = await toEnvelope(res);
        throw new ApiError(res.status, envelope);
      }

      return res;
    },
    [getAccessToken],
  );

  // Stable identity so react-query queryFns don't re-create on every render.
  return useMemo(() => fetcher, [fetcher]);
}
