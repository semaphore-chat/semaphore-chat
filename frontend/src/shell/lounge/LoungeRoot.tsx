/**
 * The new design's shell ("the Lounge"): the kit's theme, fed from the user's
 * appearance settings, the ground (AppFrame), an error boundary of its own and
 * the registered screen for the current route.
 *
 * A lazy chunk of its own (see shell/loungeRootChunk.ts): with the new design off
 * nothing here, nothing of the kit and none of its fonts is ever requested.
 * scripts/check-bundle-budget.mjs (d) looks for LOUNGE_ROOT_MARKER to prove it
 * stays out of the first page load.
 */
import { lazy, Suspense, type ComponentType, type JSX, type LazyExoticComponent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppFrame, Button, Island, KitProvider, Text } from '../../kit';
import { useAppearance } from '../../hooks/useAppearance';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { LoungeChoice } from '../chooseShell';
import type { LoungeRoute, LoungeScreenProps } from '../loungeRoutes';

export const LOUNGE_ROOT_MARKER = 'semaphore-lounge-root';

/** One lazy component per registered route, so a screen keeps its identity across renders. */
const screens = new WeakMap<LoungeRoute, LazyExoticComponent<ComponentType<LoungeScreenProps>>>();

function screenFor(route: LoungeRoute): LazyExoticComponent<ComponentType<LoungeScreenProps>> {
  let screen = screens.get(route);
  if (screen === undefined) {
    screen = lazy(route.load);
    screens.set(route, screen);
  }
  return screen;
}

/** Shown in the frame when a screen of the new design crashes. The call, if any, carries on. */
function ScreenError(): JSX.Element {
  const navigate = useNavigate();
  return (
    <Island as="main" label="Something went wrong" scroll>
      <Text variant="title" as="h1">
        Something went wrong
      </Text>
      <p>
        <Text tone="secondary">This screen could not be shown. If you are in a call, it is still connected.</Text>
      </p>
      <div>
        <Button onClick={() => navigate('/')}>Back to the app</Button>
      </div>
    </Island>
  );
}

export interface LoungeRootProps {
  choice: LoungeChoice;
}

export default function LoungeRoot({ choice }: LoungeRootProps): JSX.Element {
  const { baseColor, mode, intensity } = useAppearance();
  const Screen = screenFor(choice.route);
  return (
    <KitProvider base={baseColor} mode={mode} intensity={intensity}>
      {/* `display: contents`: a marker for tests and the bundle check, with no box of its own. */}
      <div data-shell="lounge" data-lounge-root={LOUNGE_ROOT_MARKER} style={{ display: 'contents' }}>
        <AppFrame>
          <ErrorBoundary key={choice.route.path} fallback={() => <ScreenError />}>
            <Suspense fallback={null}>
              <Screen params={choice.params} />
            </Suspense>
          </ErrorBoundary>
        </AppFrame>
      </div>
    </KitProvider>
  );
}
