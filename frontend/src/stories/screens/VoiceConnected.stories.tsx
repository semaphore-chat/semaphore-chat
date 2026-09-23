import { SandboxShell } from '../fixtures/SandboxShell';
import { StoryRoutes } from '../fixtures/StoryRoutes';
import { makeHandlers } from '../fixtures/handlers';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { bigCommunityScenario, primaryCommunity, primaryVoiceChannel } from '../fixtures/scenarios';
import { createFakeVoiceRoom, FakeRoomProvider } from '../fixtures/fakeRoom';

/**
 * Voice-connected state, viewing the joined voice channel: the persistent
 * bottom voice bar plus the embedded voice STAGE (#443) — one avatar tile per
 * participant (nobody has a camera on) — with the fake participants from
 * `voicePresenceByChannel` (see `builder.ts`) also listed in the sidebar's
 * compact list. Both the stage and `VoiceChannelUserList` read participants
 * from the LiveKit `Room` object (`voiceState.room`) while "connected", not
 * the REST voice-presence query, so this needs a fake `Room`, not just
 * fixture data. See `fixtures/fakeRoom.tsx` for exactly what that stub
 * implements and what it deliberately leaves un-faked (real video feeds —
 * the edge voice stories use `createMediaRoom()` for those).
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
