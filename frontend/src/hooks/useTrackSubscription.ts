import { useEffect, useCallback, createContext, useContext } from 'react';
import {
  RoomEvent,
  Track,
  RemoteTrackPublication,
  RemoteParticipant,
  type SubscriptionError,
} from 'livekit-client';
import { useRoom } from './useRoom';
import { useVoiceDispatch, VoiceActionType } from '../contexts/VoiceContext';
import { logger } from '../utils/logger';
import { SOUNDBOARD_TRACK_NAME } from '../features/voice/soundboardPlayer';

/**
 * Soundboard tracks are published as Track.Source.Unknown (the enum is fixed and
 * can't be extended), so they're identified by their publication NAME. They must
 * be auto-subscribed like the mic, otherwise remote clients never hear them.
 */
function isSoundboardPublication(publication: {
  trackName?: string;
}): boolean {
  return publication.trackName === SOUNDBOARD_TRACK_NAME;
}

/**
 * Duck-types a TrackPublication as a RemoteTrackPublication. Avoids relying on
 * `instanceof RemoteTrackPublication`, which can false-fail when the same
 * livekit-client module is loaded twice (HMR, dual bundles, jest mocks).
 */
function isRemotePublication(publication: unknown): publication is RemoteTrackPublication {
  return (
    !!publication &&
    typeof (publication as RemoteTrackPublication).setSubscribed === 'function'
  );
}

/**
 * Unsubscribes a remote track publication from the SFU (saves bandwidth).
 * Only sends the signal if the track is actually subscribed to avoid redundant
 * WebSocket messages. With autoSubscribe: false, tracks start unsubscribed so
 * calling setSubscribed(false) on them would send a no-op signal to the SFU
 * that still consumes signaling bandwidth.
 */
function unsubscribePublication(publication: RemoteTrackPublication, reason: string) {
  if (!publication.isSubscribed) return;
  logger.info('[TrackSubscription] Unsubscribing', reason, publication.trackSid, publication.source);
  publication.setSubscribed(false);
}

/**
 * Checks if a track source is a video source that should be opt-in.
 */
function isOptInSource(source: Track.Source | string): boolean {
  return (
    source === Track.Source.Camera ||
    source === Track.Source.ScreenShare ||
    source === Track.Source.ScreenShareAudio
  );
}

/**
 * Subscribes a mic publication. Always issues the SDK call (no isSubscribed
 * guard) so subscription state can self-heal after reconnects, where the
 * client's view of `isSubscribed` may diverge from the SFU's session state.
 *
 * The SDK is internally idempotent, so redundant calls are cheap.
 */
function subscribePublication(publication: RemoteTrackPublication, reason: string) {
  logger.info(
    '[TrackSubscription] Subscribing',
    reason,
    publication.trackSid,
    publication.source,
    'wasSubscribed:',
    publication.isSubscribed,
  );
  publication.setSubscribed(true);
}

/**
 * Force a fresh subscription request even when the SDK believes the track is
 * already subscribed. After a full reconnect, the SFU has a brand-new session
 * and forgets prior subscriptions, but the client's local `isSubscribed` flag
 * may still read true. Toggling false→true emits a fresh subscribe message.
 */
function forceResubscribePublication(publication: RemoteTrackPublication, reason: string) {
  logger.info(
    '[TrackSubscription] Force-resubscribing',
    reason,
    publication.trackSid,
    publication.source,
    'currentlySubscribed:',
    publication.isSubscribed,
  );
  // Toggle to ensure the SDK emits a fresh subscriptionUpdateNeeded event.
  if (publication.isSubscribed) {
    publication.setSubscribed(false);
  }
  publication.setSubscribed(true);
}

/**
 * Applies subscription policy to a participant: subscribe mic, unsubscribe opt-in sources.
 * Called on mount for existing participants and when new participants connect.
 *
 * When `force` is true (used after a full reconnect), mic subscriptions are
 * re-issued even if the publication already reports `isSubscribed: true`.
 */
function applySubscriptionPolicy(participant: RemoteParticipant, force = false) {
  for (const [, publication] of participant.trackPublications) {
    if (!isRemotePublication(publication)) continue;
    if (
      publication.source === Track.Source.Microphone ||
      isSoundboardPublication(publication)
    ) {
      if (force) {
        forceResubscribePublication(publication, `reconnect-resubscribe:${participant.identity}`);
      } else {
        subscribePublication(publication, `auto-subscribe:${participant.identity}`);
      }
    } else if (isOptInSource(publication.source)) {
      unsubscribePublication(publication, `initial-unsubscribe:${participant.identity}`);
    }
  }
}

export interface TrackSubscriptionActions {
  watchCamera: (identity: string) => void;
  stopWatchingCamera: (identity: string) => void;
  watchScreenShare: (identity: string) => void;
  stopWatchingScreenShare: (identity: string) => void;
  /**
   * Force-resubscribe to a participant's mic. Used as a manual recovery from
   * the debug panel when audio asymmetry is suspected. Toggles the SDK's
   * subscribed flag false→true so a fresh SUBSCRIBE message is sent to the SFU.
   */
  forceResubscribeMic: (identity: string) => void;
}

export const TrackSubscriptionContext = createContext<TrackSubscriptionActions | null>(null);

export function useTrackSubscriptionActions(): TrackSubscriptionActions | null {
  return useContext(TrackSubscriptionContext);
}

/**
 * Hook that manages per-participant track subscriptions via LiveKit's setSubscribed API.
 *
 * Room is created with autoSubscribe: false, so this hook is responsible for all
 * subscription decisions:
 * - Mic tracks: always subscribed immediately on publish
 * - Camera/ScreenShare/ScreenShareAudio: unsubscribed on publish, selectively
 *   re-subscribed when the user opts in via watch/stop actions.
 *
 * Returns actions to be provided via TrackSubscriptionContext.
 */
export function useTrackSubscription(): TrackSubscriptionActions {
  const { room } = useRoom();
  const { dispatch } = useVoiceDispatch();

  // --- Event handlers: unsubscribe on publish, cleanup on unpublish ---

  useEffect(() => {
    if (!room) return;

    const handleTrackPublished = (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (!isRemotePublication(publication)) return;
      logger.info('[TrackSubscription] TrackPublished', participant.identity, publication.source, publication.trackSid, publication.trackName);
      if (
        publication.source === Track.Source.Microphone ||
        isSoundboardPublication(publication)
      ) {
        subscribePublication(publication, `published-audio:${participant.identity}`);
      } else if (isOptInSource(publication.source)) {
        unsubscribePublication(publication, `published:${participant.identity}`);
        // Surface new screen shares: open the video panel so the viewer sees
        // the "Click to watch" tile (watching remains opt-in per subscription policy)
        if (publication.source === Track.Source.ScreenShare) {
          logger.info('[TrackSubscription] Screen share published, opening video panel', participant.identity);
          // Reveal fully (show + un-collapse) so a viewer with the pill
          // collapsed doesn't miss a screen share that just started.
          dispatch({ type: VoiceActionType.SetShowVideoTiles, payload: true });
          dispatch({ type: VoiceActionType.SetPipCollapsed, payload: false });
        }
      }
    };

    const handleTrackUnpublished = (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      logger.info('[TrackSubscription] TrackUnpublished', participant.identity, publication.source, publication.trackSid);
      // Clean up watching state when a participant stops sharing
      if (publication.source === Track.Source.Camera) {
        dispatch({ type: VoiceActionType.StopWatchingCamera, payload: participant.identity });
      } else if (publication.source === Track.Source.ScreenShare) {
        dispatch({ type: VoiceActionType.StopWatchingScreenShare, payload: participant.identity });
      }
    };

    const handleParticipantConnected = (participant: RemoteParticipant) => {
      logger.info('[TrackSubscription] ParticipantConnected', participant.identity, 'tracks:', participant.trackPublications.size);
      // Participant may already have published tracks by the time we get this event
      applySubscriptionPolicy(participant);
    };

    // Re-apply subscription policy on full reconnect. The SFU has a fresh
    // session after a reconnect and does not remember prior subscriptions; we
    // must re-issue them. This is the most common cause of asymmetric audio
    // (a single client's brief network blip silently drops mic subscriptions).
    const handleReconnected = () => {
      logger.info(
        '[TrackSubscription] Reconnected — re-applying subscription policy to',
        room.remoteParticipants.size,
        'participants',
      );
      for (const [, participant] of room.remoteParticipants) {
        applySubscriptionPolicy(participant, /* force */ true);
      }
    };

    // Self-heal: if a mic subscription drops without us asking (e.g. SFU sends
    // a subscription update during a partial reconnect), re-subscribe.
    const handleSubscriptionStatusChanged = (
      publication: RemoteTrackPublication,
      status: string,
      participant: RemoteParticipant,
    ) => {
      if (publication.source !== Track.Source.Microphone) return;
      logger.info(
        '[TrackSubscription] SubscriptionStatusChanged',
        participant.identity,
        publication.trackSid,
        status,
      );
      if (status === 'unsubscribed') {
        forceResubscribePublication(publication, `status-changed:${participant.identity}`);
      }
    };

    // Surface subscription failures so we can see them in logs / debug panel.
    // The participant argument is essential for diagnosing asymmetric audio:
    // it tells us *which* remote peer's mic we failed to subscribe to.
    const handleSubscriptionFailed = (
      trackSid: string,
      participant: RemoteParticipant,
      reason?: SubscriptionError,
    ) => {
      logger.error(
        '[TrackSubscription] Subscription failed',
        'participant:',
        participant.identity,
        'trackSid:',
        trackSid,
        'reason:',
        reason,
      );
    };

    // Apply subscription policy to existing participants on mount
    logger.info('[TrackSubscription] Applying initial subscription policy to', room.remoteParticipants.size, 'participants');
    for (const [, participant] of room.remoteParticipants) {
      applySubscriptionPolicy(participant);
    }

    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.TrackSubscriptionStatusChanged, handleSubscriptionStatusChanged);
    room.on(RoomEvent.TrackSubscriptionFailed, handleSubscriptionFailed);

    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.TrackSubscriptionStatusChanged, handleSubscriptionStatusChanged);
      room.off(RoomEvent.TrackSubscriptionFailed, handleSubscriptionFailed);
    };
  }, [room, dispatch]);

  // --- Watch/stop actions ---

  const findParticipant = useCallback(
    (identity: string): RemoteParticipant | undefined => {
      if (!room) return undefined;
      for (const [, p] of room.remoteParticipants) {
        if (p.identity === identity) return p;
      }
      return undefined;
    },
    [room],
  );

  const setSubscribedForSource = useCallback(
    (identity: string, sources: Track.Source[], subscribed: boolean) => {
      const participant = findParticipant(identity);
      if (!participant) {
        logger.warn('[TrackSubscription] Participant not found:', identity);
        return;
      }
      for (const [, publication] of participant.trackPublications) {
        if (
          sources.includes(publication.source as Track.Source) &&
          isRemotePublication(publication)
        ) {
          logger.info(
            '[TrackSubscription]',
            subscribed ? 'Subscribing' : 'Unsubscribing',
            identity,
            publication.source,
            publication.trackSid,
          );
          publication.setSubscribed(subscribed);
        }
      }
    },
    [findParticipant],
  );

  const watchCamera = useCallback(
    (identity: string) => {
      setSubscribedForSource(identity, [Track.Source.Camera], true);
      dispatch({ type: VoiceActionType.WatchCamera, payload: identity });
    },
    [setSubscribedForSource, dispatch],
  );

  const stopWatchingCamera = useCallback(
    (identity: string) => {
      setSubscribedForSource(identity, [Track.Source.Camera], false);
      dispatch({ type: VoiceActionType.StopWatchingCamera, payload: identity });
    },
    [setSubscribedForSource, dispatch],
  );

  const watchScreenShare = useCallback(
    (identity: string) => {
      setSubscribedForSource(
        identity,
        [Track.Source.ScreenShare, Track.Source.ScreenShareAudio],
        true,
      );
      dispatch({ type: VoiceActionType.WatchScreenShare, payload: identity });
    },
    [setSubscribedForSource, dispatch],
  );

  const stopWatchingScreenShare = useCallback(
    (identity: string) => {
      setSubscribedForSource(
        identity,
        [Track.Source.ScreenShare, Track.Source.ScreenShareAudio],
        false,
      );
      dispatch({ type: VoiceActionType.StopWatchingScreenShare, payload: identity });
    },
    [setSubscribedForSource, dispatch],
  );

  const forceResubscribeMic = useCallback(
    (identity: string) => {
      const participant = findParticipant(identity);
      if (!participant) {
        logger.warn('[TrackSubscription] forceResubscribeMic: participant not found:', identity);
        return;
      }
      for (const [, publication] of participant.trackPublications) {
        if (
          publication.source === Track.Source.Microphone &&
          isRemotePublication(publication)
        ) {
          forceResubscribePublication(publication, `manual-resubscribe:${identity}`);
        }
      }
    },
    [findParticipant],
  );

  return {
    watchCamera,
    stopWatchingCamera,
    watchScreenShare,
    stopWatchingScreenShare,
    forceResubscribeMic,
  };
}
