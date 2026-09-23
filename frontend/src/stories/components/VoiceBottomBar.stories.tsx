import { VoiceBottomBar } from '../../components/Voice';
import { ReplayBufferProvider } from '../../contexts/ReplayBufferContext';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario, primaryCommunity, primaryVoiceChannel } from '../fixtures/scenarios';

/** The persistent bottom voice bar, connected — no real LiveKit connection is attempted (see VoiceConnected screen story). */
export const Connected = defineComponent(
  bigCommunityScenario,
  () => (
    <ReplayBufferProvider>
      <VoiceBottomBar />
    </ReplayBufferProvider>
  ),
  {
    maxWidth: false,
    voiceState: {
      isConnected: true,
      contextType: VoiceSessionType.Channel,
      currentChannelId: primaryVoiceChannel.id,
      channelName: primaryVoiceChannel.name,
      communityId: primaryCommunity.id,
      isPrivate: false,
      createdAt: new Date().toISOString(),
    },
  },
);
