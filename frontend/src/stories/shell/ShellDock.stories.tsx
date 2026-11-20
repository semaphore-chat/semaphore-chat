/**
 * The new shell's dock (shell/lounge/pieces/ShellDock.tsx) in the chat template: above the left island
 * at tablet and desktop width, the bottom bar on a phone. The mock-ups' communities and counts: Couch
 * Co-op current, Lumen Studio 2 mentions, Friday LAN new messages, Wavelength both (the count wins).
 * `connected` renders the connected dock in the Lounge frame against the sandbox's MSW data.
 */
import { useRef, useState, type JSX } from 'react';
import { ShellDock, type DockCurrent, type ShellDockProps } from '../../shell/lounge/pieces/ShellDock';
import type { ModeName } from '../../theme/derive/derivePalette';
import { LoungePiecesFrame } from '../fixtures/LoungePiecesFrame';
import { LONG_NAME, MOCKUP_STATES, sampleCommunities, type SampleCommunity } from '../fixtures/loungeCommunities';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import type { LoungeRoute } from '../../shell/loungeRoutes';
import type { ThreeIslandsScreen } from '../../shell/lounge/screen';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';
import { http, HttpResponse } from 'msw';

interface DockStoryProps {
  mode?: ModeName;
  communities?: readonly SampleCommunity[];
  current?: DockCurrent;
  inboxCount?: number;
  status?: ShellDockProps['status'];
}

function DockStory({
  mode = 'dark',
  communities = sampleCommunities(5, MOCKUP_STATES),
  current = { kind: 'community', id: 'c-1' },
  inboxCount = 9,
  status = 'ready',
}: DockStoryProps): JSX.Element {
  const [allOpen, setAllOpen] = useState(false);
  return (
    <LoungePiecesFrame
      mode={mode}
      dock={(range) => (
        <ShellDock
          communities={communities}
          current={current}
          inboxCount={inboxCount}
          status={status}
          onOpenInbox={() => undefined}
          onOpenAll={() => setAllOpen(!allOpen)}
          allOpen={allOpen}
          bottomBar={range === 'phone'}
        />
      )}
    />
  );
}

/** Mentions vs new messages vs both: Lumen Studio 2, Friday LAN the dot, Wavelength 3 (the count wins); Couch Co-op current. */
export const MentionsAndNew = () => <DockStory />;

/** The same, light. */
export const Light = () => <DockStory mode="light" />;

/** While the server's list loads: Inbox, three placeholder circles, All. */
export const Loading = () => <DockStory status="loading" />;

/** The list failed to load: Inbox and All only (the toast with Try again is the connected dock's). */
export const LoadError = () => <DockStory status="error" />;

/** In no community yet: Inbox and All (the sheet offers Create). */
export const None = () => <DockStory communities={[]} current={null} inboxCount={0} />;

/** One community, current. */
export const One = () => <DockStory communities={sampleCommunities(1)} />;

/** Twelve: the bar scrolls sideways at narrow widths and keeps the current one (Night Owls, c-11) in view. */
export const Twelve = () => (
  <DockStory communities={sampleCommunities(12, MOCKUP_STATES)} current={{ kind: 'community', id: 'c-11' }} />
);

/** Sixty: the current one near the end stays in view. */
export const Sixty = () => (
  <DockStory communities={sampleCommunities(60, MOCKUP_STATES)} current={{ kind: 'community', id: 'c-55' }} />
);

/** The inbox is the current place: no community has the ring. */
export const InboxCurrent = () => <DockStory current={{ kind: 'inbox' }} />;

/** Long names: the item is a picture; the name is its tooltip and accessible name only. */
export const LongNames = () => (
  <DockStory
    communities={[
      { id: 'long', name: LONG_NAME, mentions: 12, newMessages: false, inYourCall: false },
      ...sampleCommunities(3),
    ]}
    current={{ kind: 'community', id: 'long' }}
  />
);

/** The mock-ups' sample user. */
const sampleUser = http.get('/api/users/profile', () =>
  HttpResponse.json({ ...bigCommunityScenario.me, username: 'alexk', displayName: null }),
);

const screenFor: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'left',
  Centre: null,
  right: 'members',
  useTitle: () => primaryCommunity.name,
};

const route: LoungeRoute = {
  path: '/community/:communityId',
  widths: ['phone', 'compact', 'wide'],
  load: async () => ({ default: screenFor }),
};

function ConnectedFrame(): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  return (
    <KitFrameStage mode="dark">
      <IncomingCallProvider>
        <div ref={root} style={{ display: 'contents' }}>
          <LoungeFrame choice={{ kind: 'lounge', route, params: { communityId: primaryCommunity.id } }} rootRef={root} />
        </div>
      </IncomingCallProvider>
    </KitFrameStage>
  );
}

/** The connected dock in the Lounge frame: the sandbox's communities and unread counts over MSW. */
export const Connected = defineComponent(bigCommunityScenario, () => <ConnectedFrame />, {
  maxWidth: false,
  extraHandlers: [sampleUser],
});
