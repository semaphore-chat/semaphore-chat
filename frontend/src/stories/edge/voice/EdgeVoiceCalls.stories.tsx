/**
 * VOICE edge cases — DM calls, the incoming-call banner, and the voice bar
 * coexisting with the chat composer.
 *
 * The incoming-call banner is driven through the app's real path: a
 * `dmVoiceCallStarted` server event (shape from backend
 * `voice-presence.service.ts`) delivered on a controllable fake socket →
 * `useSocketHub` → event bus → `IncomingCallListener` → `IncomingCallBanner`.
 */
import { ServerEvents } from '@semaphore-chat/shared';
import { TypeIntoTextareaOnMount } from '../../fixtures/interactions';
import {
  channelVoiceState,
  createControllableSocket,
  createMediaRoom,
  defineEdgeScreen,
  dmPresenceHandler,
  dmVoiceState,
  edgeCommunity,
  edgeDmGroup,
  edgeDmPartner,
  edgeGeneral,
  edgeVoiceChannel,
  edgeVoiceScenario,
  FireServerEvent,
  others,
  withChannelPresence,
  type VoicePersona,
} from '../../fixtures/edge/voice';

const scenario = edgeVoiceScenario;
const me = scenario.me;
const partnerName = edgeDmPartner.displayName ?? edgeDmPartner.username;
const dmPath = `/direct-messages/${edgeDmGroup.id}`;
const generalPath = `/community/${edgeCommunity.id}/channel/${edgeGeneral.id}`;

const callStarted = (dmGroupId: string, caller = edgeDmPartner) => ({
  dmGroupId,
  startedBy: caller.id,
  starter: { id: caller.id, username: caller.username, displayName: caller.displayName, avatarUrl: caller.avatarUrl },
});

/** 1:1 DM voice call in progress, viewing that DM: "In Call" chip + "DM Voice Call" bar; partner speaking. */
const dmPair: VoicePersona[] = [{ user: me }, { user: edgeDmPartner, speaking: true }];
export const DmCallConnected = defineEdgeScreen(scenario, {
  path: dmPath,
  voiceState: dmVoiceState(edgeDmGroup.id, partnerName),
  room: createMediaRoom(dmPair[0], dmPair.slice(1)),
  extraHandlers: [dmPresenceHandler(edgeDmGroup.id, [me, edgeDmPartner])],
});

/** DM video call: both cameras on (simulated feeds), overlay open over the DM. */
const dmVideo: VoicePersona[] = [{ user: me, camera: true }, { user: edgeDmPartner, camera: true, speaking: true }];
export const DmVideoCall = defineEdgeScreen(scenario, {
  path: dmPath,
  voiceState: dmVoiceState(edgeDmGroup.id, partnerName, {
    showVideoTiles: true,
    watchingCameras: new Set([edgeDmPartner.id]),
  }),
  room: createMediaRoom(dmVideo[0], dmVideo.slice(1), { cameras: [edgeDmPartner.id] }),
  extraHandlers: [dmPresenceHandler(edgeDmGroup.id, [me, edgeDmPartner])],
});

/** Incoming DM call ringing while idle on the DM list. */
const ringSocket = createControllableSocket();
export const IncomingCallBanner = defineEdgeScreen(scenario, {
  path: '/direct-messages',
  socket: ringSocket,
  overlay: <FireServerEvent socket={ringSocket} event={ServerEvents.DM_VOICE_CALL_STARTED} payload={callStarted(edgeDmGroup.id)} />,
});

/** Incoming DM call while already connected to a community voice channel (banner on top, voice bar at bottom). */
const busyCrew: VoicePersona[] = [{ user: me }, ...others(scenario, 3).map((user, i) => ({ user, speaking: i === 0 }))];
const busySocket = createControllableSocket();
export const IncomingCallWhileInVoice = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, busyCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(busyCrew[0], busyCrew.slice(1)),
  socket: busySocket,
  overlay: <FireServerEvent socket={busySocket} event={ServerEvents.DM_VOICE_CALL_STARTED} payload={callStarted(edgeDmGroup.id)} />,
});

/** Connected to voice, reading #general with a 4-line draft in the composer — voice bar + composer stacked. */
const draft = 'running 5 min late to standup\nstill in the other call\ncan someone share the board?\nthanks 🙏';
export const VoiceBarWithComposer = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, busyCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(busyCrew[0], busyCrew.slice(1)),
  overlay: <TypeIntoTextareaOnMount text={draft} />,
});

/** Same, at the short "keyboard up" phone viewport (id contains "keyboard" → phone-short only). */
export const VoiceBarWithComposerKeyboard = defineEdgeScreen(withChannelPresence(scenario, edgeVoiceChannel.id, busyCrew), {
  path: generalPath,
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom(busyCrew[0], busyCrew.slice(1)),
  overlay: <TypeIntoTextareaOnMount text={draft} />,
});
