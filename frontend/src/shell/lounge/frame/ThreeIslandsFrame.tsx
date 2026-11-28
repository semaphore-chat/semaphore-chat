/**
 * The `threeIslands` template of the Lounge frame: the shell's own pieces (dock, left island, members,
 * call bar, the "All communities" sheet) around the screen's centre. This component stays mounted while
 * the user moves between two screens of this template, so every piece keeps its state, scroll and focus;
 * only the centre changes.
 *
 * The right region shows the screen's default right content (the members) or, while the screen has one open, its own
 * panel (a thread, the pinned messages; `ScreenChrome.panel`). The default content stays mounted under the panel,
 * `hidden` and `inert`, so its scroll and data survive and nothing in it can be reached; the screen portals the
 * panel's content into the frame's slot (`panelTarget`). At compact and wide it hosts the desktop shortcuts
 * (`LoungeShortcuts`).
 *
 * It also renders the `stage` template (a room): the same component, so moving between a channel and a room keeps the
 * dock, the left island and the call bar mounted at compact and wide. A stage has no right island; on a phone it is
 * the full stage (no dock bar). On the room of the call you are in, the stage's own controls replace the call bar at
 * every width (the Voice mock-up), but only on evidence: the stage's controls register while mounted
 * (`useStageCallControls`), so a crashed or loading stage leaves the call bar on screen.
 */
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ESCAPE_PRIORITY, ThreeIslands, useScreenEscape, useWidthRange } from '../../../kit';
import type { LoungeParams, RightPanel, ScreenChrome, StageChrome, StageScreen, ThreeIslandsScreen } from '../screen';
import { ScreenChromeContext, StageChromeContext } from '../screen';
import { APP_LINKS, LoungeLinksContext } from '../links';
import { SignOutConfirmHost } from '../pieces/signOutConfirm';
import { ShellDockConnected, type DockCurrent } from '../pieces/ShellDock';
import { AllCommunitiesSheetConnected } from '../pieces/AllCommunitiesSheet';
import { CommunityLeft } from '../pieces/community/CommunityLeft';
import { UserCardConnected } from '../pieces/community/UserCard';
import { InboxLeft } from '../pieces/InboxLeft';
import { MembersIslandConnected } from '../pieces/MembersIsland';
import { CentreSkeleton } from '../pieces/CentreSkeleton';
import { LoungeShortcuts } from './LoungeShortcuts';
import { ShellCall } from '../pieces/call/ShellCall';
import { useCallSlotShown } from '../../../data/callSlot';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenError } from './ScreenError';

export interface ThreeIslandsFrameProps {
  /**
   * A three-islands screen, or a stage (a room): at compact and wide the room is the centre, with no right island;
   * on a phone it is the full stage, with no dock bar. No call bar while `showsCall` and the stage's controls are
   * mounted.
   */
  screen: ThreeIslandsScreen | StageScreen;
  params: LoungeParams;
  /** A stage showing the call you are in (`StageScreen.useShowsCall`): its own controls, once mounted, are the call's. */
  showsCall?: boolean;
  /** The path: a crashed centre is cleared on the next path (another channel too). */
  resetKey: string;
  title: string | null;
}

/**
 * The right region: the default content (the members), and while the screen has a panel open, the panel's slot
 * beside it with the default content `hidden` and `inert`. The same elements either way, so the default content is
 * never remounted when a panel comes or goes.
 */
function RightRegion({
  under,
  panel,
  onTarget,
}: {
  under: ReactNode;
  panel: RightPanel | null;
  onTarget: (element: HTMLElement | null) => void;
}): JSX.Element {
  const covered = panel !== null;
  return (
    <>
      {under !== undefined && under !== null && (
        <div hidden={covered} inert={covered} data-right-under="">
          {under}
        </div>
      )}
      {covered && (
        <div
          ref={onTarget}
          data-right-panel=""
          style={panel.fill === true ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 } : undefined}
        />
      )}
    </>
  );
}

function dockCurrent(screen: ThreeIslandsScreen | StageScreen, params: LoungeParams): DockCurrent {
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
  showsCall = false,
  callShown,
}: ThreeIslandsFrameProps & { callShown: boolean }): JSX.Element {
  const range = useWidthRange();
  // Null until the user (or the screen) chooses: the template's default (shown at wide, closed below).
  const [rightChoice, setRightChoice] = useState<boolean | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [panel, setPanel] = useState<RightPanel | null>(null);
  const [panelTarget, setPanelTarget] = useState<HTMLElement | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const closePanel = useCallback(() => panelRef.current?.onClose(), []);
  // The Sheet below wide fades out after its panel clears: until it has, it keeps the panel's label, size and (empty)
  // slot instead of flashing the members' title and list at another height. Adjusted while rendering, so no frame
  // shows the gap.
  const [closing, setClosing] = useState<RightPanel | null>(null);
  if (panel !== null && closing !== panel) setClosing(panel);
  if (panel === null && closing !== null && (range === 'wide' || rightChoice === true)) setClosing(null);
  const shownPanel = panel ?? closing;

  // The Escape chain's panel step: closes the screen's panel, else the right island the user opened. Below wide the
  // right content is a Sheet, a layer that takes Escape itself before the screen sees it.
  useScreenEscape(() => {
    if (panel !== null) {
      panel.onClose();
      return true;
    }
    if (rightChoice !== true) return false;
    setRightChoice(false);
    return true;
  }, ESCAPE_PRIORITY.panel);

  // "Show the right content, then focus it": the opener (a Members button) goes away once the island shows.
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusRight, setFocusRight] = useState(0);
  useEffect(() => {
    if (focusRight === 0) return;
    const handle = requestAnimationFrame(() => {
      const aside = rootRef.current?.querySelector('aside');
      const pane = aside?.closest<HTMLElement>('[tabindex="-1"]') ?? null;
      pane?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(handle);
  }, [focusRight]);
  const showRight = useCallback(() => {
    // One thing at a time in the right region: an open panel closes first, so the members really show.
    const open = panelRef.current;
    (open?.closeAll ?? open?.onClose)?.();
    setRightChoice(true);
    setFocusRight((n) => n + 1);
  }, []);

  const chrome = useMemo<ScreenChrome>(
    () => ({
      rightOpen: rightChoice ?? range === 'wide',
      setRightOpen: setRightChoice,
      showRight,
      panel,
      setPanel,
      panelTarget: panel === null ? null : panelTarget,
    }),
    [rightChoice, range, showRight, panel, panelTarget],
  );

  // How many of the stage's call controls are mounted and shown (`useStageCallControls`): the only evidence that lets
  // the frame leave out its call bar.
  const [stageControls, setStageControls] = useState(0);
  const stageChrome = useMemo<StageChrome>(
    () => ({
      registerCallControls: () => {
        setStageControls((n) => n + 1);
        return () => setStageControls((n) => n - 1);
      },
    }),
    [],
  );

  const stage = screen.template === 'stage';
  const Centre = stage ? screen.Stage : screen.Centre;
  const right = stage ? null : screen.right;
  const communityId = params.communityId ?? null;
  const phone = range === 'phone';
  // The full stage on a phone: the room alone.
  const fullStage = stage && phone;
  // The room of the call you are in, with its own controls on screen: they replace the call bar, at every width.
  const stageHasCall = stage && showsCall && stageControls > 0;
  const defaultRight =
    right === 'members' ? (
      communityId === null ? undefined : <MembersIslandConnected communityId={communityId} />
    ) : right === null ? undefined : (
      (() => {
        const Right = right;
        return <Right params={params} />;
      })()
    );
  const rightContent =
    shownPanel === null && defaultRight === undefined ? undefined : (
      <RightRegion under={defaultRight} panel={shownPanel} onTarget={setPanelTarget} />
    );
  const defaultLabel = (stage ? undefined : screen.rightLabel) ?? (right === 'members' ? 'Members' : undefined);

  return (
    <ScreenChromeContext value={chrome}>
      <LoungeLinksContext value={screen.links ?? APP_LINKS}>
        {/* One sign-out question above the width switch: the controls that open it come and go with the width. */}
        <SignOutConfirmHost>
          <div ref={rootRef} style={{ display: 'contents' }}>
          <ThreeIslands
            dock={
              fullStage ? undefined : (
                <ShellDockConnected current={dockCurrent(screen, params)} onOpenAll={() => setAllOpen(true)} allOpen={allOpen} />
              )
            }
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
                <Suspense fallback={<CentreSkeleton />}>
                  <StageChromeContext value={stageChrome}>{Centre === null ? null : <Centre params={params} />}</StageChromeContext>
                </Suspense>
              </ScreenBoundary>
            }
            centreLabel={title ?? (stage ? 'Room' : 'Conversation')}
            right={rightContent}
            rightLabel={shownPanel?.label ?? defaultLabel}
            // A panel shows while it is open, at every width; closing it brings back what the user had.
            rightOpen={panel !== null ? true : (rightChoice ?? undefined)}
            onRightClose={panel !== null ? closePanel : () => setRightChoice(false)}
            onRightExited={() => setClosing(null)}
            rightFill={shownPanel?.fill === true}
            callBar={callShown && !stageHasCall ? <ShellCall /> : undefined}
            phonePane={stage ? 'centre' : screen.phonePane}
          />
          </div>
          {/* The desktop shortcuts: compact and wide (a phone has no keyboard shortcuts). */}
          {/* A room is no conversation: Escape there marks nothing read. */}
          {range !== 'phone' && <LoungeShortcuts communityId={communityId} channelId={stage ? null : (params.channelId ?? null)} />}
          <AllCommunitiesSheetConnected open={allOpen} onClose={() => setAllOpen(false)} currentId={communityId} />
        </SignOutConfirmHost>
      </LoungeLinksContext>
    </ScreenChromeContext>
  );
});
