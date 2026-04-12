/**
 * App root — wires QueryClientProvider → AuthProvider → BrowserRouter →
 * RoutesConfig in one tree.
 *
 * react-query defaults (FRONTEND_SPEC §2.7):
 *   - staleTime 15 s for lists (set per-query)
 *   - refetchOnWindowFocus: true (react-query default) — the dashboard is
 *     allowed to refetch on focus per §2.8
 *   - no polling / no websockets
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { useState, type ReactElement } from 'react';

import { AuthProvider } from './auth/AuthProvider';
import { RoutesConfig } from './routes';

export default function App(): ReactElement {
  // Create the client once per App mount; keep it in state so it survives
  // fast refresh without being torn down on every render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <RoutesConfig />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
