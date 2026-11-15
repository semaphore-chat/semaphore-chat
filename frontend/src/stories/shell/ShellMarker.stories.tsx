/**
 * The new design's marker screen (`/__lounge`, shell/lounge/screens/MarkerScreen.tsx) in its frame:
 * the ground, one island, the user's name, whether they are in a call and where, and the way back.
 * A test fixture of the shell switch, not a template screen; the UI review shoots it at phone,
 * tablet and desktop width.
 */
import { http, HttpResponse } from 'msw';
import { AppFrame } from '../../kit';
import { VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import markerScreen from '../../shell/lounge/screens/MarkerScreen';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario, firstDmGroup, primaryCommunity, primaryVoiceChannel } from '../fixtures/scenarios';

/** The mock-ups' sample user, so the screenshots carry no real-looking name. */
const sampleUser = http.get('/api/users/profile', () =>
  HttpResponse.json({ ...bigCommunityScenario.me, username: 'alexk', displayName: null }),
);
import type { ModeName } from '../../theme/derive/derivePalette';

const inChannel: Partial<VoiceState> = {
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  currentChannelId: primaryVoiceChannel.id,
  channelName: 'Squad Up',
  communityId: primaryCommunity.id,
  isPrivate: false,
  createdAt: '2026-11-15T10:00:00.000Z',
};

const inDm: Partial<VoiceState> = {
  isConnected: true,
  contextType: VoiceSessionType.Dm,
  currentDmGroupId: firstDmGroup.id,
  dmGroupName: 'Hangout',
};

const marker = (mode: ModeName, voiceState?: Partial<VoiceState>) =>
  defineComponent(
    bigCommunityScenario,
    () => (
      <KitFrameStage mode={mode}>
        <AppFrame>
          <markerScreen.Body params={{}} />
        </AppFrame>
      </KitFrameStage>
    ),
    { maxWidth: false, voiceState, extraHandlers: [sampleUser] },
  );

/** Dark, not in a call. */
export const NotInCall = marker('dark');

/** Dark, in a voice channel: the line names the channel. */
export const InCall = marker('dark', inChannel);

/** Dark, in a direct-message call: the line names the conversation. */
export const InDmCall = marker('dark', inDm);

/** Light, not in a call. */
export const NotInCallLight = marker('light');

/** Light, in a voice channel. */
export const InCallLight = marker('light', inChannel);
