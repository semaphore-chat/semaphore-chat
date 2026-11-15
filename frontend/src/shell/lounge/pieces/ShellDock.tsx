/**
 * PLACEHOLDER (PR 3) for `ShellDock` and its connected wrapper (design §3.1, PR 5): the community
 * switcher in the dock slot. Renders nothing in the app yet; the props are the frame's side of the
 * contract the real piece takes.
 */
import type { JSX } from 'react';
import { Placeholder } from './Placeholder';

/** What the dock marks as current, from the route's params (no `useParams` in pieces). */
export type DockCurrent = { kind: 'community'; id: string } | { kind: 'inbox' } | null;

export interface ShellDockConnectedProps {
  current: DockCurrent;
  /** Opens the "All communities" sheet, whose state is the frame's. */
  onOpenAll(): void;
}

export function ShellDockConnected(_props: ShellDockConnectedProps): JSX.Element | null {
  return <Placeholder name="Dock" />;
}
