/**
 * The Lounge frame (shell/lounge/frame/LoungeFrame.tsx): a route's screen descriptor rendered into
 * its template. `bare` is the marker filling the frame; `threeIslands` is the chat template with the
 * shell's pieces in their slots. The pieces are placeholders until PRs 5-7: here each slot shows its
 * name, so the screenshots show where the dock, the community, the members and the call bar sit at
 * phone, tablet and desktop width. In the app the placeholders render nothing.
 */
import { useRef, type JSX } from 'react';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import type { LoungeChoice } from '../../shell/chooseShell';
import { LOUNGE_ROUTES, type LoungeRoute } from '../../shell/loungeRoutes';
import type { ThreeIslandsScreen } from '../../shell/lounge/screen';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import { ShowPlaceholdersContext } from '../../shell/lounge/pieces/placeholderContext';
import type { ModeName } from '../../theme/derive/derivePalette';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { http, HttpResponse } from 'msw';

/** The mock-ups' sample user. */
const sampleUser = http.get('/api/users/profile', () =>
  HttpResponse.json({ ...bigCommunityScenario.me, username: 'alexk', displayName: null }),
);

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
    { maxWidth: false, extraHandlers: [sampleUser] },
  );

const threeIslands = (mode: ModeName, route: LoungeRoute) =>
  defineComponent(
    bigCommunityScenario,
    () => <Frame mode={mode} placeholders choice={{ kind: 'lounge', route, params: { communityId: 'c-1' } }} />,
    { maxWidth: false, extraHandlers: [sampleUser] },
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
