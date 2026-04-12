/**
 * useMe — resolves the current user.
 *
 * Flow:
 *   1. Call `GET /api/auth/me`.
 *   2. On 404 (first-time login), look up a pending role hint from
 *      `sessionStorage` (set by AuthProvider.login) and call
 *      `POST /api/auth/register` with `display_name` from the auth user.
 *   3. Return the resolved `MeResponse` once either call succeeds.
 *
 * The hook is tolerant of missing auth: when not authenticated, the query
 * is disabled and returns `me=null, isLoading=false`.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuthedFetch } from './useAuthedFetch';
import { useAppAuth } from './useAppAuth';
import { getMe, register } from '../services/rest_client';
import { ApiError } from '../services/errors';
import type { MeResponse, Role } from '../types/api';

const PENDING_ROLE_KEY = 'pending_role';

function readPendingRole(): Role | null {
  const v = sessionStorage.getItem(PENDING_ROLE_KEY);
  if (v === 'patient' || v === 'caretaker') return v;
  return null;
}

export interface UseMeResult {
  me: MeResponse | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useMe(): UseMeResult {
  const auth = useAppAuth();
  const fetcher = useAuthedFetch();

  const query = useQuery<MeResponse, unknown>({
    queryKey: ['me', auth.user?.sub ?? null],
    enabled: auth.isAuthenticated && !auth.isLoading,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<MeResponse> => {
      try {
        return await getMe(fetcher);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // First-time registration path.
          const role = readPendingRole();
          if (!role) {
            // No hint — bubble the 404 so the UI can prompt the user.
            throw e;
          }
          const displayName = (auth.user?.name ?? '').trim() || 'New User';
          const me = await register(fetcher, { role, display_name: displayName });
          // Consume the hint so a future logout/login sequence re-prompts.
          sessionStorage.removeItem(PENDING_ROLE_KEY);
          return me;
        }
        throw e;
      }
    },
  });

  return {
    me: query.data ?? null,
    isLoading: auth.isLoading || (query.isPending && query.fetchStatus !== 'idle'),
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
