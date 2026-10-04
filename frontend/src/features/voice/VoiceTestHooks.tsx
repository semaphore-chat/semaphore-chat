import { useContext, useEffect, type FC } from 'react';
import { RoomContext } from '../../contexts/RoomContextDef';
import { useVoiceEventLog } from '../../hooks/useVoiceEventLogDef';
import { useTrackSubscriptionActions } from '../../hooks/useTrackSubscription';
import {
  captureDiagnostics,
  getRemoteInboundAudio,
  getRemoteInboundVideo,
  getSubscriptionState,
  getLocalScreenShareSender,
  setRemoteScreenShareQuality,
} from './voiceDiagnostics';
import { publishScreenShare } from './screenSharePublish';
import { DEFAULT_SCREEN_SHARE_SETTINGS } from '../../utils/screenShareState';
import { isVoiceTestHookEnabled, type VoiceTestHookWindow } from './voiceTestHooks.types';
import { getScreenShareAudioConfig } from '../../utils/screenShareResolution';
import type { VoiceEventEntry } from '../../hooks/useVoiceEventLogDef';

/**
 * Dev/test-only window hooks for driving the real LiveKit Room from automated
 * tests (Playwright `page.evaluate`). NOT active in production builds.
 *
 * Exposes:
 *  - `window.__lkRoom`                    the live Room (read state, simulateScenario, etc.)
 *  - `window.__lkCaptureDiagnostics()`    full DiagnosticsSnapshot (same as the panel's Export)
 *  - `window.__lkGetInboundAudio(id)`     parsed inbound audio stats for one remote ("can A hear B")
 *  - `window.__lkForceResubscribeMic(id)` PR #352's manual recovery action
 *
 * Gated by `isVoiceTestHookEnabled()` (vite dev or VITE_LIVEKIT_TEST_HOOK), so
 * in a production `vite build` the effect body is dead-code-eliminated and
 * nothing touches `window`.
 */
export const VoiceTestHooks: FC = () => {
  // Read the room context directly (not useRoom()) so this debug-only component
  // degrades to a no-op instead of throwing when mounted outside a RoomProvider
  // (e.g. in isolated component tests that mock the voice providers).
  const room = useContext(RoomContext)?.room ?? null;
  const log = useVoiceEventLog();
  const trackActions = useTrackSubscriptionActions();

  useEffect(() => {
    if (!isVoiceTestHookEnabled()) return;

    const w = window as unknown as VoiceTestHookWindow;
    const events = (): VoiceEventEntry[] => log?.events ?? [];

    w.__lkRoom = room ?? null;
    w.__lkCaptureDiagnostics = () => captureDiagnostics(room, events());
    w.__lkGetInboundAudio = (identity: string) => getRemoteInboundAudio(room, identity);
    w.__lkForceResubscribeMic = (identity: string) =>
      trackActions?.forceResubscribeMic(identity);

    // --- Local media control: drive the real LocalParticipant directly. ---
    w.__lkSetMic = async (enabled: boolean) => {
      await room?.localParticipant.setMicrophoneEnabled(enabled);
    };
    w.__lkSetCamera = async (enabled: boolean) => {
      await room?.localParticipant.setCameraEnabled(enabled);
    };
    w.__lkSetScreenShare = async (enabled, opts) => {
      if (!room) return;
      if (!enabled) {
        await room.localParticipant.setScreenShareEnabled(false);
        return;
      }
      // The app's real publish path (capture constraints + encoding + layers).
      // When asked, request tab/system audio with the SAME constraints the app's
      // toggleScreenShare path uses (getScreenShareAudioConfig). Default (no
      // opts) is video-only capture.
      await publishScreenShare(
        room,
        {
          resolution: opts?.resolution ?? DEFAULT_SCREEN_SHARE_SETTINGS.resolution,
          fps: opts?.fps ?? DEFAULT_SCREEN_SHARE_SETTINGS.fps,
        },
        opts?.audio ? getScreenShareAudioConfig(true) : false,
      );
    };
    w.__lkGetScreenShareSender = () => getLocalScreenShareSender(room);
    w.__lkSetScreenShareQuality = (identity, quality) =>
      setRemoteScreenShareQuality(room, identity, quality);
    // Switch the active mic capture device LIVE (the PR #351 behaviour): same
    // Room API the Settings panel's onDeviceChange ultimately calls
    // (switchAudioInputDevice → room.switchActiveDevice). Lets E2E prove the
    // live-track swap against real LiveKit without driving the lazy Settings UI
    // (whose form wiring is covered by VoiceSettings/AudioVideoSettingsPanel unit
    // tests).
    w.__lkSwitchMic = async (deviceId: string) => {
      await room?.switchActiveDevice('audioinput', deviceId);
    };

    // --- On-demand subscription via the SAME app actions a video tile uses, so
    // the test exercises the real opt-in subscription path, not a shortcut. ---
    w.__lkWatchCamera = (identity: string) => trackActions?.watchCamera(identity);
    w.__lkUnwatchCamera = (identity: string) => trackActions?.stopWatchingCamera(identity);
    w.__lkWatchScreenShare = (identity: string) => trackActions?.watchScreenShare(identity);
    w.__lkUnwatchScreenShare = (identity: string) =>
      trackActions?.stopWatchingScreenShare(identity);

    // --- Read-side helpers. ---
    w.__lkGetInboundVideo = (identity: string, source: 'camera' | 'screenshare' = 'screenshare') =>
      getRemoteInboundVideo(room, identity, source);
    w.__lkGetSubscriptionState = (identity: string) => getSubscriptionState(room, identity);

    w.__lkGetLocalMicDeviceId = () => {
      if (!room) return null;
      for (const [, pub] of room.localParticipant.trackPublications) {
        if (pub.kind === 'audio' && pub.track) {
          return pub.track.mediaStreamTrack?.getSettings().deviceId ?? null;
        }
      }
      return null;
    };
    // A simple readiness flag tests can poll before driving the room.
    w.__lkTestHooksReady = true;

    return () => {
      // Null the room so leaving voice is observable, but keep the functions so
      // late `page.evaluate` calls don't throw.
      w.__lkRoom = null;
    };
  }, [room, log, trackActions]);

  return null;
};
