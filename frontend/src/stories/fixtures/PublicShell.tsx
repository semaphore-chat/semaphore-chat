/**
 * Render root for unauthenticated screens (login, onboarding) — no access
 * token, no `AuthenticatedShell` provider stack. Every Playwright screenshot
 * is a fresh page load (see `scripts/ux-shots.mjs`), so `tokenService`'s
 * module-level in-memory token is guaranteed null here regardless of what
 * other stories ran earlier in a manually-browsed Ladle session.
 */
import React, { Suspense, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
}

export const PublicShell: React.FC<{ path?: string; children: React.ReactNode }> = ({ path = '/', children }) => {
  const [queryClient] = useState(createStoryQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Suspense
          fallback={
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              <CircularProgress />
            </Box>
          }
        >
          {children}
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>
  );
};
