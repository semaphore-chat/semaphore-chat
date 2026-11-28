/**
 * The `settings` template of the Lounge frame (the guide's "Settings with side navigation"): the kit SettingsLayout
 * with the screen's sections in the nav island and the chosen section in the content island, and the shell's own
 * pieces around them, as in the three islands:
 *
 * - the dock above the nav island at compact and wide (the place's community current, or none for a user's
 *   settings). A phone has no dock bar here: settings are a screen pushed over the app, left by their own Back
 *   (Discord's app does the same);
 * - the user's card at the nav island's foot at compact and wide;
 * - the call bar (the frame's call slot, `ShellCall`) under the nav island at compact and wide, and between the pane
 *   and the bottom on a phone, so the call's controls stay on screen and nobody is left deafened without a control.
 *
 * A section pins its own bar (unsaved changes) to the content island with `useSettingsFooter`: the frame shows the slot
 * only for the path it was asked on, and the section portals the bar's content into it, so the bar reads the section's
 * context and never outlives it.
 *
 * A phone's Back on a section goes to `phoneBackTo(params)`: a step back in the history when the list was the screen
 * before (as the chat's Back to its home), else a replace, so the system Back never returns to the section.
 */
import { memo, Suspense, useCallback, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsLayout, useWidthRange } from '../../../kit';
import { useCallSlotShown } from '../../../data/callSlot';
import type { LoungeParams, SettingsChrome, SettingsScreen } from '../screen';
import { SettingsChromeContext } from '../screen';
import { APP_LINKS, LoungeLinksContext } from '../links';
import { SignOutConfirmHost } from '../pieces/signOutConfirm';
import { ShellDockConnected } from '../pieces/ShellDock';
import { AllCommunitiesSheetConnected } from '../pieces/AllCommunitiesSheet';
import { UserCardConnected } from '../pieces/community/UserCard';
import { CentreSkeleton } from '../pieces/CentreSkeleton';
import { ShellCall } from '../pieces/call/ShellCall';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenError } from './ScreenError';
import { previousPathname } from '../../routeMemory';

export interface SettingsFrameProps {
  screen: SettingsScreen;
  params: LoungeParams;
  /** The path: a crashed section is cleared on the next path (another section too). */
  resetKey: string;
  title: string | null;
}

/** Whether the call slot shows reads the voice state, which changes often: only this wrapper re-renders for it. */
export function SettingsFrame(props: SettingsFrameProps): JSX.Element {
  const callShown = useCallSlotShown();
  return <SettingsBody {...props} callShown={callShown} />;
}

const SettingsBody = memo(function SettingsBody({
  screen,
  params,
  resetKey,
  title,
  callShown,
}: SettingsFrameProps & { callShown: boolean }): JSX.Element {
  const range = useWidthRange();
  const navigate = useNavigate();
  // The path the footer slot was asked for: it shows only while that is the current path.
  const [footerFor, setFooterFor] = useState<string | null>(null);
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const footerShown = footerFor === resetKey;
  const showFooter = useCallback(() => {
    setFooterFor(resetKey);
    return () => setFooterFor((current) => (current === resetKey ? null : current));
  }, [resetKey]);
  const chrome = useMemo<SettingsChrome>(
    () => ({ showFooter, footerTarget: footerShown ? footerTarget : null }),
    [showFooter, footerShown, footerTarget],
  );
  const backTo = screen.phoneBackTo(params);
  const onBack = useCallback(() => {
    if (previousPathname() === backTo) void navigate(-1);
    else void navigate(backTo, { replace: true });
  }, [backTo, navigate]);
  const [allOpen, setAllOpen] = useState(false);
  const communityId = screen.place === 'community' ? (params.communityId ?? null) : null;
  const { Nav, Content } = screen;
  const phone = range === 'phone';

  return (
    <SettingsChromeContext value={chrome}>
      <LoungeLinksContext value={screen.links ?? APP_LINKS}>
        {/* One sign-out question above the width switch, as in the three islands (the user's card opens it). */}
        <SignOutConfirmHost>
          <SettingsLayout
            title={title ?? 'Settings'}
            nav={<Nav params={params} />}
            navLabel={screen.navLabel ?? 'Settings sections'}
            phonePane={screen.phonePane}
            onBack={onBack}
            footer={footerShown ? <div ref={setFooterTarget} style={{ display: 'contents' }} /> : undefined}
            dock={
              phone ? undefined : (
                <ShellDockConnected
                  current={communityId === null ? null : { kind: 'community', id: communityId }}
                  onOpenAll={() => setAllOpen(true)}
                  allOpen={allOpen}
                />
              )
            }
            navFooter={phone ? undefined : <UserCardConnected />}
            callBar={callShown ? <ShellCall /> : undefined}
          >
            <ScreenBoundary resetKey={resetKey} fallback={(reset) => <ScreenError inIsland onRetry={reset} />}>
              <Suspense fallback={<CentreSkeleton />}>
                <Content params={params} />
              </Suspense>
            </ScreenBoundary>
          </SettingsLayout>
          <AllCommunitiesSheetConnected open={allOpen} onClose={() => setAllOpen(false)} currentId={communityId} />
        </SignOutConfirmHost>
      </LoungeLinksContext>
    </SettingsChromeContext>
  );
});
