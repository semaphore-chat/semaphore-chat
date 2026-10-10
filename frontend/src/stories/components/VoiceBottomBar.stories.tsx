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
      {/* The bar is position:fixed; the transform makes this box its
          containing block so it really is laid out at 320px. */}
      <Box
        sx={{
          width: 320,
          height: 160,
          position: 'relative',
          transform: 'translateZ(0)',
          outline: '1px dashed',
          outlineColor: 'divider',
        }}
      >
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

/**
 * The connection dropped and an automatic rejoin is running (#309): the bar
 * stays up with "Reconnecting voice (n)…" and a Cancel (hang up) button.
 */
const reconnectingVoiceState = {
  ...connectedVoiceState,
  reconnect: { attempt: 3, maxAttempts: 11, nextRetryAt: Date.now() + 5000 },
};

export const Reconnecting = defineComponent(
  bigCommunityScenario,
  () => (
    <ReplayBufferProvider>
      <VoiceBottomBar />
    </ReplayBufferProvider>
  ),
  { maxWidth: false, voiceState: reconnectingVoiceState },
);

/** Reconnecting in a 320px column with a long channel name: the status and Cancel must not clip. */
export const ReconnectingNarrow320 = defineComponent(
  bigCommunityScenario,
  () => (
    <ReplayBufferProvider>
      <Box
        sx={{
          width: 320,
          height: 160,
          position: 'relative',
          transform: 'translateZ(0)',
          outline: '1px dashed',
          outlineColor: 'divider',
        }}
      >
        <VoiceBottomBar />
      </Box>
    </ReplayBufferProvider>
  ),
  {
    maxWidth: false,
    voiceState: {
      ...reconnectingVoiceState,
      channelName: 'Late-night co-working and lo-fi beats',
      reconnect: { attempt: 11, maxAttempts: 11, nextRetryAt: null },
    },
  },
);

// A 320px column is a phone layout only.
ReconnectingNarrow320.meta = { viewports: ['phone'] };
