import type { Room, RemoteTrackPublication, RemoteParticipant, LocalParticipant, Track } from 'livekit-client';
import type { VoiceEventEntry } from '../../hooks/useVoiceEventLogDef';
import { TRACK_SOURCE } from './livekitEvents';

/**
 * IMPORTANT: this module is imported (statically, as VALUES — `captureDiagnostics`
 * et al.) by features/voice/VoiceTestHooks.tsx, which is rendered unconditionally
 * from the always-mounted Layout.tsx. `Track` is therefore a type-only import
 * here — see livekitEvents.ts for why.
 */

/**
 * Voice diagnostics — a single source of truth for capturing the current state
 * of a LiveKit voice session.
 *
 * The SAME functions back two consumers:
 *  1. The **Export diagnostics** button in `VoiceDebugPanel` (user self-serve).
 *  2. The dev/test-only `window.__lkCaptureDiagnostics()` hook (automated E2E).
 *
 * Keeping one code path means the JSON a user sends us is byte-for-byte what our
 * Playwright voice tests assert against.
 */

/** Parsed inbound-audio stats for a single subscribed remote track. */
export interface InboundAudioStats {
  /** WebRTC `audioLevel` (0..1) on the inbound-rtp report, if present. */
  audioLevel?: number;
  /** Monotonically increasing energy — the most reliable "is audio flowing" signal. */
  totalAudioEnergy?: number;
  bytesReceived?: number;
  packetsReceived?: number;
  packetsLost?: number;
  /** Jitter in seconds (as reported by WebRTC). */
  jitter?: number;
  /** Round-trip time in seconds from the active candidate pair, if available. */
  rtt?: number;
  /** Whether an inbound-rtp audio report was found at all. */
  hasInboundAudio: boolean;
}

/** Parsed inbound-video stats for a single subscribed remote video track. */
export interface InboundVideoStats {
  /** True only when subscribed AND a live inbound-rtp video report exists. */
  hasInboundVideo: boolean;
  /** Whether the local client has subscribed to the remote video publication. */
  subscribed: boolean;
  bytesReceived?: number;
  packetsReceived?: number;
  framesDecoded?: number;
  frameWidth?: number;
  frameHeight?: number;
}

/** Per-source subscription snapshot for one remote participant. */
export interface SubscriptionState {
  identity: string;
  mic: { published: boolean; subscribed: boolean; muted: boolean };
  camera: { published: boolean; subscribed: boolean };
  screenShare: { published: boolean; subscribed: boolean };
  screenShareAudio: { published: boolean; subscribed: boolean };
}

/**
 * Pulls the inbound audio numbers out of a raw `RTCStatsReport`. Used by both
 * the debug-panel getStats poller and the E2E audio-flow assertions.
 *
 * "Can A hear B" is verified by `bytesReceived`/`packetsReceived` increasing
 * across two samples AND `totalAudioEnergy > 0` — these increment even if the
 * `<audio>` element is paused by autoplay policy, so they survive headless runs.
 */
export function parseInboundAudio(report: RTCStatsReport | undefined): InboundAudioStats {
  const out: InboundAudioStats = { hasInboundAudio: false };
  if (!report) return out;

  report.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio')) {
      out.hasInboundAudio = true;
      out.audioLevel = stat.audioLevel;
      out.totalAudioEnergy = stat.totalAudioEnergy;
      out.bytesReceived = stat.bytesReceived;
      out.packetsReceived = stat.packetsReceived;
      out.packetsLost = stat.packetsLost;
      out.jitter = stat.jitter;
    }
    if (stat.type === 'candidate-pair' && (stat.nominated || stat.selected) && stat.currentRoundTripTime != null) {
      out.rtt = stat.currentRoundTripTime;
    }
  });

  return out;
}

/** Per-remote-participant diagnostic snapshot. */
export interface RemoteParticipantDiagnostic {
  identity: string;
  name?: string;
  connectionQuality: string;
  /** Microphone publication state. */
  mic: {
    published: boolean;
    subscriptionStatus?: string;
    isSubscribed?: boolean;
    hasTrack: boolean;
    isMuted?: boolean;
    trackSid?: string;
    attachedElements: number;
    /** Playback volume on the local RemoteAudioTrack (0 = muted-for-me/deafened). */
    volume?: number;
  };
  /** Inbound WebRTC stats for the subscribed mic track (undefined if not subscribed). */
  inboundAudio?: InboundAudioStats;
}

export interface DiagnosticsSnapshot {
  capturedAt: number;
  appVersion: string;
  room: {
    state: string;
    name?: string;
    numParticipants: number;
  };
  local: {
    identity: string;
    micPublished: boolean;
    micMuted?: boolean;
  };
  remotes: RemoteParticipantDiagnostic[];
  devices: Array<{ kind: string; label: string; deviceId: string }>;
  /** The full event-log ring buffer (if the log provider is mounted). */
  events: VoiceEventEntry[];
}

function findMicPublication(p: RemoteParticipant): RemoteTrackPublication | undefined {
  for (const [, pub] of p.trackPublications) {
    if (pub.source === TRACK_SOURCE.Microphone) return pub as RemoteTrackPublication;
  }
  return undefined;
}

function safeGetVolume(pub: RemoteTrackPublication): number | undefined {
  const track = pub.track as { getVolume?: () => number } | undefined;
  if (!track || typeof track.getVolume !== 'function') return undefined;
  try {
    return track.getVolume();
  } catch {
    return undefined;
  }
}

function localMicPublished(local: LocalParticipant): { published: boolean; muted?: boolean } {
  for (const [, pub] of local.trackPublications) {
    if (pub.kind === 'audio') return { published: true, muted: pub.isMuted };
  }
  return { published: false };
}

async function getInboundStats(pub: RemoteTrackPublication): Promise<InboundAudioStats | undefined> {
  const track = pub.track as { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> } | undefined;
  if (!track || typeof track.getRTCStatsReport !== 'function') return undefined;
  try {
    const report = await track.getRTCStatsReport();
    return parseInboundAudio(report);
  } catch {
    return undefined;
  }
}

async function enumerateDevicesSafe(): Promise<DiagnosticsSnapshot['devices']> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId }));
  } catch {
    return [];
  }
}

function getAppVersion(): string {
  // Vite injects this at build time; falls back gracefully in tests.
  return (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
}

/**
 * Capture a full point-in-time snapshot of the voice session: room/connection
 * state, every remote participant's publication + subscription + inbound
 * getStats, the device list, and the event-log ring buffer.
 *
 * @param room   the live LiveKit Room
 * @param events the current event-log buffer (pass the store snapshot; defaults to [])
 */
export async function captureDiagnostics(
  room: Room | null,
  events: VoiceEventEntry[] = [],
): Promise<DiagnosticsSnapshot> {
  if (!room) {
    return {
      capturedAt: Date.now(),
      appVersion: getAppVersion(),
      room: { state: 'disconnected', numParticipants: 0 },
      local: { identity: '', micPublished: false },
      remotes: [],
      devices: await enumerateDevicesSafe(),
      events,
    };
  }

  const local = room.localParticipant;
  const localMic = localMicPublished(local);

  const remotes: RemoteParticipantDiagnostic[] = await Promise.all(
    Array.from(room.remoteParticipants.values()).map(async (p) => {
      const micPub = findMicPublication(p);
      const diagnostic: RemoteParticipantDiagnostic = {
        identity: p.identity,
        name: p.name,
        connectionQuality: String(p.connectionQuality),
        mic: {
          published: !!micPub,
          subscriptionStatus: micPub?.subscriptionStatus,
          isSubscribed: micPub?.isSubscribed,
          hasTrack: !!micPub?.track,
          isMuted: micPub?.isMuted,
          trackSid: micPub?.trackSid,
          attachedElements: micPub?.track?.attachedElements?.length ?? 0,
          volume: micPub ? safeGetVolume(micPub) : undefined,
        },
      };
      if (micPub?.track) {
        diagnostic.inboundAudio = await getInboundStats(micPub);
      }
      return diagnostic;
    }),
  );

  return {
    capturedAt: Date.now(),
    appVersion: getAppVersion(),
    room: {
      state: String(room.state),
      name: room.name,
      numParticipants: room.numParticipants,
    },
    local: {
      identity: local.identity,
      micPublished: localMic.published,
      micMuted: localMic.muted,
    },
    remotes,
    devices: await enumerateDevicesSafe(),
    events,
  };
}

/**
 * Convenience: get parsed inbound audio stats for one remote participant's mic.
 * Used by the E2E `getInboundAudioStats(page, identity)` helper via the window
 * hook, and by the debug-panel getStats poller.
 */
export async function getRemoteInboundAudio(
  room: Room | null,
  identity: string,
): Promise<InboundAudioStats | undefined> {
  if (!room) return undefined;
  for (const [, p] of room.remoteParticipants) {
    if (p.identity !== identity) continue;
    const micPub = findMicPublication(p);
    if (!micPub) return undefined;
    return getInboundStats(micPub);
  }
  return undefined;
}

function findRemote(room: Room, identity: string): RemoteParticipant | undefined {
  for (const [, p] of room.remoteParticipants) {
    if (p.identity === identity) return p;
  }
  return undefined;
}

/** Pull the first inbound-rtp video entry out of a raw RTCStatsReport. */
export function parseInboundVideo(
  report: RTCStatsReport | undefined,
  subscribed: boolean,
): InboundVideoStats {
  const out: InboundVideoStats = { hasInboundVideo: false, subscribed };
  if (!report) return out;
  report.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
      out.hasInboundVideo = true;
      out.bytesReceived = stat.bytesReceived;
      out.packetsReceived = stat.packetsReceived;
      out.framesDecoded = stat.framesDecoded;
      out.frameWidth = stat.frameWidth;
      out.frameHeight = stat.frameHeight;
    }
  });
  return out;
}

function videoSourceEnum(source: 'camera' | 'screenshare'): `${Track.Source}` {
  return source === 'screenshare' ? TRACK_SOURCE.ScreenShare : TRACK_SOURCE.Camera;
}

/**
 * Inbound VIDEO stats for one remote participant's camera/screenshare — "is the
 * local client receiving video from <identity>". Crucially, when the publication
 * exists but is NOT subscribed (the autoSubscribe:false / opt-in case), this
 * returns `{ hasInboundVideo:false, subscribed:false }` with no bytes — exactly
 * the "no bytes to a non-watcher" guarantee a test asserts.
 */
export async function getRemoteInboundVideo(
  room: Room | null,
  identity: string,
  source: 'camera' | 'screenshare' = 'screenshare',
): Promise<InboundVideoStats | undefined> {
  if (!room) return undefined;
  const remote = findRemote(room, identity);
  if (!remote) return undefined;
  const want = videoSourceEnum(source);
  for (const [, pub] of remote.trackPublications) {
    if (pub.source !== want) continue;
    if (pub.isSubscribed && pub.track) {
      const track = pub.track as {
        getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
      };
      if (typeof track.getRTCStatsReport === 'function') {
        try {
          return parseInboundVideo(await track.getRTCStatsReport(), true);
        } catch {
          return { hasInboundVideo: false, subscribed: true };
        }
      }
    }
    return { hasInboundVideo: false, subscribed: pub.isSubscribed };
  }
  // No such publication at all (sharer not sharing) → nothing to receive.
  return { hasInboundVideo: false, subscribed: false };
}

/** Per-source subscription snapshot for one remote participant. */
export function getSubscriptionState(
  room: Room | null,
  identity: string,
): SubscriptionState | undefined {
  if (!room) return undefined;
  const remote = findRemote(room, identity);
  if (!remote) return undefined;
  const state: SubscriptionState = {
    identity,
    mic: { published: false, subscribed: false, muted: false },
    camera: { published: false, subscribed: false },
    screenShare: { published: false, subscribed: false },
    screenShareAudio: { published: false, subscribed: false },
  };
  for (const [, pub] of remote.trackPublications) {
    if (pub.source === TRACK_SOURCE.Microphone) {
      state.mic = { published: true, subscribed: pub.isSubscribed, muted: pub.isMuted };
    } else if (pub.source === TRACK_SOURCE.Camera) {
      state.camera = { published: true, subscribed: pub.isSubscribed };
    } else if (pub.source === TRACK_SOURCE.ScreenShare) {
      state.screenShare = { published: true, subscribed: pub.isSubscribed };
    } else if (pub.source === TRACK_SOURCE.ScreenShareAudio) {
      state.screenShareAudio = { published: true, subscribed: pub.isSubscribed };
    }
  }
  return state;
}
