/**
 * AuthProvider — single auth context for the Dashboard.
 *
 * Two modes, chosen at module load:
 *
 *   1. Real Auth0 mode — `@auth0/auth0-react` wraps the tree. Tokens come from
 *      `getAccessTokenSilently`. `login` calls `loginWithRedirect`.
 *
 *   2. Dev bypass mode (`VITE_DEV_AUTH_BYPASS === 'true'`) — a synthetic
 *      context that mints a token shaped `dev-<role>-1-<display>` held in
 *      memory. Matches the backend's `BACKEND_DEV_AUTH_BYPASS` parser
 *      (plan §0.5) so no real tenant is required.
 *
 * Either way, the downstream hook surface is identical (see useAppAuth.ts).
 */

import {
  Auth0Provider,
  useAuth0,
  type AppState,
  type User,
} from '@auth0/auth0-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { Role } from '../types/api';

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

export const DEV_AUTH_BYPASS = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN ?? '';
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID ?? '';
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE ?? '';

// ---------------------------------------------------------------------------
// Shared context shape — both modes implement this exact surface.
// ---------------------------------------------------------------------------

export interface AppAuthUser {
  /** Auth0 `sub` in real mode; synthetic in dev mode. */
  sub?: string;
  /** `display_name` equivalent; used to seed `/api/auth/register`. */
  name?: string;
  email?: string;
}

export interface DevAuthContextValue {
  mode: 'dev';
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AppAuthUser | null;
  login: (role: Role, displayName?: string) => void;
  logout: () => void;
  getAccessToken: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Dev-mode context
// ---------------------------------------------------------------------------

interface DevAuthState {
  token: string | null;
  user: AppAuthUser | null;
}

const DEFAULT_DISPLAY_NAMES: Record<Role, string> = {
  patient: 'Alice',
  caretaker: 'Carol',
};

const DevAuthContext = createContext<DevAuthContextValue | null>(null);

function DevAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<DevAuthState>({ token: null, user: null });
  // Keep a ref in sync so `getAccessToken` stays referentially stable while
  // still reading the freshest token without triggering re-renders.
  const tokenRef = useRef<string | null>(null);

  const login = useCallback((role: Role, displayName?: string) => {
    const name = (displayName ?? DEFAULT_DISPLAY_NAMES[role]).trim();
    // Plan §0.5 token format: dev-<role>-<sub>-<display>
    const token = `dev-${role}-1-${name}`;
    tokenRef.current = token;
    setState({
      token,
      user: {
        sub: `auth0|dev-1`,
        name,
        email: undefined,
      },
    });
  }, []);

  const logout = useCallback(() => {
    tokenRef.current = null;
    setState({ token: null, user: null });
  }, []);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const t = tokenRef.current;
    if (!t) {
      throw new Error('Dev auth: not logged in');
    }
    return t;
  }, []);

  const value = useMemo<DevAuthContextValue>(
    () => ({
      mode: 'dev',
      isAuthenticated: state.token !== null,
      isLoading: false,
      user: state.user,
      login,
      logout,
      getAccessToken,
    }),
    [state.token, state.user, login, logout, getAccessToken],
  );

  return <DevAuthContext.Provider value={value}>{children}</DevAuthContext.Provider>;
}

/** Only valid when DEV_AUTH_BYPASS is on. Throws otherwise. */
export function useDevAuth(): DevAuthContextValue {
  const ctx = useContext(DevAuthContext);
  if (!ctx) {
    throw new Error(
      'useDevAuth called outside DevAuthProvider — are you in real Auth0 mode?',
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Real-mode reconciliation helper
//
// We need `login(role, displayName?)` to behave symmetrically with dev mode,
// i.e. callers don't care which mode is active. For real Auth0, we stash the
// pending role in sessionStorage (so useMe.ts can fall back to it when the
// JWT claim is absent at first-time register) and forward to
// loginWithRedirect.
// ---------------------------------------------------------------------------

export function useRealAuth() {
  const a0 = useAuth0();

  const login = useCallback(
    (role: Role, _displayName?: string) => {
      sessionStorage.setItem('pending_role', role);
      void a0.loginWithRedirect({
        appState: { target: role === 'patient' ? '/patient' : '/caretaker' } as AppState,
        authorizationParams: {
          audience: AUTH0_AUDIENCE || undefined,
        },
      });
    },
    [a0],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem('pending_role');
    void a0.logout({ logoutParams: { returnTo: window.location.origin } });
  }, [a0]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    return a0.getAccessTokenSilently();
  }, [a0]);

  const user: AppAuthUser | null = a0.user
    ? normalizeUser(a0.user)
    : null;

  return {
    isAuthenticated: a0.isAuthenticated,
    isLoading: a0.isLoading,
    user,
    login,
    logout,
    getAccessToken,
  };
}

function normalizeUser(u: User): AppAuthUser {
  return {
    sub: u.sub,
    name: u.name ?? u.nickname ?? u.email ?? undefined,
    email: u.email ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Top-level provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  if (DEV_AUTH_BYPASS) {
    return <DevAuthProvider>{children}</DevAuthProvider>;
  }

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: AUTH0_AUDIENCE || undefined,
      }}
      cacheLocation="memory"
      useRefreshTokens={false}
    >
      {children}
    </Auth0Provider>
  );
}
