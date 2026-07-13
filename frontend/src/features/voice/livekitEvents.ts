import type {
  RoomEvent,
  Track,
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
} from 'livekit-client';

/**
 * Runtime-import-free mirrors of the livekit-client enum members consumed by
 * modules that are ALWAYS mounted: AudioRenderer, TrackSubscriptionProvider
 * (via useTrackSubscription.ts), VoiceEventLogProvider (via
 * useVoiceEventLog.tsx), useVoiceForegroundResync (wired from Layout.tsx),
 * ReplayBufferProvider (via useReplayBuffer.ts — wraps the entire Layout
 * tree), and soundboardPlayer.ts/volumeStorage.ts (statically imported by
 * AudioRenderer/useTrackSubscription for a shared constant/helper, even
 * though their heavier logic is only exercised via voiceActions.ts's dynamic
 * import).
 *
 * Those modules previously did `import { RoomEvent, Track } from 'livekit-client'`
 * (a VALUE import) purely to read enum members as `room.on()` event-name
 * strings / track-source strings. Because they're mounted unconditionally in
 * Layout.tsx, that value import forced the browser to eagerly fetch AND
 * evaluate the ~470KB livekit-client chunk on every authenticated page load —
 * for every user, not just those who open voice — via a
 * `<link rel="modulepreload">` Vite injects for statically-reachable chunks.
 * See the PR-11 bundle-splitting report ("eliminate the remaining eager
 * livekit evaluation").
 *
 * The fix: import the enum TYPES only (`import type`) here, and re-declare
 * each member as a plain string/number constant. This still gets compile-time
 * safety against a future livekit-client value change:
 *
 * - `RoomEvent`, `Track.Source`, and `ConnectionQuality`/`ConnectionState`
 *   are all declared as TypeScript STRING enums (e.g.
 *   `RoomEvent.TrackSubscribed = "trackSubscribed"`), so each member's TYPE
 *   is a string-LITERAL subtype. Template-literal-typing a member
 *   (`` `${RoomEvent.TrackSubscribed}` ``) resolves to the literal type
 *   `"trackSubscribed"` at the type level, even under `import type` — so
 *   assigning the wrong string here is a compile error, not a silent
 *   runtime drift. Verified empirically against the installed livekit-client
 *   typings (2026-07): an intentionally-wrong literal assigned to one of
 *   these fields fails `tsc -b` with a literal-type mismatch.
 *
 * - `DisconnectReason` (from `@livekit/protocol`, re-exported by
 *   livekit-client) is a NUMERIC enum, so the template-literal trick doesn't
 *   apply (it would produce a *stringified* literal type, not the numeric
 *   runtime value the SDK actually emits). Instead, each constant is
 *   annotated with the specific enum MEMBER type (e.g.
 *   `DisconnectReason.CLIENT_INITIATED`), not the enum type as a whole.
 *   TypeScript's "numeric enums accept any number" leniency only applies
 *   when the target type is the enum itself; assigning the wrong literal to
 *   a specific MEMBER type is still a compile error — also verified
 *   empirically (`tsc -b` rejected `2` where `DisconnectReason.CLIENT_INITIATED`
 *   — value `1` — was expected).
 *
 * Only add members here that are actually needed by an always-mounted
 * module. Lazy-loaded/join-path code (voiceActions.ts, VoiceBottomBarContent
 * and everything under it, VideoTiles, VoiceDebugPanel, etc.) should keep
 * importing the real `RoomEvent`/`Track`/etc. values directly — there's no
 * bundle-splitting reason to route it through this indirection.
 */

// ---- RoomEvent ----

export const ROOM_EVENT = {
  TrackPublished: 'trackPublished' as `${RoomEvent.TrackPublished}`,
  TrackUnpublished: 'trackUnpublished' as `${RoomEvent.TrackUnpublished}`,
  TrackSubscribed: 'trackSubscribed' as `${RoomEvent.TrackSubscribed}`,
  TrackUnsubscribed: 'trackUnsubscribed' as `${RoomEvent.TrackUnsubscribed}`,
  TrackMuted: 'trackMuted' as `${RoomEvent.TrackMuted}`,
  TrackUnmuted: 'trackUnmuted' as `${RoomEvent.TrackUnmuted}`,
  TrackSubscriptionFailed: 'trackSubscriptionFailed' as `${RoomEvent.TrackSubscriptionFailed}`,
  TrackSubscriptionStatusChanged:
    'trackSubscriptionStatusChanged' as `${RoomEvent.TrackSubscriptionStatusChanged}`,
  ParticipantConnected: 'participantConnected' as `${RoomEvent.ParticipantConnected}`,
  ParticipantDisconnected: 'participantDisconnected' as `${RoomEvent.ParticipantDisconnected}`,
  LocalTrackPublished: 'localTrackPublished' as `${RoomEvent.LocalTrackPublished}`,
  LocalTrackUnpublished: 'localTrackUnpublished' as `${RoomEvent.LocalTrackUnpublished}`,
  Reconnecting: 'reconnecting' as `${RoomEvent.Reconnecting}`,
  Reconnected: 'reconnected' as `${RoomEvent.Reconnected}`,
  SignalConnected: 'signalConnected' as `${RoomEvent.SignalConnected}`,
  Disconnected: 'disconnected' as `${RoomEvent.Disconnected}`,
  ConnectionStateChanged: 'connectionStateChanged' as `${RoomEvent.ConnectionStateChanged}`,
  ConnectionQualityChanged: 'connectionQualityChanged' as `${RoomEvent.ConnectionQualityChanged}`,
} as const;

// ---- Track.Source ----

export const TRACK_SOURCE = {
  Camera: 'camera' as `${Track.Source.Camera}`,
  Microphone: 'microphone' as `${Track.Source.Microphone}`,
  ScreenShare: 'screen_share' as `${Track.Source.ScreenShare}`,
  ScreenShareAudio: 'screen_share_audio' as `${Track.Source.ScreenShareAudio}`,
  Unknown: 'unknown' as `${Track.Source.Unknown}`,
} as const;

// ---- ConnectionQuality ----

export const CONNECTION_QUALITY = {
  Poor: 'poor' as `${ConnectionQuality.Poor}`,
  Lost: 'lost' as `${ConnectionQuality.Lost}`,
} as const;

// ---- ConnectionState ----

export const CONNECTION_STATE = {
  Disconnected: 'disconnected' as `${ConnectionState.Disconnected}`,
  Connected: 'connected' as `${ConnectionState.Connected}`,
} as const;

// ---- DisconnectReason (numeric protobuf enum — see file doc comment) ----

export const DISCONNECT_REASON_CLIENT_INITIATED: DisconnectReason.CLIENT_INITIATED = 1;
