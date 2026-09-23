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
 *   is a string-LITERAL subtype. Each string constant below uses
 *   `'literal' satisfies \`${RoomEvent.TrackSubscribed}\`` (a `satisfies`
 *   check against the template-literal type, not an `as` cast) — so
 *   assigning the wrong string here is a compile error, not a silent
 *   runtime drift, while the constant's inferred type stays the narrow
 *   string literal (identical to what `as` would have produced).
 *   **`as` does NOT provide this safety and must not be used here**: an `as`
 *   cast between two literal types is accepted by TypeScript even when the
 *   literal is wrong, because `as` only asserts "trust me," it doesn't
 *   verify assignability. This was proven empirically (2026-07,
 *   `perf/bundle-splitting`, fix round 2): with the original `as` form,
 *   deliberately changing one constant's string to a wrong value still
 *   compiled cleanly under `tsc -b` — a false negative that went undetected
 *   until this round. Switching every constant to `satisfies` was verified
 *   to reject the same wrong literal with `error TS2322`, and to accept the
 *   correct literal with the identical resulting type as the `as` form.
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
  TrackPublished: 'trackPublished' satisfies `${RoomEvent.TrackPublished}`,
  TrackUnpublished: 'trackUnpublished' satisfies `${RoomEvent.TrackUnpublished}`,
  TrackSubscribed: 'trackSubscribed' satisfies `${RoomEvent.TrackSubscribed}`,
  TrackUnsubscribed: 'trackUnsubscribed' satisfies `${RoomEvent.TrackUnsubscribed}`,
  TrackMuted: 'trackMuted' satisfies `${RoomEvent.TrackMuted}`,
  TrackUnmuted: 'trackUnmuted' satisfies `${RoomEvent.TrackUnmuted}`,
  TrackSubscriptionFailed:
    'trackSubscriptionFailed' satisfies `${RoomEvent.TrackSubscriptionFailed}`,
  TrackSubscriptionStatusChanged:
    'trackSubscriptionStatusChanged' satisfies `${RoomEvent.TrackSubscriptionStatusChanged}`,
  ParticipantConnected: 'participantConnected' satisfies `${RoomEvent.ParticipantConnected}`,
  ParticipantDisconnected:
    'participantDisconnected' satisfies `${RoomEvent.ParticipantDisconnected}`,
  LocalTrackPublished: 'localTrackPublished' satisfies `${RoomEvent.LocalTrackPublished}`,
  LocalTrackUnpublished: 'localTrackUnpublished' satisfies `${RoomEvent.LocalTrackUnpublished}`,
  Reconnecting: 'reconnecting' satisfies `${RoomEvent.Reconnecting}`,
  Reconnected: 'reconnected' satisfies `${RoomEvent.Reconnected}`,
  SignalConnected: 'signalConnected' satisfies `${RoomEvent.SignalConnected}`,
  Disconnected: 'disconnected' satisfies `${RoomEvent.Disconnected}`,
  ConnectionStateChanged:
    'connectionStateChanged' satisfies `${RoomEvent.ConnectionStateChanged}`,
  ConnectionQualityChanged:
    'connectionQualityChanged' satisfies `${RoomEvent.ConnectionQualityChanged}`,
} as const;

// ---- Track.Source ----

export const TRACK_SOURCE = {
  Camera: 'camera' satisfies `${Track.Source.Camera}`,
  Microphone: 'microphone' satisfies `${Track.Source.Microphone}`,
  ScreenShare: 'screen_share' satisfies `${Track.Source.ScreenShare}`,
  ScreenShareAudio: 'screen_share_audio' satisfies `${Track.Source.ScreenShareAudio}`,
  Unknown: 'unknown' satisfies `${Track.Source.Unknown}`,
} as const;

// ---- ConnectionQuality ----

export const CONNECTION_QUALITY = {
  Poor: 'poor' satisfies `${ConnectionQuality.Poor}`,
  Lost: 'lost' satisfies `${ConnectionQuality.Lost}`,
} as const;

// ---- ConnectionState ----

export const CONNECTION_STATE = {
  Disconnected: 'disconnected' satisfies `${ConnectionState.Disconnected}`,
  Connected: 'connected' satisfies `${ConnectionState.Connected}`,
} as const;

// ---- DisconnectReason (numeric protobuf enum — see file doc comment) ----

export const DISCONNECT_REASON_CLIENT_INITIATED: DisconnectReason.CLIENT_INITIATED = 1;
