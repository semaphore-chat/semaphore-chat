import { Box } from '@mui/material';
import { VoiceBottomBar } from '../../components/Voice';
import { ClickOnMount } from '../fixtures/interactions';
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

const connectedVoiceState = {
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  currentChannelId: primaryVoiceChannel.id,
  channelName: primaryVoiceChannel.name,
  communityId: primaryCommunity.id,
  isPrivate: false,
  createdAt: new Date().toISOString(),
};

/**
 * The bar in a 320px-wide column (the narrowest phone we support). On a
 * phone viewport it shows the 4 primary controls (mic, deafen, camera,
 * hang-up) plus "more"; nothing may clip. Desktop/tablet viewports render the
 * full desktop bar squeezed into 320px, which isn't a real layout.
 */
export const Narrow320 = defineComponent(
  bigCommunityScenario,
  () => (
    <ReplayBufferProvider>
      <Box sx={{ width: 320, outline: '1px dashed', outlineColor: 'divider' }}>
        <VoiceBottomBar />
      </Box>
    </ReplayBufferProvider>
  ),
  { maxWidth: false, voiceState: connectedVoiceState },
);

/** Phone: the "more" sheet open (screen share, show tiles, soundboard, settings). */
export const MoreSheetOpen = defineComponent(
  bigCommunityScenario,
  () => (
    <ReplayBufferProvider>
      <VoiceBottomBar />
      <ClickOnMount find={() => document.querySelector<HTMLElement>('button[aria-label="More voice options"]')} />
    </ReplayBufferProvider>
  ),
  { maxWidth: false, voiceState: connectedVoiceState },
);
