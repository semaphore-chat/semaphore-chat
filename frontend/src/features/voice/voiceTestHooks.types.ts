import type { Room } from 'livekit-client';
import type {
  DiagnosticsSnapshot,
  InboundAudioStats,
  InboundVideoStats,
  ScreenShareSenderStats,
  SubscriptionState,
} from './voiceDiagnostics';

/**
 * Shape of the dev/test-only window hooks exposed by `VoiceTestHooks`.
 * Kept in a non-component module so the component file only exports a component
 * (satisfies react-refresh/only-export-components).
 */
export interface VoiceTestHookWindow {
  __lkRoom: Room | null;
  __lkCaptureDiagnostics: () => Promise<DiagnosticsSnapshot>;
  __lkGetInboundAudio: (identity: string) => Promise<InboundAudioStats | undefined>;
  __lkForceResubscribeMic: (identity: string) => void;
  /**
   * deviceId of the local mic's active capture track (from getSettings()).
   * Used to prove PR #346: switching the input device updates the live track
   * without rejoining. Returns null when no mic track is published.
   */
  __lkGetLocalMicDeviceId: () => string | null;
  /**
   * Enable + publish the local mic (same SDK call the app makes at join).
   * Exposed so E2E can (re)publish once the page is in a stable secure context;
   * headless join-time can transiently lack navigator.mediaDevices. Resolves
   * 'ok' or an error string.
   */
  __lkEnableMic: () => Promise<string>;
  __lkTestHooksReady: boolean;
  // --- Local media control (drive the real LocalParticipant) ---
  /** Mute/unmute the local mic (local-mute path). */
  __lkSetMic: (enabled: boolean) => Promise<void>;
  /** Enable/disable the local camera (fake-video source headless). */
  __lkSetCamera: (enabled: boolean) => Promise<void>;
  /**
   * Start/stop local screen share. May reject if headless capture unavailable.
   * `opts.audio` requests tab/system audio with the app's real constraints
   * (a ScreenShareAudio publication) — best-effort: fake-media environments
   * often provide no capturable audio, in which case only video is published.
   * Starting goes through the app's own publish path (publishScreenShare);
   * `resolution`/`fps` default to the app's defaults (1080p, 60 fps).
   */
  __lkSetScreenShare: (
    enabled: boolean,
    opts?: { audio?: boolean; resolution?: string; fps?: number },
  ) => Promise<void>;
  /** The local screen share's negotiated encodings and outbound-rtp layers. */
  __lkGetScreenShareSender: () => Promise<ScreenShareSenderStats>;
  /** Cap the layer a remote's screen share is received at (setVideoQuality). */
  __lkSetScreenShareQuality: (identity: string, quality: 'low' | 'medium' | 'high') => Promise<boolean>;
  /** Switch the active mic capture device live (PR #351 — no rejoin). */
  __lkSwitchMic: (deviceId: string) => Promise<void>;
  // --- On-demand subscription (autoSubscribe:false opt-in sources) ---
  __lkWatchCamera: (identity: string) => void;
  __lkUnwatchCamera: (identity: string) => void;
  __lkWatchScreenShare: (identity: string) => void;
  __lkUnwatchScreenShare: (identity: string) => void;
  // --- Read-side helpers ---
  __lkGetInboundVideo: (
    identity: string,
    source?: 'camera' | 'screenshare',
  ) => Promise<InboundVideoStats | undefined>;
  __lkGetSubscriptionState: (identity: string) => SubscriptionState | undefined;
}

/**
 * Gate for the window test hooks: active only in vite dev (`import.meta.env.DEV`)
 * or when `VITE_LIVEKIT_TEST_HOOK === 'true'` (set in the voice-e2e compose).
 * Both are statically false in a production `vite build`, so callers guarded by
 * this are dead-code-eliminated.
 */
export const isVoiceTestHookEnabled = (): boolean =>
  import.meta.env.DEV || import.meta.env.VITE_LIVEKIT_TEST_HOOK === 'true';
