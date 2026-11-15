/**
 * The call surface in one line (`CallStack`'s `summary`), shown instead of it while the on-screen keyboard is
 * up: what you watch, what else is offered, your own share. The bar under it keeps Open call view and Leave.
 */
import type { JSX } from 'react';
import { Icon, ListRow } from '../../../../kit';
import type { CallVideoTile } from '../../../../data/callVideo';
import { surfaceSummary } from './callSurfaceText';

export interface CallSurfaceSummaryProps {
  tiles: readonly CallVideoTile[];
  sharingScreen: boolean;
}

export function CallSurfaceSummary({ tiles, sharingScreen }: CallSurfaceSummaryProps): JSX.Element {
  return (
    // One plain row, no card of its own: the frame is short while the keyboard is up, so it takes one line.
    <div data-testid="lounge-call-summary">
      <ListRow primary={surfaceSummary(tiles, sharingScreen)} leading={<Icon name="ScreenShare" tone="secondary" />} />
    </div>
  );
}
