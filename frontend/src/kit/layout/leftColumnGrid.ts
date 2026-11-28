/**
 * The grid shared by the templates with a left column (ThreeIslands, SettingsLayout): at compact and wide the dock
 * above the left island and the call bar under it, the rest of the template beside the column; on a phone one pane,
 * then the call bar, then the dock bar.
 */
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';

/**
 * The least a phone's shown pane keeps while a call bar is there: a composer (a field, `control.md`, with the
 * space screens draw above (`space.sm`) and below (`space.lg`) it). The call's video gives way first. With the
 * keyboard up and the frame very short, the call bar (Leave) wins over it.
 */
export const PANE_MIN = tokens.control.md + tokens.space.sm + tokens.space.lg;

export interface LeftColumnGridOptions {
  dock: boolean;
  call: boolean;
  /** The left island's area ("left", "nav"). */
  column: string;
  /** The areas beside the column, left to right; each spans every row. */
  rest: readonly string[];
  /** Their column sizes. */
  restColumns: readonly string[];
}

/** Compact and wide: rows top to bottom, the dock (if any), the left island, the call bar (if any). */
export function leftColumnGrid({ dock, call, column, rest, restColumns }: LeftColumnGridOptions) {
  const rows: [string, string][] = [];
  if (dock) {
    rows.push(['dock', `${tokens.layout.dock}px`]);
  }
  rows.push([column, 'minmax(0, 1fr)']);
  if (call) {
    rows.push(['call', 'auto']);
  }
  return {
    gridTemplateAreas: rows.map(([area]) => `"${[area, ...rest].join(' ')}"`).join(' '),
    gridTemplateColumns: [`${tokens.layout.leftColumn}px`, ...restColumns].join(' '),
    gridTemplateRows: rows.map(([, size]) => size).join(' '),
  };
}

/** A phone: one column of cells, the shown pane (`pane`), the call bar (if any), the dock bar (if any). */
export function phoneColumnGrid({ dock, call, keyboard }: { dock: boolean; call: boolean; keyboard: boolean }) {
  const rows: [string, string][] = [['pane', call && !keyboard ? `minmax(${PANE_MIN}px, 1fr)` : 'minmax(0, 1fr)']];
  if (call) {
    rows.push(['call', 'auto']);
  }
  if (dock) {
    rows.push(['dock', `${tokens.layout.dock}px`]);
  }
  return {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateAreas: rows.map(([area]) => `"${area}"`).join(' '),
    gridTemplateRows: rows.map(([, size]) => size).join(' '),
  };
}

export const DockSlot = styled('div')({ gridArea: 'dock', minWidth: 0, display: 'block' });

/**
 * The call slot's track is `auto`, but the slot's minimum is 0: when the frame is short the track gets only what
 * the fixed rows and the pane's minimum leave, and the slot's contents (a CallStack) give it back by shrinking the
 * call's video, never the bar.
 */
export const CallSlot = styled('div')({
  gridArea: 'call',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});
