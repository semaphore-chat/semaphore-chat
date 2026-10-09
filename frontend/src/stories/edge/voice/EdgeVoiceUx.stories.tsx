/**
 * VOICE UX pass (P13–P16): the pre-join screen in every permission state,
 * the call stage at 2 / 9+ people with speaking, self-muted and server-muted
 * tiles, the float card docked in the message column (with the member list,
 * and with the docked pins panel in its place), and the voice bar's
 * connection-quality signal. Solo and 4-person stages are
 * `EdgeVoiceChannel`'s SoloConnected / FourMixedStates; 25 people browsing
 * (not joined) is TwentyFiveBrowsing.
 */
import { ClickOnMount } from '../../fixtures/interactions';
import {
  channelVoiceState,
  createMediaRoom,
  defineEdgeScreen,
  edgeCommunity,
  edgeGeneral,
  edgeVoiceChannel,
  edgeVoiceScenario,
  others,
  withChannelPresence,
  type VoicePersona,
} from '../../fixtures/edge/voice';
import { ALL_CAPS, channelPermissionsHandler, timedOutCaps } from '../../fixtures/channelPermissions';

const scenario = edgeVoiceScenario;
const me = scenario.me;
const cid = edgeCommunity.id;
const voicePath = `/community/${cid}/channel/${edgeVoiceChannel.id}`;
const generalPath = `/community/${cid}/channel/${edgeGeneral.id}`;
/** Fixed timeout end, so the shots are deterministic. */
const TIMEOUT_UNTIL = '2099-01-01T15:42:00.000Z';

// ── P13: pre-join (not connected) ───────────────────────────────────────

const [p1, p2, p3, p4, p5, p6] = others(scenario, 6);
/** Who's in the channel (REST presence: deafened / server-muted are the only states it carries). */
const inChannel: VoicePersona[] = [
  { user: p1 },
  { user: p2, deafened: true },
  { user: p3 },
  { user: p4, serverMuted: true },
  { user: p5 },
  { user: p6 },
];
const browsing = withChannelPresence(scenario, edgeVoiceChannel.id, inChannel);

/** Full permissions: "Join voice" + "Join muted", everyone as an avatar grid. */
export const PreJoin = defineEdgeScreen(browsing, { path: voicePath });

/** Nobody in the channel yet. */
export const PreJoinEmpty = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, []), {
  path: voicePath,
});

/** No SPEAK in this channel: a single "Join to listen", no "Join muted". */
export const PreJoinListenOnly = defineEdgeScreen(browsing, {
  path: voicePath,
  extraHandlers: [channelPermissionsHandler(scenario, cid, () => ({ ...ALL_CAPS, speak: false, video: false, share: false }))],
});

/** Timed out: listen-only, and until when. */
export const PreJoinTimedOut = defineEdgeScreen(browsing, {
  path: voicePath,
  extraHandlers: [channelPermissionsHandler(scenario, cid, () => timedOutCaps(TIMEOUT_UNTIL))],
});

/** No CONNECT: no button, just the explanation (the grid still shows who's there). */
export const PreJoinNoPermission = defineEdgeScreen(browsing, {
  path: voicePath,
  extraHandlers: [channelPermissionsHandler(scenario, cid, () => ({ ...ALL_CAPS, connect: false, speak: false, video: false, share: false }))],
});

// ── P14: the stage ─────────────────────────────────────────────────────

/** Two people: me and one speaking — tinted avatar tiles, speaking ring, capped width. */
const pair: VoicePersona[] = [{ user: me }, { user: p1, speaking: true }];
export const StageTwo = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, pair), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(pair[0], pair.slice(1)),
});

/**
 * Twelve people (9+ → 4 columns): two speaking, three self-muted (grey),
 * one deafened, one server-muted (red, from voice presence), one camera.
 */
const twelve: VoicePersona[] = [
  { user: me },
  ...others(scenario, 11).map((user, i) => ({
    user,
    speaking: i === 0 || i === 6,
    // Self-muted: 2, 4, 8; server-muted (9) also has no live mic
    micOn: !(i === 2 || i === 4 || i === 8 || i === 9),
    deafened: i === 4,
    serverMuted: i === 9,
    camera: i === 5,
  })),
];
export const StageTwelveMixedStates = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, twelve), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel, { watchingCameras: new Set([twelve[6].user.id]) }),
  room: createMediaRoom(twelve[0], twelve.slice(1), { cameras: [twelve[6].user.id] }),
});

// ── P15: the float card on a text channel ──────────────────────────────

const floatCrew: VoicePersona[] = [{ user: me }, { user: p1, camera: true, speaking: true }, { user: p2 }];

/** Docked in the message column, above the composer, clear of the member list. */
export const FloatCardDockedWithMemberList = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, floatCrew),
  {
    path: generalPath,
    voiceState: channelVoiceState(edgeVoiceChannel, { showVideoTiles: true, watchingCameras: new Set([p1.id]) }),
    room: createMediaRoom(floatCrew[0], floatCrew.slice(1), { cameras: [p1.id] }),
  },
);

/**
 * The pinned-messages panel docked on the right (≥1200px; it takes the
 * member list's place): the card stays in the message column, off the panel.
 */
export const FloatCardWithDockedPanel = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, floatCrew),
  {
    path: generalPath,
    voiceState: channelVoiceState(edgeVoiceChannel, { showVideoTiles: true, watchingCameras: new Set([p1.id]) }),
    room: createMediaRoom(floatCrew[0], floatCrew.slice(1), { cameras: [p1.id] }),
    overlay: <ClickOnMount find={() => document.querySelector<HTMLElement>('button[aria-label^="Pinned messages"]')} />,
  },
);

// ── P16: the voice bar's connection signal ─────────────────────────────

const barCrew: VoicePersona[] = [{ user: me }, { user: p1 }];

/** Good (2 bars). */
export const VoiceBarGoodConnection = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, barCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(barCrew[0], barCrew.slice(1), {}, 'good'),
});

/** Poor (1 amber bar). */
export const VoiceBarPoorConnection = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, barCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(barCrew[0], barCrew.slice(1), {}, 'poor'),
});

/** Lost (no bars). */
export const VoiceBarLostConnection = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, barCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(barCrew[0], barCrew.slice(1), {}, 'lost'),
});
