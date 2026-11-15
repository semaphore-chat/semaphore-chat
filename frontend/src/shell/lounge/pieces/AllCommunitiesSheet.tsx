/**
 * PLACEHOLDER (PR 3) for `AllCommunitiesSheet` and its connected wrapper (design §3.2, PR 5): the
 * sheet the dock's "All communities" button opens. The frame holds `open`. Renders nothing yet.
 */
import type { JSX } from 'react';
import type { SheetCloseReason } from '../../../kit';

export interface AllCommunitiesSheetConnectedProps {
  open: boolean;
  onClose(reason: SheetCloseReason): void;
  /** The current community, from the route's params. */
  currentId: string | null;
}

export function AllCommunitiesSheetConnected(_props: AllCommunitiesSheetConnectedProps): JSX.Element | null {
  return null;
}
