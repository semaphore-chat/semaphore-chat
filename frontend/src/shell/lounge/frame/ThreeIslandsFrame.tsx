/**
 * The `threeIslands` template of the Lounge frame: the shell's own pieces (dock, left island, members,
 * call bar, the "All communities" sheet) around the screen's centre. This component stays mounted while
 * the user moves between two screens of this template, so every piece keeps its state, scroll and focus;
 * only the centre changes.
 */
import { memo, Suspense, useMemo, useState, type JSX } from 'react';
import { ESCAPE_PRIORITY, ThreeIslands, useScreenEscape, useWidthRange } from '../../../kit';
import type { LoungeParams, ScreenChrome, ThreeIslandsScreen } from '../screen';
import { ScreenChromeContext } from '../screen';
import { ShellDockConnected, type DockCurrent } from '../pieces/ShellDock';
import { AllCommunitiesSheetConnected } from '../pieces/AllCommunitiesSheet';
import { CommunityLeft } from '../pieces/community/CommunityLeft';
import { UserCardConnected } from '../pieces/community/UserCard';
import { InboxLeft } from '../pieces/InboxLeft';
import { MembersIslandConnected } from '../pieces/MembersIsland';
import { CentreSkeleton } from '../pieces/CentreSkeleton';
import { ShellCall } from '../pieces/call/ShellCall';
import { useCallSlotShown } from '../../../data/callSlot';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenError } from './ScreenError';

export interface ThreeIslandsFrameProps {
  screen: ThreeIslandsScreen;
  params: LoungeParams;
  /** The path: a crashed centre is cleared on the next path (another channel too). */
  resetKey: string;
  title: string | null;
}

function dockCurrent(screen: ThreeIslandsScreen, params: LoungeParams): DockCurrent {
  if (screen.place === 'inbox') return { kind: 'inbox' };
  return params.communityId ? { kind: 'community', id: params.communityId } : null;
}

/**
 * Whether the call slot is shown reads the voice state, which changes often (every mute, every presence
 * patch): only this wrapper re-renders for it, and the islands below only when the slot comes or goes.
 */
export function ThreeIslandsFrame(props: ThreeIslandsFrameProps): JSX.Element {
  const callShown = useCallSlotShown();
  return <ThreeIslandsBody {...props} callShown={callShown} />;
}

const ThreeIslandsBody = memo(function ThreeIslandsBody({
  screen,
  params,
  resetKey,
  title,
  callShown,
}: ThreeIslandsFrameProps & { callShown: boolean }): JSX.Element {
  const range = useWidthRange();
  // Null until the user (or the screen) chooses: the template's default (shown at wide, closed below).
  const [rightChoice, setRightChoice] = useState<boolean | null>(null);
  const [allOpen, setAllOpen] = useState(false);

  // The Escape chain's panel step: closes the right island the user opened. Below wide the right
  // content is a Sheet, a layer that takes Escape itself before the screen sees it.
  useScreenEscape(() => {
    if (rightChoice !== true) return false;
    setRightChoice(false);
    return true;
  }, ESCAPE_PRIORITY.panel);

  const chrome = useMemo<ScreenChrome>(
    () => ({ rightOpen: rightChoice ?? range === 'wide', setRightOpen: setRightChoice }),
    [rightChoice, range],
  );

  const { Centre, right } = screen;
  const communityId = params.communityId ?? null;
  const rightContent =
    right === 'members' ? (
      communityId === null ? undefined : <MembersIslandConnected communityId={communityId} />
    ) : right === null ? undefined : (
      (() => {
        const Right = right;
        return <Right params={params} />;
      })()
    );

  return (
    <ScreenChromeContext value={chrome}>
      <ThreeIslands
        dock={<ShellDockConnected current={dockCurrent(screen, params)} onOpenAll={() => setAllOpen(true)} allOpen={allOpen} />}
        left={
          screen.place === 'community' ? (
            communityId === null ? null : (
              <CommunityLeft communityId={communityId} channelId={params.channelId ?? null} />
            )
          ) : (
            <InboxLeft />
          )
        }
        leftFooter={
          // The user's own card stays at the left island's foot at compact and wide; a phone has none.
          screen.place === 'community' && communityId !== null && range !== 'phone' ? <UserCardConnected /> : undefined
        }
        leftLabel={screen.place === 'community' ? 'Community' : 'Inbox'}
        centre={
          <ScreenBoundary resetKey={resetKey} fallback={(reset) => <ScreenError inIsland onRetry={reset} />}>
            <Suspense fallback={<CentreSkeleton />}>{Centre === null ? null : <Centre params={params} />}</Suspense>
          </ScreenBoundary>
        }
        centreLabel={title ?? 'Conversation'}
        right={rightContent}
        rightLabel={screen.rightLabel ?? (right === 'members' ? 'Members' : undefined)}
        rightOpen={rightChoice ?? undefined}
        onRightClose={() => setRightChoice(false)}
        callBar={callShown ? <ShellCall /> : undefined}
        phonePane={screen.phonePane}
      />
      <AllCommunitiesSheetConnected open={allOpen} onClose={() => setAllOpen(false)} currentId={communityId} />
    </ScreenChromeContext>
  );
});
