import React, { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { instanceControllerGetPublicSettingsOptions } from '../api-client/@tanstack/react-query.gen';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { useVoiceRecovery } from '../hooks/useVoiceRecovery';
import { useVoiceForegroundResync } from '../hooks/useVoiceForegroundResync';
import type { User } from '../types/auth.type';
import { useThemeSync } from '../hooks/useThemeSync';
import { useAppBadge } from '../hooks/useAppBadge';
import { usePushResync } from '../hooks/usePushResync';
import { useDesktopSignInNotice } from '../hooks/useDesktopSignInNotice';
import { LayoutProviders } from '../components/LayoutProviders';
import { VoiceSessionLayer } from '../components/Voice/VoiceSessionLayer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppErrorFallback, AppLoadingFallback } from '../components/AppErrorFallback';
import { ClassicShell } from './ClassicShell';
import { ShellKindContext } from './shellKind';
import { useShellChoice } from './useShellChoice';
import { loadLoungeRoot } from './loungeRootChunk';

/** The new design's shell: its own chunk, never requested while the new design is off. */
const LoungeRoot = lazy(loadLoungeRoot);

/** Has to sit inside LayoutProviders: it needs their socket. */
const DesktopSignInNotice: React.FC = () => {
  useDesktopSignInNotice();
  return null;
};

/**
 * The signed-in app around every page: the app-wide hooks (each runs exactly
 * once), the providers, the call's audio and behaviour, and then the switch
 * between the old shell and the new design's shell.
 *
 * Everything above the switch stays mounted whichever shell shows, so a call
 * never notices a change of shell, of width or of route. The new shell's error
 * boundary and its Suspense sit below the voice layer: a crash or a slow chunk
 * there never unmounts the call.
 */
const AppShell: React.FC = () => {
  const { user: userData } = useCurrentUser();
  const { data: publicSettings } = useQuery(instanceControllerGetPublicSettingsOptions());
  const instanceName = publicSettings?.name || 'Semaphore Chat';
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();

  // Sync theme settings with server (server wins on initial load)
  useThemeSync();

  // Attempt to recover voice connection after page refresh. Called here only:
  // each call holds its own "attempted" flag, so a call inside a layout would
  // try again every time that layout mounted (a breakpoint change).
  useVoiceRecovery();

  // Recover calls that silently died while backgrounded/locked (#350).
  //
  // Mounted here (always mounted) rather than inside VoiceBottomBarContent
  // (lazy, only mounted once `state.isConnected`) so its `room.on(Disconnected, ...)`
  // listener attaches as soon as `voiceState.room` exists — i.e. right after
  // connectToLiveKitRoom()'s `setRoom(room)` call, which happens BEFORE mic setup
  // and BEFORE `isConnected` flips true (see voiceActions.ts). That gap can be a
  // few seconds (mic-enable has a 5s timeout in VAD mode); a disconnect during it
  // would previously go undetected until the *next* foreground transition.
  // `useVoiceForegroundResync` only holds `import type` livekit-client references
  // (see hooks/useVoiceForegroundResync.ts and features/voice/livekitEvents.ts),
  // so mounting it here doesn't reintroduce an eager livekit-client value import.
  useVoiceForegroundResync({
    room: voiceState.room,
    getRoom: voiceActions.getRoom,
    state: voiceState,
    actions: {
      joinVoiceChannel: voiceActions.joinVoiceChannel,
      joinDmVoice: voiceActions.joinDmVoice,
      endVoiceSession: voiceActions.endVoiceSession,
    },
  });

  // Document title (with "(N)" unread prefix) + PWA icon badge
  useAppBadge(instanceName);

  // Re-sync a rotated push subscription to the backend on startup (the SW
  // can't authenticate; this is the reliable path).
  usePushResync();

  // Old shell or new: the route, the width and the "new design" setting (or this tab's preview).
  const choice = useShellChoice();

  return (
    <LayoutProviders>
      <DesktopSignInNotice />
      {/* The call's audio, subscriptions and behaviour, above the shell and
          layout choice: a breakpoint or shell change swaps what is below, never these. */}
      <VoiceSessionLayer>
        <ShellKindContext value={choice.kind}>
          {choice.kind === 'classic' ? (
            <ClassicShell userData={userData as User | undefined} />
          ) : (
            <ErrorBoundary fallback={(error) => <AppErrorFallback error={error} />}>
              <Suspense fallback={<AppLoadingFallback />}>
                <LoungeRoot choice={choice} />
              </Suspense>
            </ErrorBoundary>
          )}
        </ShellKindContext>
      </VoiceSessionLayer>
    </LayoutProviders>
  );
};

export default AppShell;
