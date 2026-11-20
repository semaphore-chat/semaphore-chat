/**
 * The community home (`/community/:communityId`, shell/lounge/screens/CommunityHomeScreen): the first real Lounge
 * screen, the real registered descriptor in the real frame with the connected pieces on the mock-ups' data
 * (`fixtures/loungeCommunityHandlers.ts`). The app shows it at phone width only; at tablet and desktop the real path
 * is the old shell, so those widths here show what the descriptor would draw there (an empty centre), not the app.
 *
 * States: the phone home, in a call, the members Sheet opened from the header's "N around", not a member, loading,
 * no channels and a long channel list.
 */
import { useRef, type JSX } from 'react';
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import { RoomContext } from '../../contexts/RoomContextDef';
import { SpeakingProvider } from '../../contexts/SpeakingContext';
import { COMMUNITY_HOME_PATH, LOUNGE_ROUTES } from '../../shell/loungeRoutes';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import type { ModeName } from '../../theme/derive/derivePalette';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { LOUNGE_COMMUNITY_ID, loungeCommunityHandlers } from '../fixtures/loungeCommunityHandlers';
import { channelVoiceState, createMediaRoom } from '../fixtures/edge/voice';
import { ClickOnMount } from '../fixtures/interactions';

const home = LOUNGE_ROUTES.find((route) => route.path === COMMUNITY_HOME_PATH)!;

/** The header's members button, once the community has loaded. Module-level: ClickOnMount reruns on a new `find`. */
const findAroundButton = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('nav[aria-label="Community"] button')].find((button) =>
    /show members$|^Members$/.test(button.getAttribute('aria-label') ?? ''),
  ) ?? null;

function Frame({ mode, openMembers }: { mode: ModeName; openMembers: boolean }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  return (
    <KitFrameStage mode={mode}>
      <IncomingCallProvider>
        <div ref={root} style={{ display: 'contents' }}>
          <LoungeFrame choice={{ kind: 'lounge', route: home, params: { communityId: LOUNGE_COMMUNITY_ID } }} rootRef={root} />
        </div>
        {openMembers && <ClickOnMount find={findAroundButton} />}
      </IncomingCallProvider>
    </KitFrameStage>
  );
}

const story = (options: { mode?: ModeName; openMembers?: boolean; handlers?: HttpHandler[] } = {}) =>
  defineComponent(bigCommunityScenario, () => <Frame mode={options.mode ?? 'dark'} openMembers={options.openMembers ?? false} />, {
    maxWidth: false,
    extraHandlers: [...(options.handlers ?? []), ...loungeCommunityHandlers],
  });

const channelsPath = `/api/channels/community/${LOUNGE_COMMUNITY_ID}`;
const textChannel = (i: number, name: string) => ({
  id: `ch-many-${i}`,
  name,
  communityId: LOUNGE_COMMUNITY_ID,
  type: 'TEXT',
  isPrivate: i % 9 === 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  position: i,
  slowmodeSeconds: 0,
  preset: i === 0 ? 'ANNOUNCEMENT' : 'NORMAL',
});

/** The phone home: the community's header with "9 around" (a button), its channels and rooms, the dock below. */
export const Phone = story();

/** The same, light. */
export const PhoneLight = story({ mode: 'light' });

/** "9 around" pressed: the members Sheet over the home (Escape or Close returns focus to the button). */
export const MembersSheetOpen = story({ openMembers: true });

/** A community the server says is not yours (403): the way back to your communities. */
export const NotMember = story({
  handlers: [
    http.get(`/api/community/${LOUNGE_COMMUNITY_ID}`, () => HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })),
    http.get(channelsPath, () => HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })),
  ],
});

/** Still loading the community and its channels: the header and row skeletons. */
export const Loading = story({
  handlers: [
    http.get(`/api/community/${LOUNGE_COMMUNITY_ID}`, async () => {
      await delay('infinite');
      return HttpResponse.json({});
    }),
    http.get(channelsPath, async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    }),
  ],
});

/** The channels failed to load: Try again in the island; the header still shows. */
export const ChannelsError = story({
  handlers: [http.get(channelsPath, () => HttpResponse.json({ statusCode: 500, message: 'Server error' }, { status: 500 }))],
});

/** No channels and no rooms: the empty line, and no "Create channel" (the classic list's, not offered here). */
export const NoChannels = story({ handlers: [http.get(channelsPath, () => HttpResponse.json([]))] });

/** Forty text channels, some with long names: the island scrolls, the page does not. */
export const LongChannelList = story({
  handlers: [
    http.get(channelsPath, () =>
      HttpResponse.json(
        Array.from({ length: 40 }, (_, i) =>
          textChannel(i, i % 7 === 3 ? `the-extremely-long-channel-name-number-${i}-that-nobody-will-read-in-full` : `channel-${i}`),
        ),
      ),
    ),
  ],
});

const me = bigCommunityScenario.me;
const [sharer, cameraOn] = bigCommunityScenario.users.filter((u) => u.id !== me.id);
const inCallRoom = createMediaRoom({ user: me }, [{ user: sharer, screen: true, speaking: true }, { user: cameraOn, camera: true }], {
  screens: [sharer.id],
});
const inCallState = channelVoiceState(
  { id: 'vc-squad', name: 'Squad Up', communityId: LOUNGE_COMMUNITY_ID },
  { watchingScreenShares: new Set([sharer.id]), watchingCameras: new Set() },
);

/** In Squad Up with a peer's share watched: the call slot (surface and bar) between the home and the dock. */
export const PhoneInCall = defineComponent(
  bigCommunityScenario,
  () => (
    <RoomContext.Provider value={{ room: inCallRoom, setRoom: () => {}, getRoom: () => inCallRoom }}>
      <SpeakingProvider>
        <Frame mode="dark" openMembers={false} />
      </SpeakingProvider>
    </RoomContext.Provider>
  ),
  { maxWidth: false, extraHandlers: loungeCommunityHandlers, voiceState: inCallState },
);
