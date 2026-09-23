/**
 * The per-story render root for both screen and component stories.
 *
 * Each story mounts its own `SandboxShell` (rather than sharing one across
 * story navigations) so switching stories in Ladle always gets a genuinely
 * fresh `QueryClient` and a fresh `MemoryRouter` at the right initial path —
 * relying on React unmounting the previous story's whole tree when Ladle
 * swaps in a different story component, instead of on Ladle's more limited
 * per-story `meta` plumbing (see `.ladle/components.tsx` for the truly
 * global concerns — theme + CssBaseline — that DO live in the Ladle
 * `Provider` and apply uniformly no matter which story is active).
 */
import React, { Suspense, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthenticatedShell } from './AuthenticatedShell';
import { StoryRoutes } from './StoryRoutes';
import type { VoiceState } from '../../contexts/VoiceContext';

function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

const SuspenseFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
    <CircularProgress />
  </Box>
);

export interface SandboxShellProps {
  /** Initial `MemoryRouter` path. Defaults to "/" (fine for isolated component stories). */
  path?: string;
  /** Seeds `VoiceProvider`'s reducer — e.g. a "connected to voice" story. */
  voiceState?: Partial<VoiceState>;
  /** Fake `SocketContext.isConnected` — set `false` for a "Reconnecting..." banner story. */
  isSocketConnected?: boolean;
  /** Renders the real authenticated route tree (`StoryRoutes`) when omitted — pass an
   * explicit child for isolated component stories that don't need routing. */
  children?: React.ReactNode;
  /** Extra element rendered alongside the main content (e.g. a `ClickOnMount` that
   * drives a local-state drawer open) — see `interactions.tsx`. */
  overlay?: React.ReactNode;
}

export const SandboxShell: React.FC<SandboxShellProps> = ({ path = '/', voiceState, isSocketConnected, children, overlay }) => {
  const [queryClient] = useState(createStoryQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthenticatedShell voiceState={voiceState} isSocketConnected={isSocketConnected}>
          <Suspense fallback={<SuspenseFallback />}>{children ?? <StoryRoutes />}</Suspense>
          {overlay}
        </AuthenticatedShell>
      </MemoryRouter>
    </QueryClientProvider>
  );
};
