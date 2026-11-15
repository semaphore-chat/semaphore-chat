/**
 * The Lounge frame (design §4, PA-1): resolves the route's screen descriptor and renders its template
 * with the shell's pieces, the banner row, the shell's page effects and route focus. Everything here
 * runs inside the KitProvider that LoungeRoot mounts.
 *
 * The descriptor is read through a per-route cache that suspends until it has loaded. Navigation is a transition (the
 * router wraps its updates in `startTransition`), so a screen still loading keeps the current one on
 * screen and the frame never blanks; only a first entry shows nothing for a moment.
 */
import { Suspense, useCallback, useLayoutEffect, useState, type JSX, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { AppFrame } from '../../../kit';
import type { LoungeChoice } from '../../chooseShell';
import type { LoungeRoute } from '../../loungeRoutes';
import type { LoungeParams, LoungeScreen, UseScreenTitle } from '../screen';
import { ShellBanners } from '../pieces/ShellBanners';
import { hasBanners, useShellBannersModel } from '../pieces/shellBannersModel';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenError } from './ScreenError';
import { ShellEffects } from './ShellEffects';
import { RouteFocus } from './RouteFocus';
import { ThreeIslandsFrame } from './ThreeIslandsFrame';

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

function ScreenFrame({ choice, rootRef }: { choice: LoungeChoice; rootRef: RefObject<HTMLElement | null> }): JSX.Element {
  const screen = readScreen(choice.route);
  const { pathname } = useLocation();
  // The title with the choice it was reported for: after a navigation the previous screen's title is
  // never used (or announced) for the new one, even for the one render before the new probe reports.
  const [titled, setTitled] = useState<{ choice: LoungeChoice; title: string | null } | null>(null);
  const title = titled !== null && titled.choice === choice ? titled.title : null;
  const onTitle = useCallback((next: string | null) => setTitled({ choice, title: next }), [choice]);
  const routeKey = choice.route.path;

  return (
    <>
      <TitleProbe key={routeKey} useTitle={screen.useTitle} params={choice.params} onTitle={onTitle} />
      {screen.template === 'bare' ? (
        <screen.Body params={choice.params} />
      ) : (
        <ThreeIslandsFrame screen={screen} params={choice.params} routeKey={routeKey} title={title} />
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

export function LoungeFrame({ choice, rootRef }: LoungeFrameProps): JSX.Element {
  useState(retryFailedScreens);
  const banners = useShellBannersModel();
  return (
    <>
      <ShellEffects />
      <AppFrame banner={hasBanners(banners) ? <ShellBanners {...banners} /> : undefined}>
        <ScreenBoundary resetKey={choice.route.path} fallback={<ScreenError />}>
          <Suspense fallback={null}>
            <ScreenFrame choice={choice} rootRef={rootRef} />
          </Suspense>
        </ScreenBoundary>
      </AppFrame>
    </>
  );
}
