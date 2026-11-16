/**
 * The new design's shell ("the Lounge"): the kit's theme, fed from the user's appearance settings,
 * around the Lounge frame (frame/LoungeFrame.tsx), which renders the registered route's screen.
 *
 * A lazy chunk of its own (see shell/loungeRootChunk.ts): with the new design off nothing here,
 * nothing of the kit and none of its fonts is ever requested. scripts/check-bundle-budget.mjs (d)
 * looks for LOUNGE_ROOT_MARKER to prove it stays out of the first page load.
 *
 * Import boundary (design §2): this chunk imports the kit (its index only), src/data, the headless
 * hooks, the api client, shared and the router; never components/, pages/ or MUI. Enforced by the
 * headless block in eslint.config.js and __tests__/shell/loungeImportBoundary.test.ts.
 */
import { useEffect, useRef, type JSX } from 'react';
import { KitProvider } from '../../kit';
import { useAppearance } from '../../hooks/useAppearance';
import type { LoungeChoice } from '../chooseShell';
import { LoungeFrame } from './frame/LoungeFrame';
import { leftLounge } from '../routeMemory';
import { useInteractiveWidgetResizesContent } from './viewportWidget';

export const LOUNGE_ROOT_MARKER = 'semaphore-lounge-root';

export interface LoungeRootProps {
  choice: LoungeChoice;
}

export default function LoungeRoot({ choice }: LoungeRootProps): JSX.Element {
  const { baseColor, mode, intensity } = useAppearance();
  const root = useRef<HTMLDivElement>(null);
  // The old shell shows next: the Lounge paths shown before are no longer what Back returns to. Here and not in
  // the frame, whose screens suspend (and clean their effects up) while a screen's module loads.
  useEffect(() => leftLounge, []);
  // The on-screen keyboard resizes the layout (Android), restored exactly when the old shell shows.
  useInteractiveWidgetResizesContent();
  return (
    <KitProvider base={baseColor} mode={mode} intensity={intensity}>
      {/* `display: contents`: a marker for tests and the bundle check, with no box of its own. */}
      <div ref={root} data-shell="lounge" data-lounge-root={LOUNGE_ROOT_MARKER} style={{ display: 'contents' }}>
        <LoungeFrame choice={choice} rootRef={root} />
      </div>
    </KitProvider>
  );
}
