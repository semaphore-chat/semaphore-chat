/**
 * VOICE edge cases — community voice channel: 1 / 4 / 25 participants,
 * speaking / muted / deafened / server-muted, cameras, screen share, and the
 * Stage / Float / Dock video UI (#443): the embedded stage (every
 * participant gets a tile — avatar tile when they have no camera), its
 * sidebar/pinned layout, and the active-speaker float card (expanded and
 * collapsed to its pill) shown while reading a text channel. See
 * `fixtures/edge/voice.ts` for what the fake LiveKit room does and doesn't
 * reproduce.
 */
import { ServerEvents } from '@semaphore-chat/shared';
import { VideoLayoutMode } from '../../../types/videoLayout';
import {
  channelVoiceState,
  createControllableSocket,
  createMediaRoom,
  defineEdgeScreen,
  edgeCommunity,
  edgeGeneral,
  edgeVoiceChannel,
  edgeVoiceScenario,
  FireServerEvent,
  others,
  withChannelPresence,
  withRenamedUsers,
  type VoicePersona,
} from '../../fixtures/edge/voice';

const scenario = edgeVoiceScenario;
const me = scenario.me;
const voicePath = `/community/${edgeCommunity.id}/channel/${edgeVoiceChannel.id}`;
const generalPath = `/community/${edgeCommunity.id}/channel/${edgeGeneral.id}`;

/** 24 others with a realistic spread of states (deterministic by index). */
function crowd(n: number, users = scenario.users): VoicePersona[] {
  return users.slice(0, n).map((user, i) => ({
    user,
    speaking: i === 1 || i === 7,
    micOn: !(i % 4 === 2 || i === 5),
    deafened: i === 5 || i === 14,
    serverMuted: i === 9,
    camera: i === 3 || i === 11,
    screen: i === 6,
  }));
}

/** 1 participant — just me, alone, mic on. */
const soloMe: VoicePersona = { user: me };
export const SoloConnected = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, [soloMe]), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(soloMe, []),
});

/** 4 participants: me (mic on), one speaking with camera on, one self-muted, one deafened. */
const [a, b, c] = others(scenario, 3);
const four: VoicePersona[] = [
  { user: me },
  { user: a, speaking: true, camera: true },
  { user: b, micOn: false },
  { user: c, micOn: false, deafened: true },
];
export const FourMixedStates = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, four), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(four[0], four.slice(1)),
});

/** 25 participants connected (me + 24): two speaking, several muted/deafened, 2 cameras, 1 screen share. */
const twentyFive: VoicePersona[] = [{ user: me }, ...crowd(24)];
export const TwentyFiveConnected = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, twentyFive), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(twentyFive[0], twentyFive.slice(1)),
});

/**
 * 25 people in the channel, viewer NOT connected — list comes from the REST
 * voice-presence endpoint (deafened / server-muted flags only; mic/camera
 * state isn't in that DTO, so none is shown). Also the sidebar presence.
 */
export const TwentyFiveBrowsing = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, crowd(25)),
  { path: voicePath },
);

/**
 * Self muted + deafened; others: one server-muted (arrives via the
 * `voiceChannelUserUpdated` WS event, the only source of that flag while
 * connected), one deafened, one muted, one speaking.
 */
const selfMuted: VoicePersona = { user: me, micOn: false, deafened: true };
const mutedOthers: VoicePersona[] = [
  { user: a, speaking: true },
  { user: b, micOn: false },
  { user: c, micOn: false, deafened: true },
  { user: scenario.users[3] },
];
const serverMutedSocket = createControllableSocket();
const serverMutedUser = scenario.users[3];
export const SelfMutedDeafenedOthersServerMuted = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, [selfMuted, ...mutedOthers]),
  {
    path: voicePath,
    voiceState: channelVoiceState(edgeVoiceChannel, { isDeafened: true, wasMutedBeforeDeafen: true }),
    room: createMediaRoom(selfMuted, mutedOthers),
    socket: serverMutedSocket,
    overlay: (
      <FireServerEvent
        socket={serverMutedSocket}
        event={ServerEvents.VOICE_CHANNEL_USER_UPDATED}
        delayMs={1200}
        payload={{
          channelId: edgeVoiceChannel.id,
          userId: serverMutedUser.id,
          user: {
            id: serverMutedUser.id,
            username: serverMutedUser.username,
            displayName: serverMutedUser.displayName ?? undefined,
            avatarUrl: serverMutedUser.avatarUrl ?? undefined,
            joinedAt: new Date().toISOString(),
            isDeafened: false,
            isServerMuted: true,
          },
        }}
      />
    ),
  },
);

/**
 * Viewing the voice channel with "show video tiles" on: the embedded stage
 * with my own camera (simulated feed), one watched remote camera
 * (simulated), one unwatched remote camera and one unwatched screen share
 * (the app's real "Click to watch" placeholders). Desktop: stage only (the
 * float card suppresses itself while the stage is mounted). Tablet: the
 * stage in the chat panel PLUS the float card (the tablet panel doesn't
 * report the stage as mounted). Phone: the full-screen tile sheet.
 */
const [v1, v2, v3] = others(scenario, 3);
const videoCrew: VoicePersona[] = [
  { user: me, camera: true },
  { user: v1, camera: true, speaking: true },
  { user: v2, camera: true },
  { user: v3, screen: true },
];
export const VideoOverlayCameras = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, videoCrew), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel, { showVideoTiles: true, watchingCameras: new Set([v1.id]) }),
  room: createMediaRoom(videoCrew[0], videoCrew.slice(1), { cameras: [v1.id] }),
});

/** Screen share active: I'm sharing my screen, and I'm watching someone else's share. Video tiles shown. */
const shareCrew: VoicePersona[] = [
  { user: me, screen: true },
  { user: v1, screen: true, speaking: true },
  { user: v2 },
];
export const ScreenShareActive = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, shareCrew), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel, { showVideoTiles: true, watchingScreenShares: new Set([v1.id]) }),
  room: createMediaRoom(shareCrew[0], shareCrew.slice(1), { screens: [v1.id] }),
});

/**
 * Community STAGE (viewing the joined voice channel, tiles not explicitly
 * "shown"): 6 people — a speaking participant with a watched camera
 * (simulated feed), an unwatched camera ("Click to watch"), and avatar tiles
 * for everyone voice-only, incl. me, a muted and a deafened participant.
 */
const [s1, s2, s3, s4, s5] = others(scenario, 5);
const stageCrew: VoicePersona[] = [
  { user: me },
  { user: s1, camera: true, speaking: true },
  { user: s2, camera: true },
  { user: s3, speaking: true },
  { user: s4, micOn: false },
  { user: s5, micOn: false, deafened: true },
];
export const CommunityStage = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, stageCrew), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel, { watchingCameras: new Set([s1.id]) }),
  room: createMediaRoom(stageCrew[0], stageCrew.slice(1), { cameras: [s1.id] }),
});

/**
 * Stage in the SIDEBAR layout with a watched screen share pinned as the main
 * tile (what clicking a tile's pin does), everyone else in the side strip.
 */
const pinCrew: VoicePersona[] = [
  { user: me },
  { user: s1, screen: true, speaking: true },
  { user: s2, camera: true },
  { user: s3 },
  { user: s4, micOn: false },
];
export const StagePinnedScreenShare = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, pinCrew), {
  path: voicePath,
  voiceState: channelVoiceState(edgeVoiceChannel, {
    watchingScreenShares: new Set([s1.id]),
    watchingCameras: new Set([s2.id]),
    layoutMode: VideoLayoutMode.Sidebar,
    pinnedTileId: `${s1.id}-screen`,
  }),
  room: createMediaRoom(pinCrew[0], pinCrew.slice(1), { screens: [s1.id], cameras: [s2.id] }),
});

/**
 * FLOAT CARD: in the voice channel but reading #general, video tiles shown —
 * desktop/tablet get the single-tile active-speaker card (the speaking
 * participant's watched camera) in its default corner; phone gets the
 * full-screen tile sheet (the float card is desktop/tablet only).
 */
const floatCrew: VoicePersona[] = [
  { user: me },
  { user: s1, camera: true, speaking: true },
  { user: s2 },
  { user: s3, micOn: false },
];
export const FloatCardOverText = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, floatCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel, { showVideoTiles: true, watchingCameras: new Set([s1.id]) }),
  room: createMediaRoom(floatCrew[0], floatCrew.slice(1), { cameras: [s1.id] }),
});

/** Same, with the float card collapsed to its pill (desktop/tablet; phone ignores the collapsed state). */
export const FloatCardCollapsedPill = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, floatCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel, {
    showVideoTiles: true,
    pipCollapsed: true,
    watchingCameras: new Set([s1.id]),
  }),
  room: createMediaRoom(floatCrew[0], floatCrew.slice(1), { cameras: [s1.id] }),
});

/**
 * WORST CASE: 25 in the channel with very long display names, me muted +
 * deafened with my camera AND screen share on, 2 watched feeds + 3
 * placeholders, while reading a busy #general (so: the float card, showing
 * the watched screen share, on desktop/tablet), and a DM call ringing in on
 * top.
 */
const longNames: Record<string, string> = Object.fromEntries(
  scenario.users.slice(0, 8).map((u, i) => [
    u.id,
    i % 2 === 0
      ? `${u.displayName} — Senior Principal Staff Engineer (Platform & Infra), EMEA`
      : `${(u.displayName ?? u.username).replace(/\s/g, '')}TheUnbreakableNameWithNoSpacesAtAll`,
  ]),
);
const longScenario = withRenamedUsers(scenario, longNames);
const worstCrowd: VoicePersona[] = [
  { user: longScenario.me, micOn: false, deafened: true, camera: true, screen: true },
  ...crowd(24, longScenario.users).map((p, i) => ({ ...p, camera: i < 3 || p.camera, screen: i === 4 || p.screen })),
];
const worstSocket = createControllableSocket();
const ringingDm = longScenario.dmGroups[1];
const caller = longScenario.users.find((u) => ringingDm.members.some((m) => m.userId === u.id))!;
export const WorstCase = defineEdgeScreen(withChannelPresence(longScenario, edgeVoiceChannel.id, worstCrowd), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel, {
    isDeafened: true,
    wasMutedBeforeDeafen: true,
    showVideoTiles: true,
    watchingCameras: new Set([worstCrowd[1].user.id]),
    watchingScreenShares: new Set([worstCrowd[5].user.id]),
  }),
  room: createMediaRoom(worstCrowd[0], worstCrowd.slice(1), {
    cameras: [worstCrowd[1].user.id],
    screens: [worstCrowd[5].user.id],
  }),
  socket: worstSocket,
  overlay: (
    <FireServerEvent
      socket={worstSocket}
      event={ServerEvents.DM_VOICE_CALL_STARTED}
      payload={{
        dmGroupId: ringingDm.id,
        startedBy: caller.id,
        starter: { id: caller.id, username: caller.username, displayName: caller.displayName, avatarUrl: caller.avatarUrl },
      }}
    />
  ),
});
