import { useEffect, useRef } from 'react';
import type { Room, DisconnectReason } from 'livekit-client';
import {
  useVoiceDispatch,
  VoiceActionType,
  VoiceEndReason,
  VoiceSessionType,
  type VoiceState,
} from '../contexts/VoiceContext';
import { useElectronAPI } from '../contexts/ElectronContext';
import { setUpdateDeferred } from '../utils/swUpdate';
import { logger } from '../utils/logger';
import {
  ROOM_EVENT,
  CONNECTION_STATE,
  DISCONNECT_REASON_CLIENT_INITIATED,
  DISCONNECT_REASON_DUPLICATE_IDENTITY,
  DISCONNECT_REASON_PARTICIPANT_REMOVED,
  DISCONNECT_REASON_ROOM_DELETED,
} from '../features/voice/livekitEvents';
import { setVoiceReconnectCanceller } from '../features/voice/reconnectControl';
import { definitiveRejoinFailure, errorMessageOf } from '../features/voice/voiceEndReason';

interface ResyncJoinOptions {
  startMuted?: boolean;
  quiet?: boolean;
}

interface ResyncActions {
  joinVoiceChannel: (
    channelId: string,
    channelName: string,
    communityId: string,
    isPrivate: boolean,
    createdAt: string,
    options?: ResyncJoinOptions,
  ) => Promise<void>;
  joinDmVoice: (dmGroupId: string, dmGroupName: string, options?: ResyncJoinOptions) => Promise<void>;
  /** End the call without a hang-up and record why (no REST leave). */
  endVoiceSession: (reason: VoiceEndReason, error?: string | null) => Promise<void>;
}

interface UseVoiceForegroundResyncOptions {
  room: Room | null;
  /**
   * The current room, read synchronously (RoomProvider's ref): after a rejoin
   * attempt resolves, React may not have re-rendered with the new room yet.
   * Falls back to the `room` prop.
   */
  getRoom?: () => Room | null;
  state: VoiceState;
  actions: ResyncActions;
}

/**
 * Delay before each automatic rejoin attempt, in ms: 1, 2, 5, 10, then 30 s
 * (about 4 minutes of waiting in all, plus the attempts themselves). Waiting
 * for the network or for the window to become visible doesn't use up
 * attempts.
 */
export const REJOIN_BACKOFF_MS = [1, 2, 5, 10, 30, 30, 30, 30, 30, 30, 30].map((s) => s * 1000);

/**
 * Disconnect reasons that end the call for good: rejoining would fight the
 * server's decision. For DUPLICATE_IDENTITY (the identity is the user id) the
 * newest join wins: rejoining would kick the other device, which would rejoin
 * in turn, forever.
 */
const FINAL_DISCONNECT_REASONS = new Map<number, VoiceEndReason>([
  [DISCONNECT_REASON_DUPLICATE_IDENTITY, VoiceEndReason.DuplicateIdentity],
  [DISCONNECT_REASON_PARTICIPANT_REMOVED, VoiceEndReason.ParticipantRemoved],
  [DISCONNECT_REASON_ROOM_DELETED, VoiceEndReason.RoomDeleted],
]);

class LoopAborted extends Error {}

function isReadyToRejoin(): boolean {
  return navigator.onLine !== false && document.visibilityState === 'visible';
}

/**
 * Reconciles voice state when the connection drops or the app returns to the
 * foreground (#350, #309).
 *
 * While backgrounded/locked on Android, the LiveKit connection can die in
 * ways the app never observes: the server drops a ping-starved connection,
 * or livekit's own `freeze` listener disconnects with CLIENT_INITIATED —
 * indistinguishable from a user hangup at the Room level. Detection is
 * therefore a state mismatch (room dead while voice context says
 * connected), never the disconnect reason.
 *
 * When the room is dead but the context says connected, this rejoins the
 * call quietly (no hang-up, the bar stays up showing "Reconnecting voice
 * (n)…") with backoff (REJOIN_BACKOFF_MS), waiting before each attempt until
 * the browser is online and the window visible. It rejoins from live context
 * state (NOT the localStorage saved-connection; its 5-minute expiry is too
 * short for a locked phone) and keeps the mic muted if it was. After the
 * last attempt fails, the call ends with VoiceEndReason.ReconnectFailed. A
 * definitive refusal (401 after the session refresh, 403, 404) ends it at
 * once with its own reason; network, timeout and 5xx errors keep retrying.
 * Hanging up cancels the loop. Foreground transitions (visibility, pageshow,
 * resume, online, Electron wake from sleep / unlock) skip the current wait.
 *
 * A room-level disconnect with DUPLICATE_IDENTITY, PARTICIPANT_REMOVED or
 * ROOM_DELETED ends the call (with that reason) instead of rejoining.
 *
 * Room connected but audio playback blocked (suspended AudioContext /
 * autoplay block after backgrounding) → room.startAudio(). livekit only does
 * this itself on iOS.
 */
export function useVoiceForegroundResync({ room, getRoom, state, actions }: UseVoiceForegroundResyncOptions): void {
  const { dispatch } = useVoiceDispatch();
  const electronAPI = useElectronAPI();
  const loopRef = useRef<AbortController | null>(null);
  /** Ends the current backoff wait early (a foreground transition). */
  const wakeRef = useRef<(() => void) | null>(null);
  /** A rejoin attempt is running (joining, enabling the mic, registering presence). */
  const attemptInFlightRef = useRef(false);
  /** The room disconnected while an attempt was running: that attempt didn't stick. */
  const roomDiedDuringAttemptRef = useRef(false);

  // Keep latest values in refs so the event listeners never go stale.
  const latestRef = useRef({ room, getRoom, state, actions, dispatch });
  latestRef.current = { room, getRoom, state, actions, dispatch };

  /** Wait `ms`, or less if woken; rejects with LoopAborted on cancel. */
  const waitDelay = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        wakeRef.current = null;
      };
      const onAbort = () => {
        done();
        reject(new LoopAborted());
      };
      const timer = setTimeout(() => {
        done();
        resolve();
      }, ms);
      wakeRef.current = () => {
        done();
        resolve();
      };
      signal.addEventListener('abort', onAbort);
    });

  /** Wait until online and visible; rejects with LoopAborted on cancel. */
  const waitUntilReady = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (isReadyToRejoin()) {
        resolve();
        return;
      }
      const cleanup = () => {
        window.removeEventListener('online', check);
        document.removeEventListener('visibilitychange', check);
        signal.removeEventListener('abort', onAbort);
      };
      const check = () => {
        if (isReadyToRejoin()) {
          cleanup();
          resolve();
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new LoopAborted());
      };
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', check);
      signal.addEventListener('abort', onAbort);
    });

  const rejoinOnce = async (startMuted: boolean) => {
    const { state, actions } = latestRef.current;
    const options = { startMuted, quiet: true };
    if (state.contextType === VoiceSessionType.Dm && state.currentDmGroupId && state.dmGroupName) {
      await actions.joinDmVoice(state.currentDmGroupId, state.dmGroupName, options);
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
        state.createdAt,
        options,
      );
    }
  };

  const hasRejoinContext = (state: VoiceState) =>
    (state.contextType === VoiceSessionType.Dm && !!state.currentDmGroupId && !!state.dmGroupName) ||
    (!!state.currentChannelId &&
      !!state.channelName &&
      !!state.communityId &&
      state.isPrivate !== null &&
      !!state.createdAt);

  const runRejoinLoop = async (trigger: string) => {
    const { room, state, dispatch } = latestRef.current;

    if (!hasRejoinContext(state)) {
      logger.error('[Voice] Cannot rejoin: incomplete voice context state');
      dispatch({ type: VoiceActionType.SetDisconnected });
      // The call is over (involuntarily) — stop suppressing the SW
      // update toast, or a pending update stays hidden all session.
      setUpdateDeferred(false);
      return;
    }

    // Read before the rejoin replaces the room: a user who was muted stays
    // muted (a dead room still reports its last local mic state). No room
    // at all → unknown → the default (mic on).
    const startMuted = room?.localParticipant?.isMicrophoneEnabled === false;
    const deadRoom = room;
    /** After an attempt resolved: did the room it created die already? */
    const attemptRoomIsDead = () => {
      if (roomDiedDuringAttemptRef.current) return true;
      const { getRoom, room } = latestRef.current;
      const current = getRoom ? getRoom() : room;
      return !!current && current !== deadRoom && current.state === CONNECTION_STATE.Disconnected;
    };

    const controller = new AbortController();
    loopRef.current = controller;
    setVoiceReconnectCanceller(() => controller.abort());
    const { signal } = controller;
    const maxAttempts = REJOIN_BACKOFF_MS.length;
    let lastError: unknown = null;

    logger.warn(`[Voice] Room dead while context connected (${trigger}) — rejoining`);
    try {
      for (let i = 0; i < maxAttempts; i++) {
        const attempt = i + 1;
        const delay = REJOIN_BACKOFF_MS[i];
        latestRef.current.dispatch({
          type: VoiceActionType.SetReconnect,
          payload: { attempt, maxAttempts, nextRetryAt: Date.now() + delay },
        });
        await waitDelay(delay, signal);
        if (!isReadyToRejoin()) {
          latestRef.current.dispatch({
            type: VoiceActionType.SetReconnect,
            payload: { attempt, maxAttempts, nextRetryAt: null },
          });
          logger.info('[Voice] Waiting for the network / a visible window before rejoining');
          await waitUntilReady(signal);
        }
        if (!latestRef.current.state.isConnected) return; // hung up meanwhile

        logger.info(`[Voice] Rejoin attempt ${attempt}/${maxAttempts}`);
        try {
          roomDiedDuringAttemptRef.current = false;
          attemptInFlightRef.current = true;
          try {
            await rejoinOnce(startMuted);
          } finally {
            attemptInFlightRef.current = false;
          }
          if (signal.aborted) return;
          if (attemptRoomIsDead()) {
            // The new room dropped while the attempt was finishing (mic,
            // presence): not a success, keep going.
            lastError = new Error('The voice connection dropped again while rejoining');
            logger.warn(`[Voice] Rejoin attempt ${attempt} connected, but the room disconnected again`);
            continue;
          }
          logger.info('[Voice] Rejoin complete');
          latestRef.current.dispatch({ type: VoiceActionType.SetReconnect, payload: null });
          return;
        } catch (error) {
          if (signal.aborted) return;
          const finalReason = definitiveRejoinFailure(error);
          if (finalReason) {
            // Access lost, channel gone or session over: retrying can't help.
            logger.warn(`[Voice] Rejoin attempt ${attempt} refused (${finalReason}) — not retrying`);
            await latestRef.current.actions.endVoiceSession(finalReason, errorMessageOf(error));
            return;
          }
          lastError = error;
          logger.warn(`[Voice] Rejoin attempt ${attempt} failed:`, error);
        }
      }

      logger.error('[Voice] Giving up rejoining after', maxAttempts, 'attempts');
      const message = errorMessageOf(lastError);
      await latestRef.current.actions.endVoiceSession(VoiceEndReason.ReconnectFailed, message);
    } catch (error) {
      if (!(error instanceof LoopAborted)) {
        logger.error('[Voice] Rejoin loop failed:', error);
      }
    } finally {
      if (loopRef.current === controller) {
        loopRef.current = null;
        setVoiceReconnectCanceller(null);
      }
    }
  };

  const runResync = async (trigger: string) => {
    const { room, state } = latestRef.current;

    if (loopRef.current) {
      // A rejoin is already scheduled: try now instead of waiting it out.
      wakeRef.current?.();
      return;
    }
    if (!state.isConnected || state.isConnecting) {
      return;
    }

    const roomDead = !room || room.state === CONNECTION_STATE.Disconnected;
    if (roomDead) {
      await runRejoinLoop(trigger);
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

  // Listeners call the latest runResync through a ref (it reads state via latestRef).
  const runResyncRef = useRef(runResync);
  runResyncRef.current = runResync;

  // Foreground transitions
  useEffect(() => {
    const runResync = (trigger: string) => runResyncRef.current(trigger);
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
    const handleOnline = () => void runResync('online');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('online', handleOnline);
    // Page Lifecycle API: fired when a frozen page is resumed (Chromium)
    document.addEventListener('resume', handleResume);
    // Electron: wake from sleep / screen unlock. After a lid close the window
    // never stopped being "visible", so no visibilitychange fires.
    const unsubscribeSystemResume = electronAPI?.onSystemResume?.(() => void runResync('resume'));

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('resume', handleResume);
      unsubscribeSystemResume?.();
    };
  }, [state.isConnected, electronAPI]);

  // The call ended (hang-up, or a final disconnect): stop any rejoin loop.
  useEffect(() => {
    if (!state.isConnected) {
      loopRef.current?.abort();
    }
  }, [state.isConnected]);

  // Abort the loop on unmount.
  useEffect(() => () => loopRef.current?.abort(), []);

  // Room-level disconnect: end the call for final reasons, else rejoin.
  useEffect(() => {
    if (!room) {
      return;
    }

    const runResync = (trigger: string) => runResyncRef.current(trigger);
    const handleDisconnected = (reason?: DisconnectReason) => {
      if (reason === DISCONNECT_REASON_CLIENT_INITIATED) {
        // User hangup or livekit's freeze-listener; the freeze case is
        // reconciled on the next foreground transition instead.
        return;
      }
      const finalReason = reason !== undefined ? FINAL_DISCONNECT_REASONS.get(reason) : undefined;
      if (finalReason) {
        logger.warn('[Voice] Disconnected for good:', finalReason, '— not rejoining');
        void latestRef.current.actions.endVoiceSession(finalReason);
        return;
      }
      if (attemptInFlightRef.current) {
        // The room a rejoin attempt just created died before the attempt
        // finished: the loop treats that attempt as failed.
        roomDiedDuringAttemptRef.current = true;
        return;
      }
      // The loop itself waits for the network and a visible window.
      void runResync('unexpected-disconnect');
    };

    room.on(ROOM_EVENT.Disconnected, handleDisconnected);
    return () => {
      room.off(ROOM_EVENT.Disconnected, handleDisconnected);
    };
  }, [room]);
}
