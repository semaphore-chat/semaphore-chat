/**
 * The Lounge frame (shell/lounge/frame/LoungeFrame.tsx): a route's screen descriptor rendered into
 * its template. `bare` is the marker filling the frame; `threeIslands` is the chat template with the
 * shell's pieces in their slots: the dock, the community left island and the members (PR 6) are the real,
 * connected pieces, on the mock-ups' people and places (`fixtures/loungeCommunityHandlers.ts`). The call slot is
 * real (PR 7) and empty out of a call, so it has no row here; its own stories (call-bar--*, call-surface--*,
 * voice-notice-bar--*) show it. The `settings` and `stage` templates (C4 S1) render their hidden fixtures' descriptors.
 */
import { useRef, type JSX } from 'react';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import type { LoungeChoice } from '../../shell/chooseShell';
import {
  LOUNGE_ROUTES,
  LOUNGE_SETTINGS_FIXTURE_PATH,
  LOUNGE_SETTINGS_SECTION_FIXTURE_PATH,
  LOUNGE_STAGE_FIXTURE_PATH,
  type LoungeRoute,
} from '../../shell/loungeRoutes';
import type { ThreeIslandsScreen } from '../../shell/lounge/screen';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import { ShowPlaceholdersContext } from '../../shell/lounge/pieces/placeholderContext';
import type { ModeName } from '../../theme/derive/derivePalette';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { LOUNGE_COMMUNITY_ID, loungeCommunityHandlers } from '../fixtures/loungeCommunityHandlers';
import { RoomContext } from '../../contexts/RoomContextDef';
import { SpeakingProvider } from '../../contexts/SpeakingContext';
import { channelVoiceState, createMediaRoom } from '../fixtures/edge/voice';

const placeholderScreen = (phonePane: 'left' | 'centre'): ThreeIslandsScreen => ({
  template: 'threeIslands',
  place: 'community',
  phonePane,
  // The centre is the screen's own part (empty here): it has no padding, so a label would sit on its corner.
  Centre: null,
  right: 'members',
  useTitle: () => 'Couch Co-op',
});

const placeholderRoute = (phonePane: 'left' | 'centre'): LoungeRoute => ({
  path: '/community/:communityId',
  widths: ['phone', 'compact', 'wide'],
  load: async () => ({ default: placeholderScreen(phonePane) }),
});

const centreRoute = placeholderRoute('centre');
const leftRoute = placeholderRoute('left');

function Frame({ mode, choice, placeholders }: { mode: ModeName; choice: LoungeChoice; placeholders: boolean }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  return (
    <KitFrameStage mode={mode}>
      <IncomingCallProvider>
        <ShowPlaceholdersContext value={placeholders}>
          <div ref={root} style={{ display: 'contents' }}>
            <LoungeFrame choice={choice} rootRef={root} />
          </div>
        </ShowPlaceholdersContext>
      </IncomingCallProvider>
    </KitFrameStage>
  );
}

const bare = (mode: ModeName) =>
  defineComponent(
    bigCommunityScenario,
    () => <Frame mode={mode} placeholders={false} choice={{ kind: 'lounge', route: LOUNGE_ROUTES[0], params: {} }} />,
    { maxWidth: false, extraHandlers: loungeCommunityHandlers },
  );

const threeIslands = (mode: ModeName, route: LoungeRoute) =>
  defineComponent(
    bigCommunityScenario,
    () => <Frame mode={mode} placeholders choice={{ kind: 'lounge', route, params: { communityId: LOUNGE_COMMUNITY_ID } }} />,
    { maxWidth: false, extraHandlers: loungeCommunityHandlers },
  );

/** `bare`: the marker screen fills the frame with its own island. Dark. */
export const Bare = bare('dark');

/** `bare`, light. */
export const BareLight = bare('light');

/**
 * `threeIslands` with placeholder pieces: the dock, the community (left), the screen's centre, the
 * members (an island at wide, a closed Sheet below), the call bar; the centre (the screen's own) is
 * left empty. Phone shows the centre pane.
 */
export const ThreeIslandsPlaceholders = threeIslands('dark', centreRoute);

/** The same, light. */
export const ThreeIslandsPlaceholdersLight = threeIslands('light', centreRoute);

/** A screen whose phone pane is the left one (a community home): the left island is the phone's main. */
export const ThreeIslandsPhoneLeft = threeIslands('dark', leftRoute);

/** In Squad Up (the island's first voice room) with a peer's share watched and another's camera offered. */
const me = bigCommunityScenario.me;
const [sharer, cameraOn] = bigCommunityScenario.users.filter((u) => u.id !== me.id);
const inCallRoom = createMediaRoom({ user: me }, [{ user: sharer, screen: true, speaking: true }, { user: cameraOn, camera: true }], {
  screens: [sharer.id],
});
const inCallState = channelVoiceState(
  { id: 'vc-squad', name: 'Squad Up', communityId: LOUNGE_COMMUNITY_ID },
  { watchingScreenShares: new Set([sharer.id]), watchingCameras: new Set() },
);

const threeIslandsInCall = (mode: ModeName, route: LoungeRoute) =>
  defineComponent(
    bigCommunityScenario,
    () => (
      <RoomContext.Provider value={{ room: inCallRoom, setRoom: () => {}, getRoom: () => inCallRoom }}>
        <SpeakingProvider>
          <Frame mode={mode} placeholders choice={{ kind: 'lounge', route, params: { communityId: LOUNGE_COMMUNITY_ID } }} />
        </SpeakingProvider>
      </RoomContext.Provider>
    ),
    { maxWidth: false, extraHandlers: loungeCommunityHandlers, voiceState: inCallState },
  );

/**
 * Everything real at once, in a call: the dock, the community left island (Squad Up outlined "You're here", the
 * user card in its footer), the members, and the call slot (the surface with a watched share and an offered
 * camera, above the call bar). Compact and wide: the slot under the left island's footer; phone: between the pane
 * and the dock.
 */
export const ThreeIslandsInCall = threeIslandsInCall('dark', centreRoute);

/** The same, light. */
export const ThreeIslandsInCallLight = threeIslandsInCall('light', centreRoute);

/** In a call, the phone showing the left pane (the community): the slot under it, above the dock. */
export const ThreeIslandsInCallPhoneLeft = threeIslandsInCall('dark', leftRoute);

// --- The settings and stage templates (#848 C4, S1), on their hidden fixtures' descriptors ---

const fixtureRoute = (path: string) => LOUNGE_ROUTES.find((route) => route.path === path)!;
const settingsListRoute = fixtureRoute(LOUNGE_SETTINGS_FIXTURE_PATH);
const settingsSectionRoute = fixtureRoute(LOUNGE_SETTINGS_SECTION_FIXTURE_PATH);
const stageRoute = fixtureRoute(LOUNGE_STAGE_FIXTURE_PATH);

const templateStory = (
  mode: ModeName,
  route: LoungeRoute,
  params: Record<string, string>,
  inCall: boolean,
) =>
  defineComponent(
    bigCommunityScenario,
    () => {
      const frame = <Frame mode={mode} placeholders={false} choice={{ kind: 'lounge', route, params }} />;
      return inCall ? (
        <RoomContext.Provider value={{ room: inCallRoom, setRoom: () => {}, getRoom: () => inCallRoom }}>
          <SpeakingProvider>{frame}</SpeakingProvider>
        </RoomContext.Provider>
      ) : (
        frame
      );
    },
    { maxWidth: false, extraHandlers: loungeCommunityHandlers, ...(inCall ? { voiceState: inCallState } : {}) },
  );

/**
 * `settings`: the dock above the sections, the user's card at their foot, the section beside them (phone: the
 * section, with Back). Out of a call.
 */
export const SettingsSection = templateStory('dark', settingsSectionRoute, { section: 'general' }, false);

/** The same, light. */
export const SettingsSectionLight = templateStory('light', settingsSectionRoute, { section: 'general' }, false);

/** The list path: a phone shows the list of sections; compact and wide show the first section beside it. */
export const SettingsList = templateStory('dark', settingsListRoute, {}, false);

/**
 * In a call (Squad Up, a share watched): the call slot under the sections at compact and wide, between the section
 * and the bottom on a phone (no dock bar there), so the call's controls stay on screen.
 */
export const SettingsInCall = templateStory('dark', settingsSectionRoute, { section: 'appearance' }, true);

/** In a call, the phone showing the list of sections: the call bar under it. */
export const SettingsInCallList = templateStory('dark', settingsListRoute, {}, true);

/**
 * `stage`, out of a call: the room (Squad Up) in the three islands' centre with the community beside it at compact
 * and wide, no members; the full stage on a phone (no dock bar), the call bar absent (no call).
 */
export const StageNotInCall = templateStory('dark', stageRoute, { communityId: LOUNGE_COMMUNITY_ID, channelId: 'vc-squad' }, false);

/** The same, light. */
export const StageNotInCallLight = templateStory('light', stageRoute, { communityId: LOUNGE_COMMUNITY_ID, channelId: 'vc-squad' }, false);

/**
 * `stage`, in this room's call: compact and wide keep the frame's call slot beside the room; a phone leaves it out and
 * the room's controls are the call's (the fixture shows the call bar there in their place).
 */
export const StageInCall = templateStory('dark', stageRoute, { communityId: LOUNGE_COMMUNITY_ID, channelId: 'vc-squad' }, true);

/** `stage`, a room you are not in while your call is in Squad Up: every width keeps the call slot. */
export const StageOtherRoomInCall = templateStory('dark', stageRoute, { communityId: LOUNGE_COMMUNITY_ID, channelId: 'vc-afk' }, true);
