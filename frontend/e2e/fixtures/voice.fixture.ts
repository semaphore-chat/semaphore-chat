/**
 * Voice E2E fixtures — drive REAL multi-participant LiveKit sessions from a
 * single Playwright run, so "can A hear B" is verifiable without a second human.
 *
 * Strategy: each participant gets its OWN browser (Chromium shares launch args
 * across a browser's contexts, so distinct `--use-file-for-fake-audio-capture`
 * wavs require distinct browsers). After joining, we read the participant's real
 * LiveKit identity from the dev-only `window.__lkRoom` hook, so audio-flow
 * assertions never need to map usernames → user-ids.
 *
 * Requires the real-LiveKit stack (scripts/run-voice-e2e.sh) and the window test
 * hooks (VITE_LIVEKIT_TEST_HOOK=true).
 */

import {
  chromium,
  expect,
  request,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import path from 'node:path';
import { TEST_USER, TEST_USER_2, loginViaApi, setAuthToken, API_BASE } from './auth.fixture';

export const ADMIN_USER = {
  username: 'admin',
  password: 'Admin123!@#',
  email: 'admin@test.local',
};

/**
 * Non-privileged member (InstanceRole.USER, no community mute role). Used to
 * assert moderator-mute is DENIED for an ordinary member. REST-only — a USER
 * role can't be driven through the voice-join UI the same way, so this user is
 * never a voice participant; it authenticates via the API for the 403 check.
 */
export const MEMBER_USER = {
  username: 'member',
  password: 'Member123!@#',
  email: 'member@test.local',
};

/** 4th OWNER participant for the all-pairs matrix spec. */
export const TEST_USER_3 = {
  username: 'testuser3',
  password: 'Test123!@#',
  email: 'testuser3@test.local',
};

// cwd is the frontend dir when Playwright runs; avoids __dirname (undefined under ESM).
const ASSET_DIR = path.resolve(process.cwd(), 'e2e/assets');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export interface Participant {
  /** Friendly label (username) for logs. */
  name: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Real LiveKit identity (the user id), filled in by joinVoiceChannel(). */
  identity: string;
  /** Access token from API login — used for admin/moderator REST actions. */
  accessToken: string;
  /** LiveKit room id (= channel id) the participant joined; for REST actions. */
  channelId: string;
}

export interface InboundAudioSample {
  hasInboundAudio: boolean;
  bytesReceived?: number;
  packetsReceived?: number;
  totalAudioEnergy?: number;
  audioLevel?: number;
}

export interface InboundVideoSample {
  hasInboundVideo: boolean;
  subscribed: boolean;
  bytesReceived?: number;
  packetsReceived?: number;
  framesDecoded?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
}

/** Mirrors ScreenShareSenderStats in src/features/voice/voiceDiagnostics.ts. */
export interface ScreenShareSenderStats {
  published: boolean;
  contentHint?: string;
  captureSettings?: { width?: number; height?: number; frameRate?: number };
  degradationPreference?: string;
  encodings: Array<{
    rid?: string;
    active: boolean;
    maxBitrate?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
    scalabilityMode?: string;
  }>;
  outbound: Array<{
    rid?: string;
    frameWidth?: number;
    frameHeight?: number;
    framesPerSecond?: number;
    targetBitrate?: number;
    bytesSent?: number;
  }>;
  sourceFramesPerSecond?: number;
  codec?: string;
}

/** Mirrors ScreenShareRequest in src/features/voice/voiceDiagnostics.ts. */
export interface ScreenShareRequestSample {
  subscribed: boolean;
  pixelDensity?: number | 'screen';
  requestedWidth?: number;
  requestedHeight?: number;
  requestedQuality?: number;
}

export interface SubscriptionStateSample {
  identity: string;
  mic: { published: boolean; subscribed: boolean; muted: boolean };
  camera: { published: boolean; subscribed: boolean };
  screenShare: { published: boolean; subscribed: boolean };
  screenShareAudio: { published: boolean; subscribed: boolean };
}

/**
 * Augment the in-browser `Window` with the dev/test hooks exposed by
 * `VoiceTestHooks` (mirrors voiceTestHooks.types.ts). This makes
 * `page.evaluate(() => window.__lkRoom...)` type-clean in every voice spec that
 * imports from this fixture.
 */
declare global {
  interface Window {
    __lkRoom: {
      state: string;
      name?: string;
      localParticipant: {
        identity: string;
        trackPublications: Map<string, unknown>;
      };
      remoteParticipants: Map<string, unknown>;
      simulateScenario: (s: string) => Promise<void> | void;
    } | null;
    __lkGetInboundAudio: (identity: string) => Promise<InboundAudioSample | undefined>;
    __lkForceResubscribeMic: (identity: string) => void;
    __lkCaptureDiagnostics: () => Promise<unknown>;
    __lkGetLocalMicDeviceId: () => string | null;
    __lkEnableMic: () => Promise<string>;
    __lkSetMic: (enabled: boolean) => Promise<void>;
    __lkSetCamera: (enabled: boolean) => Promise<void>;
    __lkSetScreenShare: (
      enabled: boolean,
      opts?: { audio?: boolean; resolution?: string; fps?: number },
    ) => Promise<void>;
    __lkGetScreenShareSender: () => Promise<ScreenShareSenderStats>;
    __lkGetScreenShareRequest: (identity: string) => ScreenShareRequestSample | undefined;
    __lkSetScreenShareQuality: (
      identity: string,
      quality: 'low' | 'medium' | 'high',
    ) => Promise<boolean>;
    __lkSwitchMic: (deviceId: string) => Promise<void>;
    __lkWatchCamera: (identity: string) => void;
    __lkUnwatchCamera: (identity: string) => void;
    __lkWatchScreenShare: (identity: string) => void;
    __lkUnwatchScreenShare: (identity: string) => void;
    __lkGetInboundVideo: (
      identity: string,
      source?: 'camera' | 'screenshare',
    ) => Promise<InboundVideoSample | undefined>;
    __lkGetSubscriptionState: (identity: string) => SubscriptionStateSample | undefined;
  }
}

/**
 * Launch a dedicated browser for one participant, with a distinct fake-audio
 * file, log it in via API, and land it on the app home (authenticated).
 */
export async function launchParticipant(
  creds: { username: string; password: string },
  wavFile: string,
  /**
   * A user agent of its own, e.g. to sign one user in twice. Written when a
   * login replaced the user's session with the same user agent; since #563
   * only one with the same X-Device-Id is replaced, so this is no longer
   * needed, but harmless.
   */
  opts: { userAgent?: string } = {},
): Promise<Participant> {
  // Fake media so getUserMedia returns a deterministic audio source. getUserMedia
  // needs a secure context — satisfied by running against http://localhost:<port>
  // (browsers treat localhost as potentially-trustworthy without TLS). See
  // frontend/e2e/voice/README.md.
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${path.join(ASSET_DIR, wavFile)}`,
    ],
  });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ['microphone', 'camera'],
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
  });
  const page = await context.newPage();

  // API login → set cookie + localStorage (matches the proven auth.fixture path).
  const { accessToken } = await loginViaApi(context.request, creds);
  await page.goto('/');
  await setAuthToken(page, accessToken);
  await page.reload();

  return {
    name: creds.username,
    browser,
    context,
    page,
    identity: '',
    accessToken,
    channelId: '',
  };
}

/**
 * Navigate the participant into the seeded "Test Community" → a VOICE channel and
 * join voice. Clicking a VOICE channel auto-joins (Channel.tsx). Resolves once
 * `window.__lkRoom` reports `connected`, and records the participant's real
 * LiveKit identity + the room/channel id.
 *
 * `channelName` defaults to `voice-chat`; each heavy spec passes its OWN seeded
 * channel (voice-reconnect / voice-mute / voice-video) so server-side room state
 * never bleeds between specs (see seed-e2e.ts).
 */
export async function joinVoiceChannel(
  p: Participant,
  channelName = 'voice-chat',
): Promise<void> {
  const { page } = p;
  await page.goto('/');

  // Enter the community, then the voice channel (auto-joins voice).
  await page.getByRole('button', { name: 'Test Community' }).first().click();
  await page.getByRole('button', { name: channelName }).first().click();

  // Wait for the real Room to be connected via the dev window hook.
  await expect
    .poll(
      () => page.evaluate(() => window.__lkRoom?.state ?? 'none'),
      { timeout: 30_000, message: `${p.name} never reached connected state` },
    )
    .toBe('connected');

  p.identity = await page.evaluate(() => window.__lkRoom!.localParticipant.identity);

  // Capture the channel id (= LiveKit room name; needed for moderator REST
  // actions). The app uses a hash router and the route can update a beat AFTER
  // the Room reports `connected`, so POLL until `/channel/:id` resolves rather
  // than reading the URL once — a stale read yields an empty id, producing
  // `POST /livekit/channels//mute-participant` → 404. Fall back to the Room name.
  await expect
    .poll(
      async () =>
        page.url().match(/\/channel\/([^/?#]+)/)?.[1] ??
        (await page.evaluate(() => window.__lkRoom?.name ?? '')),
      { timeout: 10_000, message: `${p.name} channelId never resolved after join` },
    )
    .toBeTruthy();
  p.channelId =
    page.url().match(/\/channel\/([^/?#]+)/)?.[1] ??
    (await page.evaluate(() => window.__lkRoom?.name ?? ''));
}

/**
 * Read parsed inbound audio stats for a remote participant on `from`'s page —
 * i.e. "what is `from` receiving from `remote`".
 */
export async function getInboundAudioStats(
  from: Participant,
  remoteIdentity: string,
): Promise<InboundAudioSample | undefined> {
  return from.page.evaluate(
    (id) => window.__lkGetInboundAudio(id),
    remoteIdentity,
  );
}

/**
 * Assert that audio is actively flowing from `remote` to `from`: bytesReceived
 * strictly increases across two samples AND totalAudioEnergy > 0. These metrics
 * advance even if the <audio> element is paused by autoplay policy, so the
 * assertion is robust in headless/containerized runs.
 */
export async function waitForAudioFlow(
  from: Participant,
  remote: Participant,
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 25_000;
  const first = await getInboundAudioStats(from, remote.identity);
  const startBytes = first?.bytesReceived ?? 0;

  await expect
    .poll(
      async () => {
        const s = await getInboundAudioStats(from, remote.identity);
        if (!s || !s.hasInboundAudio) return false;
        const bytesGrew = (s.bytesReceived ?? 0) > startBytes;
        const hasEnergy = (s.totalAudioEnergy ?? 0) > 0;
        return bytesGrew && hasEnergy;
      },
      {
        timeout,
        message: `audio did not flow from ${remote.name} → ${from.name}`,
      },
    )
    .toBe(true);
}

/**
 * Assert audio is NOT flowing from `remote` to `from` — used after a mute. We
 * can't assert totalAudioEnergy decreasing (it's cumulative/monotonic), so we
 * assert inbound bytes don't meaningfully grow across a settle window. A small
 * tolerance absorbs trailing RTCP/keepalive bytes.
 */
export async function expectNoAudioGrowth(
  from: Participant,
  remote: Participant,
  opts: { settleMs?: number; toleranceBytes?: number } = {},
): Promise<void> {
  const settleMs = opts.settleMs ?? 3_000;
  const toleranceBytes = opts.toleranceBytes ?? 2_000;

  // Let the mute propagate and any in-flight packets drain before sampling.
  await from.page.waitForTimeout(1_500);
  const before = (await getInboundAudioStats(from, remote.identity))?.bytesReceived ?? 0;
  await from.page.waitForTimeout(settleMs);
  const after = (await getInboundAudioStats(from, remote.identity))?.bytesReceived ?? 0;

  const grew = after - before;
  expect(
    grew,
    `expected no audio from ${remote.name} → ${from.name} after mute, but ` +
      `bytesReceived grew by ${grew} over ${settleMs}ms (tolerance ${toleranceBytes})`,
  ).toBeLessThanOrEqual(toleranceBytes);
}

/** Mute/unmute a participant's own mic (local-mute path). */
export async function setMicEnabled(p: Participant, enabled: boolean): Promise<void> {
  await p.page.evaluate((e) => window.__lkSetMic(e), enabled);
}

/**
 * Moderator-mute another participant via the backend REST endpoint
 * (POST /api/livekit/channels/:channelId/mute-participant). The acting user must
 * be authorized for MUTE_PARTICIPANT — InstanceRole.OWNER bypasses community RBAC
 * (rbac.guard.ts), so the seeded `admin` user qualifies.
 */
export async function moderatorMute(
  admin: Participant,
  targetIdentity: string,
  mute: boolean,
  channelId: string,
): Promise<void> {
  const res = await admin.context.request.post(
    `${API_BASE}/livekit/channels/${channelId}/mute-participant`,
    {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      data: { participantIdentity: targetIdentity, mute },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `moderatorMute(${targetIdentity}, ${mute}) failed: ${res.status()} ${await res.text()}`,
    );
  }
}

/**
 * Attempt a moderator-mute as an arbitrary user given only credentials, and
 * return the raw HTTP status WITHOUT throwing — for asserting authorization
 * outcomes (e.g. a non-privileged member should get 403). Uses a standalone API
 * request context, so the actor never needs a browser or to join voice.
 */
export async function tryModeratorMuteAs(
  creds: { username: string; password: string },
  targetIdentity: string,
  mute: boolean,
  channelId: string,
): Promise<number> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const { accessToken } = await loginViaApi(ctx, creds);
    const res = await ctx.post(
      `${API_BASE}/livekit/channels/${channelId}/mute-participant`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { participantIdentity: targetIdentity, mute },
      },
    );
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

/** Enable/disable the local camera (fake video source in headless Chromium). */
export async function setCameraEnabled(p: Participant, enabled: boolean): Promise<void> {
  await p.page.evaluate((e) => window.__lkSetCamera(e), enabled);
}

/** List this participant's audio input devices (deviceId + label). */
export async function listAudioInputs(
  p: Participant,
): Promise<Array<{ deviceId: string; label: string }>> {
  return p.page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  });
}

/** The deviceId of the local mic's active capture track (null if unpublished). */
export async function getLocalMicDeviceId(p: Participant): Promise<string | null> {
  return p.page.evaluate(() => window.__lkGetLocalMicDeviceId());
}

/** Switch the active mic capture device live (PR #351 — no rejoin). */
export async function switchMic(p: Participant, deviceId: string): Promise<void> {
  await p.page.evaluate((id) => window.__lkSwitchMic(id), deviceId);
}

/**
 * Start local screen share. Returns true if a ScreenShare publication actually
 * appears (headless desktop capture is not always available); callers may skip
 * with a logged reason when false rather than fail on an env limitation.
 *
 * `opts.audio` additionally requests tab/system audio (a ScreenShareAudio
 * publication) via the app's real capture constraints. Best-effort: headless
 * Chromium's fake display capture usually has no capturable audio, so callers
 * must treat the audio publication as optional (check getSubscriptionState).
 */
export async function startScreenShare(
  p: Participant,
  opts: { audio?: boolean; resolution?: string; fps?: number } = {},
): Promise<boolean> {
  try {
    await p.page.evaluate(
      (o) => window.__lkSetScreenShare(true, o),
      { audio: opts.audio ?? false, resolution: opts.resolution, fps: opts.fps },
    );
  } catch {
    return false;
  }
  return p.page
    .evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const room = window.__lkRoom!;
          const has = () => {
            for (const [, pub] of room.localParticipant.trackPublications) {
              if ((pub as { source?: string }).source === 'screen_share') return true;
            }
            return false;
          };
          if (has()) return resolve(true);
          const t = setInterval(() => {
            if (has()) {
              clearInterval(t);
              resolve(true);
            }
          }, 250);
          setTimeout(() => {
            clearInterval(t);
            resolve(has());
          }, 6_000);
        }),
    )
    .catch(() => false);
}

/** Stop local screen share. */
export async function stopScreenShare(p: Participant): Promise<void> {
  await p.page.evaluate(() => window.__lkSetScreenShare(false));
}

/** Subscribe `viewer` to a remote's screen share (the "open the tile" path). */
export async function watchScreenShareOf(viewer: Participant, remoteIdentity: string): Promise<void> {
  await viewer.page.evaluate((id) => window.__lkWatchScreenShare(id), remoteIdentity);
}

/** The local screen share's negotiated encodings and per-layer outbound-rtp stats. */
export async function getScreenShareSender(p: Participant): Promise<ScreenShareSenderStats> {
  return p.page.evaluate(() => window.__lkGetScreenShareSender());
}

/** What `viewer` requests from the SFU for `remoteIdentity`'s screen share. */
export async function getScreenShareRequest(
  viewer: Participant,
  remoteIdentity: string,
): Promise<ScreenShareRequestSample | undefined> {
  return viewer.page.evaluate((id) => window.__lkGetScreenShareRequest(id), remoteIdentity);
}

/** Cap the simulcast layer `viewer` receives `remoteIdentity`'s screen share at. */
export async function setScreenShareQuality(
  viewer: Participant,
  remoteIdentity: string,
  quality: 'low' | 'medium' | 'high',
): Promise<boolean> {
  return viewer.page.evaluate(
    ({ id, q }) => window.__lkSetScreenShareQuality(id, q),
    { id: remoteIdentity, q: quality },
  );
}

/** Subscribe `viewer` to a remote's camera (the "open the tile" path). */
export async function watchCameraOf(viewer: Participant, remoteIdentity: string): Promise<void> {
  await viewer.page.evaluate((id) => window.__lkWatchCamera(id), remoteIdentity);
}

/** Inbound video stats for a remote's camera/screenshare on `from`'s page. */
export async function getInboundVideoStats(
  from: Participant,
  remoteIdentity: string,
  source: 'camera' | 'screenshare' = 'screenshare',
): Promise<InboundVideoSample | undefined> {
  return from.page.evaluate(
    ({ id, src }) => window.__lkGetInboundVideo(id, src),
    { id: remoteIdentity, src: source },
  );
}

/** Per-source subscription snapshot of `remoteIdentity` on `from`'s page. */
export async function getSubscriptionState(
  from: Participant,
  remoteIdentity: string,
): Promise<SubscriptionStateSample | undefined> {
  return from.page.evaluate((id) => window.__lkGetSubscriptionState(id), remoteIdentity);
}

/**
 * Count ScreenShareAudio publications across ALL remote participants in `p`'s
 * room, split into published vs subscribed. The "non-watcher silence" invariant
 * is `subscribed === 0` for a participant who never opened any share — it must
 * hold room-wide, not just against one sharer, so this inspects the raw
 * `window.__lkRoom` state rather than a single getSubscriptionState() snapshot.
 */
export async function countScreenShareAudio(
  p: Participant,
): Promise<{ published: number; subscribed: number }> {
  return p.page.evaluate(() => {
    const counts = { published: 0, subscribed: 0 };
    const room = window.__lkRoom;
    if (!room) return counts;
    for (const [, participant] of room.remoteParticipants) {
      const pubs = (participant as {
        audioTrackPublications: Map<string, { source?: string; isSubscribed?: boolean }>;
      }).audioTrackPublications;
      for (const [, pub] of pubs) {
        if (pub.source !== 'screen_share_audio') continue;
        counts.published += 1;
        if (pub.isSubscribed) counts.subscribed += 1;
      }
    }
    return counts;
  });
}

/** Assert video IS flowing from `remote` to `from` (subscribed + bytes grow). */
export async function waitForVideoFlow(
  from: Participant,
  remote: Participant,
  source: 'camera' | 'screenshare' = 'screenshare',
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 25_000;
  const first = await getInboundVideoStats(from, remote.identity, source);
  const startBytes = first?.bytesReceived ?? 0;

  await expect
    .poll(
      async () => {
        const s = await getInboundVideoStats(from, remote.identity, source);
        if (!s || !s.hasInboundVideo) return false;
        return (s.bytesReceived ?? 0) > startBytes;
      },
      { timeout, message: `${source} video did not flow from ${remote.name} → ${from.name}` },
    )
    .toBe(true);
}

/**
 * Assert `from` is NOT receiving `remote`'s video — the autoSubscribe:false
 * "no bytes to a non-watcher" guarantee: the publication is unsubscribed AND no
 * inbound video bytes accrue over a settle window.
 */
export async function expectNoVideoToNonWatcher(
  from: Participant,
  remote: Participant,
  source: 'camera' | 'screenshare' = 'screenshare',
  opts: { settleMs?: number; toleranceBytes?: number } = {},
): Promise<void> {
  const settleMs = opts.settleMs ?? 3_000;
  const toleranceBytes = opts.toleranceBytes ?? 1_000;

  const sub = await getSubscriptionState(from, remote.identity);
  const subscribed = source === 'screenshare' ? sub?.screenShare.subscribed : sub?.camera.subscribed;
  expect(
    subscribed,
    `${from.name} should NOT be subscribed to ${remote.name}'s ${source}, but is`,
  ).toBeFalsy();

  const before = (await getInboundVideoStats(from, remote.identity, source))?.bytesReceived ?? 0;
  await from.page.waitForTimeout(settleMs);
  const after = (await getInboundVideoStats(from, remote.identity, source))?.bytesReceived ?? 0;
  const grew = after - before;
  expect(
    grew,
    `${from.name} received ${grew} ${source} bytes from ${remote.name} despite not ` +
      `watching (tolerance ${toleranceBytes}) — autoSubscribe gating leaked video`,
  ).toBeLessThanOrEqual(toleranceBytes);
}

export interface SoundboardTrackState {
  published: boolean;
  subscribed: boolean;
  hasTrack: boolean;
}

export interface SoundboardInboundSample {
  bytesReceived: number;
  totalAudioEnergy: number;
  audioLevel?: number;
}

/**
 * State of `remoteIdentity`'s SOUNDBOARD publication as seen by `from`.
 * Soundboard tracks are published as Source.Unknown and identified purely by
 * `trackName === 'soundboard'` (LiveKit's Source enum is fixed), so this walks
 * the raw `__lkRoom` state like countScreenShareAudio() does.
 */
export async function getSoundboardTrackState(
  from: Participant,
  remoteIdentity: string,
): Promise<SoundboardTrackState> {
  return from.page.evaluate((id) => {
    const out = { published: false, subscribed: false, hasTrack: false };
    const room = window.__lkRoom;
    if (!room) return out;
    for (const [, participant] of room.remoteParticipants) {
      const p = participant as {
        identity: string;
        audioTrackPublications: Map<
          string,
          { trackName?: string; isSubscribed?: boolean; track?: unknown }
        >;
      };
      if (p.identity !== id) continue;
      for (const [, pub] of p.audioTrackPublications) {
        if (pub.trackName !== 'soundboard') continue;
        out.published = true;
        out.subscribed = !!pub.isSubscribed;
        out.hasTrack = !!pub.track;
      }
    }
    return out;
  }, remoteIdentity);
}

/**
 * Inbound RTP stats for `remoteIdentity`'s soundboard track on `from`'s page —
 * "is `from` actually RECEIVING soundboard audio". totalAudioEnergy is the
 * decisive signal: the warmed-up track carries silence (≈0 energy), so energy
 * only accrues while a clip is actually playing.
 */
export async function getSoundboardInbound(
  from: Participant,
  remoteIdentity: string,
): Promise<SoundboardInboundSample | undefined> {
  return from.page.evaluate(async (id) => {
    const room = window.__lkRoom;
    if (!room) return undefined;
    for (const [, participant] of room.remoteParticipants) {
      const p = participant as {
        identity: string;
        audioTrackPublications: Map<
          string,
          {
            trackName?: string;
            track?: { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };
          }
        >;
      };
      if (p.identity !== id) continue;
      for (const [, pub] of p.audioTrackPublications) {
        if (pub.trackName !== 'soundboard') continue;
        if (!pub.track || typeof pub.track.getRTCStatsReport !== 'function') return undefined;
        try {
          const report = await pub.track.getRTCStatsReport();
          if (!report) return undefined;
          let out: { bytesReceived: number; totalAudioEnergy: number; audioLevel?: number } | undefined;
          report.forEach((stat) => {
            const s = stat as {
              type: string;
              kind?: string;
              mediaType?: string;
              bytesReceived?: number;
              totalAudioEnergy?: number;
              audioLevel?: number;
            };
            if (s.type === 'inbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio')) {
              out = {
                bytesReceived: s.bytesReceived ?? 0,
                totalAudioEnergy: s.totalAudioEnergy ?? 0,
                audioLevel: s.audioLevel,
              };
            }
          });
          return out;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }, remoteIdentity);
}

/** Trigger a deterministic LiveKit reconnect on a participant (PR #352 repro). */
export async function forceReconnect(
  p: Participant,
  scenario: 'signal-reconnect' | 'full-reconnect' | 'force-tcp' = 'signal-reconnect',
): Promise<void> {
  await p.page.evaluate(
    (s) => window.__lkRoom?.simulateScenario(s),
    scenario,
  );
}

/** Manually force-resubscribe a remote participant's mic (PR #352 recovery). */
export async function forceResubscribeMic(p: Participant, remoteIdentity: string): Promise<void> {
  await p.page.evaluate(
    (id) => window.__lkForceResubscribeMic(id),
    remoteIdentity,
  );
}

/** Capture the full diagnostics snapshot (same JSON as the panel's Export). */
export async function captureDiagnostics(p: Participant): Promise<unknown> {
  return p.page.evaluate(() => window.__lkCaptureDiagnostics());
}

/**
 * Tear down a participant's browser. First disconnect the LiveKit room and wait
 * for the server to drop the session, so the next spec's room starts clean — an
 * abrupt browser close leaves a ghost participant server-side that can corrupt a
 * shared room (the cross-spec contamination this harness avoids by also using a
 * dedicated channel per heavy spec).
 */
export async function closeParticipant(p: Participant): Promise<void> {
  try {
    await p.page.evaluate(
      () =>
        (window.__lkRoom as unknown as { disconnect?: () => Promise<void> } | null)?.disconnect?.(),
    );
    await p.page
      .waitForFunction(() => (window.__lkRoom?.state ?? 'disconnected') === 'disconnected', null, {
        timeout: 5_000,
      })
      .catch(() => {});
  } catch {
    // Page may already be gone; fall through to hard close.
  }
  await p.context.close();
  await p.browser.close();
}

export { TEST_USER, TEST_USER_2 };
