/**
 * useAppAuth — single hook that normalizes dev-bypass and real Auth0 modes
 * behind a stable surface.
 *
 * Every caller in the Dashboard (pages, rest client, useMe) talks through
 * this one hook. The rest of the app has no knowledge of which auth mode
 * is active.
 */

import { DEV_AUTH_BYPASS, useDevAuth, useRealAuth, type AppAuthUser } from './AuthProvider';
import type { Role } from '../types/api';

export interface AppAuth {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AppAuthUser | null;
  /** Returns a Bearer token suitable for `Authorization` header. */
  getAccessToken: () => Promise<string>;
  /**
   * Kick off login. In real Auth0 mode this redirects away from the app.
   * In dev bypass mode this is synchronous and mints a synthetic token.
   */
  login: (role: Role, displayName?: string) => void;
  logout: () => void;
}

export function useAppAuth(): AppAuth {
  // Rule-of-hooks is preserved because DEV_AUTH_BYPASS is a module-constant,
  // not a render-time branch.
  if (DEV_AUTH_BYPASS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const dev = useDevAuth();
    return {
      isAuthenticated: dev.isAuthenticated,
      isLoading: dev.isLoading,
      user: dev.user,
      getAccessToken: dev.getAccessToken,
      login: dev.login,
      logout: dev.logout,
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const real = useRealAuth();
  return real;
}
