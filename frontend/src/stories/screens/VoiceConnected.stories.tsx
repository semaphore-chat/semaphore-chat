import { SandboxShell } from '../fixtures/SandboxShell';
import { StoryRoutes } from '../fixtures/StoryRoutes';
import { makeHandlers } from '../fixtures/handlers';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { bigCommunityScenario, primaryCommunity, primaryVoiceChannel } from '../fixtures/scenarios';
import { createFakeVoiceRoom, FakeRoomProvider } from '../fixtures/fakeRoom';

/**
 * Voice-connected state: the persistent bottom voice bar showing, with fake
 * participants already in `voicePresenceByChannel` (see `builder.ts`) — and,
 * unlike a plain `defineScreen()` story, actually rendered in the sidebar's
 * compact list and the main channel-view panel too. Both go through
 * `VoiceChannelUserList`, which — while "connected" — reads participants
 * from the LiveKit `Room` object (`voiceState.room`) instead of the REST
 * voice-presence query, so a real fix needs a fake `Room`, not just fixture
 * data. See `fixtures/fakeRoom.ts` for exactly what that stub implements
 * and why (traced against every hook that touches `room` in this render
 * tree) and what it deliberately leaves un-faked (the video-tile overlay).
 *
 * This can't use `defineScreen()` as-is: the fake `Room` has to be provided
 * INSIDE `AuthenticatedShell`'s real (always-null-in-the-sandbox)
 * `RoomProvider` so it shadows it, and only `SandboxShell`'s `children` slot
 * reaches inside that far — so this hand-assembles the same tree
 * `defineScreen` would, with that one addition.
 */
const voicePresence = bigCommunityScenario.voicePresenceByChannel[primaryVoiceChannel.id] ?? [];
const fakeRoom = createFakeVoiceRoom(bigCommunityScenario.me, voicePresence);

export const VoiceConnected: LadleStoryComponent = () => (
  <SandboxShell
    path={`/community/${primaryCommunity.id}/channel/${primaryVoiceChannel.id}`}
    voiceState={{
      isConnected: true,
      contextType: VoiceSessionType.Channel,
      currentChannelId: primaryVoiceChannel.id,
      channelName: primaryVoiceChannel.name,
      communityId: primaryCommunity.id,
      isPrivate: false,
      createdAt: new Date().toISOString(),
    }}
  >
    <FakeRoomProvider room={fakeRoom}>
      <StoryRoutes />
    </FakeRoomProvider>
  </SandboxShell>
);
VoiceConnected.msw = makeHandlers(bigCommunityScenario);
