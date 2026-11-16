/**
 * The call surface in one line (`CallStack`'s `summary`), shown instead of it while the on-screen keyboard is
 * up: what you watch, what else is offered, your own share, with Stop sharing while you share (the surface and
 * its own Stop sharing are hidden then). The bar under it keeps the room (Open call view) and Leave.
 */
import type { JSX } from 'react';
import { Button, Icon, ListRow } from '../../../../kit';
import type { CallVideoTile } from '../../../../data/callVideo';
import { surfaceSummary } from './callSurfaceText';

export interface CallSurfaceSummaryProps {
  tiles: readonly CallVideoTile[];
  sharingScreen: boolean;
  onStopSharing(): void;
}

export function CallSurfaceSummary({ tiles, sharingScreen, onStopSharing }: CallSurfaceSummaryProps): JSX.Element {
  return (
    // One plain row, no card of its own: the frame is short while the keyboard is up, so it takes one line.
    <div data-testid="lounge-call-summary">
      <ListRow
        primary={surfaceSummary(tiles, sharingScreen)}
        leading={<Icon name="ScreenShare" tone="secondary" />}
        trailing={
          sharingScreen ? (
            <Button variant="danger" size="sm" onClick={onStopSharing}>
              Stop sharing
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
