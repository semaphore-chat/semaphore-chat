/**
 * VOICE edge cases — publish permissions in a channel call (phase 2 of
 * channel permissions): a timed-out member can connect and listen but the
 * mic, camera and screen-share controls are disabled (tooltip says until
 * when); a member whose channel denies VIDEO and SCREEN_SHARE can only use
 * the mic. Capabilities come from GET .../permissions/me, the only source
 * the UI reads (useChannelPermissions).
 */
import {
  channelVoiceState,
  createMediaRoom,
  defineEdgeScreen,
  edgeCommunity,
  edgeVoiceChannel,
  edgeVoiceScenario,
  others,
  withChannelPresence,
  type VoicePersona,
} from '../../fixtures/edge/voice';
import {
  ALL_CAPS,
  channelPermissionsHandler,
  timedOutCaps,
} from '../../fixtures/channelPermissions';

/** Fixed timeout end, so the shots are deterministic. */
const VOICE_TIMEOUT_UNTIL = '2099-01-01T15:42:00.000Z';

const scenario = edgeVoiceScenario;
const voicePath = `/community/${edgeCommunity.id}/channel/${edgeVoiceChannel.id}`;
const [a, b] = others(scenario, 2);

/** Timed out: listen-only. Mic off (the server unpublished it), every publish control disabled. */
const mutedMe: VoicePersona = { user: scenario.me, micOn: false };
const listeners: VoicePersona[] = [mutedMe, { user: a, speaking: true }, { user: b }];
export const ListenOnlyTimedOut = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, listeners),
  {
    path: voicePath,
    voiceState: channelVoiceState(edgeVoiceChannel),
    room: createMediaRoom(listeners[0], listeners.slice(1)),
    extraHandlers: [
      channelPermissionsHandler(scenario, edgeCommunity.id, () =>
        timedOutCaps(VOICE_TIMEOUT_UNTIL)),
    ],
  },
);

/** The channel denies VIDEO and SCREEN_SHARE: mic works, camera and share are disabled. */
const talkers: VoicePersona[] = [{ user: scenario.me }, { user: a }, { user: b, speaking: true }];
export const MicOnly = defineEdgeScreen(
  withChannelPresence(scenario, edgeVoiceChannel.id, talkers),
  {
    path: voicePath,
    voiceState: channelVoiceState(edgeVoiceChannel),
    room: createMediaRoom(talkers[0], talkers.slice(1)),
    extraHandlers: [
      channelPermissionsHandler(scenario, edgeCommunity.id, () => ({
        ...ALL_CAPS,
        video: false,
        share: false,
      })),
    ],
  },
);
