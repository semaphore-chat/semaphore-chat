/**
 * The Lounge frame (design §4, PA-1): resolves the route's screen descriptor and renders its template (`bare`,
 * `threeIslands` and `stage` in ThreeIslandsFrame, `settings` in SettingsFrame) with the shell's pieces, the banner row, the shell's page effects and route focus. Everything here
 * runs inside the KitProvider that LoungeRoot mounts.
 *
 * The descriptor is read through a per-route cache that suspends until it has loaded. Navigation is a transition (the
 * router wraps its updates in `startTransition`), so a screen still loading keeps the current one on
 * screen and the frame never blanks; only a first entry shows nothing for a moment.
 */
import { Suspense, useCallback, useLayoutEffect, useState, type JSX, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { AppFrame, useWidthRange } from '../../../kit';
import type { LoungeChoice } from '../../chooseShell';
import type { LoungeRoute } from '../../loungeRoutes';
import type { LoungeParams, LoungeScreen, StageScreen, UseScreenTitle } from '../screen';
import { ShellBanners } from '../pieces/ShellBanners';
import { useShellBannersModel, visibleBanners } from '../pieces/shellBannersModel';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenError } from './ScreenError';
import { ShellEffects } from './ShellEffects';
import { RouteFocus } from './RouteFocus';
import { ThreeIslandsFrame } from './ThreeIslandsFrame';
import { SettingsFrame } from './SettingsFrame';
import { notePathname } from '../../routeMemory';

type ScreenLoad =
  | { status: 'pending'; promise: Promise<unknown> }
  | { status: 'ready'; screen: LoungeScreen }
  | { status: 'failed'; error: unknown };

/**
 * One load per registered route, read the same on every render. A failed load stays failed (the
 * screen boundary shows it; reading it again must not start a load per render) until the frame mounts
 * again: the next entry into the new shell tries once more.
 */
const screens = new WeakMap<LoungeRoute, ScreenLoad>();
const failed = new Set<LoungeRoute>();

function retryFailedScreens(): void {
  failed.forEach((route) => screens.delete(route));
  failed.clear();
}

/**
 * The route's descriptor, or a suspension until it has loaded (Suspense's thrown-promise contract,
 * as `React.lazy` does; `use()` of a fresh promise does not retry under the test renderer's sync `act`).
 */
function readScreen(route: LoungeRoute): LoungeScreen {
  let load = screens.get(route);
  if (load === undefined) {
    const promise = route.load().then(
      (module) => {
        screens.set(route, { status: 'ready', screen: module.default });
      },
      (error: unknown) => {
        screens.set(route, { status: 'failed', error });
        failed.add(route);
      },
    );
    load = { status: 'pending', promise };
    screens.set(route, load);
  }
  if (load.status === 'ready') return load.screen;
  if (load.status === 'failed') throw load.error;
  throw load.promise;
}

/** Runs one screen's title hook, in a component of its own per route so two screens' hooks never mix. */
function TitleProbe({
  useTitle,
  params,
  onTitle,
}: {
  useTitle: UseScreenTitle;
  params: LoungeParams;
  onTitle: (title: string | null) => void;
}): null {
  const title = useTitle(params);
  useLayoutEffect(() => onTitle(title), [onTitle, title]);
  return null;
}

/** Runs a stage's `useShowsCall`, in a component of its own per route, as the title probe. */
function ShowsCallProbe({
  useShowsCall,
  params,
  onValue,
}: {
  useShowsCall: StageScreen['useShowsCall'];
  params: LoungeParams;
  onValue: (value: boolean) => void;
}): null {
  const value = useShowsCall(params);
  useLayoutEffect(() => onValue(value), [onValue, value]);
  return null;
}

function ScreenFrame({ choice, rootRef }: { choice: LoungeChoice; rootRef: RefObject<HTMLElement | null> }): JSX.Element {
  const screen = readScreen(choice.route);
  const { pathname } = useLocation();
  // The title with the choice it was reported for: after a navigation the previous screen's title is
  // never used (or announced) for the new one, even for the one render before the new probe reports.
  const [titled, setTitled] = useState<{ choice: LoungeChoice; title: string | null } | null>(null);
  const title = titled !== null && titled.choice === choice ? titled.title : null;
  const onTitle = useCallback((next: string | null) => setTitled({ choice, title: next }), [choice]);
  const routeKey = choice.route.path;
  useLayoutEffect(() => notePathname(pathname), [pathname]);
  // A stage's "shows the call you are in", for the choice it was reported for (as the title).
  const [shows, setShows] = useState<{ choice: LoungeChoice; value: boolean } | null>(null);
  const showsCall = shows !== null && shows.choice === choice && shows.value;
  const onShowsCall = useCallback((value: boolean) => setShows({ choice, value }), [choice]);

  return (
    <>
      <TitleProbe key={routeKey} useTitle={screen.useTitle} params={choice.params} onTitle={onTitle} />
      {screen.template === 'stage' && (
        <ShowsCallProbe key={routeKey} useShowsCall={screen.useShowsCall} params={choice.params} onValue={onShowsCall} />
      )}
      {screen.template === 'bare' ? (
        <screen.Body params={choice.params} />
      ) : screen.template === 'settings' ? (
        <SettingsFrame screen={screen} params={choice.params} resetKey={pathname} title={title} />
      ) : (
        // Three islands and a stage share one frame: between a channel and a room its pieces stay mounted.
        <ThreeIslandsFrame screen={screen} params={choice.params} resetKey={pathname} title={title} showsCall={showsCall} />
      )}
      <RouteFocus rootRef={rootRef} pathname={pathname} title={title} />
    </>
  );
}

export interface LoungeFrameProps {
  choice: LoungeChoice;
  /** The element around the frame, for route focus. */
  rootRef: RefObject<HTMLElement | null>;
}

/**
 * AppFrame with the banner row. The banner model reads the call, the connection, the update progress and
 * more, all of which change often: only this component re-renders for them (I6). The screen is its
 * `children`, an element made by LoungeFrame, so React skips it when only the banners change.
 */
function ShellBannerSlot({ children }: { children: ReactNode }): JSX.Element {
  const banners = useShellBannersModel();
  const range = useWidthRange();
  const hasAny = visibleBanners(banners, range).length > 0;
  return <AppFrame banner={hasAny ? <ShellBanners {...banners} /> : undefined}>{children}</AppFrame>;
}

export function LoungeFrame({ choice, rootRef }: LoungeFrameProps): JSX.Element {
  useState(retryFailedScreens);
  // The path, not the route pattern: a crash on one channel is cleared on the next (I4), as the old
  // shell's RouteErrorBoundary does.
  const { pathname } = useLocation();
  return (
    <>
      <ShellEffects />
      <ShellBannerSlot>
        <ScreenBoundary
          resetKey={pathname}
          fallback={(reset) => (
            <ScreenError
              onRetry={() => {
                retryFailedScreens();
                reset();
              }}
            />
          )}
        >
          <Suspense fallback={null}>
            <ScreenFrame choice={choice} rootRef={rootRef} />
          </Suspense>
        </ScreenBoundary>
      </ShellBannerSlot>
    </>
  );
}
