import { useEffect, useRef } from 'react';
import type { Room, DisconnectReason } from 'livekit-client';
import { useVoiceDispatch, VoiceActionType, VoiceSessionType, type VoiceState } from '../contexts/VoiceContext';
import { setUpdateDeferred } from '../utils/swUpdate';
import { logger } from '../utils/logger';
import { ROOM_EVENT, CONNECTION_STATE, DISCONNECT_REASON_CLIENT_INITIATED } from '../features/voice/livekitEvents';

interface ResyncActions {
  joinVoiceChannel: (
    channelId: string,
    channelName: string,
    communityId: string,
    isPrivate: boolean,
    createdAt: string
  ) => Promise<void>;
  joinDmVoice: (dmGroupId: string, dmGroupName: string) => Promise<void>;
}

interface UseVoiceForegroundResyncOptions {
  room: Room | null;
  state: VoiceState;
  actions: ResyncActions;
}

/**
 * Reconciles voice state when the app returns to the foreground (#350).
 *
 * While backgrounded/locked on Android, the LiveKit connection can die in
 * ways the app never observes: the server drops a ping-starved connection,
 * or livekit's own `freeze` listener disconnects with CLIENT_INITIATED —
 * indistinguishable from a user hangup at the Room level. Detection is
 * therefore a state mismatch (room dead while voice context says
 * connected), never the disconnect reason.
 *
 * On becoming visible:
 *  - room dead but context says connected → rejoin once from live context
 *    state (NOT the localStorage saved-connection; its 5-minute expiry is
 *    too short for a locked phone). On failure, dispatch SetDisconnected
 *    so the UI stops claiming the call is alive.
 *  - room connected but audio playback blocked (suspended AudioContext /
 *    autoplay block after backgrounding) → room.startAudio(). livekit only
 *    does this itself on iOS.
 *
 * Also rejoins when an unexpected disconnect happens while visible, so
 * server-side drops recover without waiting for a visibility change.
 */
export function useVoiceForegroundResync({ room, state, actions }: UseVoiceForegroundResyncOptions): void {
  const { dispatch } = useVoiceDispatch();
  const resyncInProgressRef = useRef(false);

  // Keep latest values in refs so the event listeners never go stale.
  const latestRef = useRef({ room, state, actions, dispatch });
  latestRef.current = { room, state, actions, dispatch };

  const runResync = async (trigger: string) => {
    const { room, state, actions, dispatch } = latestRef.current;

    if (resyncInProgressRef.current || !state.isConnected || state.isConnecting) {
      return;
    }

    const roomDead = !room || room.state === CONNECTION_STATE.Disconnected;
    if (roomDead) {
      resyncInProgressRef.current = true;
      logger.warn(`[Voice] Room dead while context connected (${trigger}) — rejoining`);
      try {
        if (state.contextType === VoiceSessionType.Dm && state.currentDmGroupId && state.dmGroupName) {
          await actions.joinDmVoice(state.currentDmGroupId, state.dmGroupName);
        } else if (
          state.currentChannelId &&
          state.channelName &&
          state.communityId &&
          state.isPrivate !== null &&
          state.createdAt
        ) {
          await actions.joinVoiceChannel(
            state.currentChannelId,
            state.channelName,
            state.communityId,
            state.isPrivate,
            state.createdAt
          );
        } else {
          logger.error('[Voice] Cannot rejoin: incomplete voice context state');
          dispatch({ type: VoiceActionType.SetDisconnected });
          // The call is over (involuntarily) — stop suppressing the SW
          // update toast, or a pending update stays hidden all session.
          setUpdateDeferred(false);
        }
        logger.info('[Voice] Foreground resync rejoin complete');
      } catch (error) {
        logger.error('[Voice] Foreground resync rejoin failed:', error);
        // joinVoiceChannel/joinDmVoice already dispatched SetConnectionError;
        // make the UI honest about the dead call.
        dispatch({ type: VoiceActionType.SetDisconnected });
        // The call is over (involuntarily) — stop suppressing the SW
        // update toast, or a pending update stays hidden all session.
        setUpdateDeferred(false);
      } finally {
        resyncInProgressRef.current = false;
      }
      return;
    }

    if (room.state === CONNECTION_STATE.Connected && !room.canPlaybackAudio) {
      logger.info(`[Voice] Audio playback blocked after ${trigger} — calling startAudio()`);
      try {
        await room.startAudio();
      } catch (error) {
        logger.warn('[Voice] startAudio() failed (will retry on next foreground):', error);
      }
    }
  };

  // Foreground transitions
  useEffect(() => {
    if (!state.isConnected) {
      return;
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runResync('visibilitychange');
      }
    };
    const handlePageShow = () => void runResync('pageshow');
    const handleResume = () => void runResync('resume');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    // Page Lifecycle API: fired when a frozen page is resumed (Chromium)
    document.addEventListener('resume', handleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('resume', handleResume);
    };
  }, [state.isConnected]);

  // Unexpected disconnect while visible → recover immediately
  useEffect(() => {
    if (!room) {
      return;
    }

    const handleDisconnected = (reason?: DisconnectReason) => {
      if (reason === DISCONNECT_REASON_CLIENT_INITIATED) {
        // User hangup or livekit's freeze-listener; the freeze case is
        // reconciled on the next foreground transition instead.
        return;
      }
      if (document.visibilityState === 'visible') {
        void runResync('unexpected-disconnect');
      }
    };

    room.on(ROOM_EVENT.Disconnected, handleDisconnected);
    return () => {
      room.off(ROOM_EVENT.Disconnected, handleDisconnected);
    };
  }, [room]);
}
