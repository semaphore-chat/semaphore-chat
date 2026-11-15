import { useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Island } from '../surfaces/Island';
import { Sheet } from '../overlays/Sheet';
import { transientProps } from '../theme/transientProps';
import { atMedia, media, useWidthRange } from './breakpoints';
import { Pane } from './Pane';
import { isPresent } from './present';
import { useFollowFocus } from './useFollowFocus';
import { useKeyboardInset } from './useKeyboardInset';

export interface ThreeIslandsProps {
  /** A kit Dock. Above the left island, or the bar at the bottom of a phone (left out while the keyboard is up). */
  dock?: ReactNode;
  /** The place: community header, channels, voice rooms, the user's card. */
  left: ReactNode;
  leftLabel: string;
  /** The conversation or task. This island is the screen's `main`. */
  centre: ReactNode;
  centreLabel: string;
  /** Context: members, a thread, pins. Its own island when wide; a Sheet below that. */
  right?: ReactNode;
  /** Names the right island and the Sheet. Falls back to "Details". */
  rightLabel?: string;
  /**
   * Whether the right content is showing, at every width: an island at wide, a Sheet below. Left out, it is
   * showing at wide and closed below. Below wide `onRightClose` is called for the Sheet's close requests; at wide
   * the screen closes the island with its own control (a Members button in the centre header).
   */
  rightOpen?: boolean;
  /** Called when the Sheet asks to close (Escape, the scrim, Close). */
  onRightClose?: () => void;
  /**
   * The persistent in-call strip. On a phone it sits between the shown pane and the dock bar and stays
   * whichever pane shows; at compact and wide it is at the bottom of the left column, under the left island.
   */
  callBar?: ReactNode;
  /** Which pane a phone shows. */
  phonePane?: 'left' | 'centre';
}

interface GridProps {
  $dock: boolean;
  $call: boolean;
  $right: boolean;
}

/** Rows top to bottom: the dock (if any), the left island, the call bar (if any). The centre (and right) span them all. */
function columnRange({ $dock, $call, $right }: GridProps) {
  const rest = $right ? ['centre', 'right'] : ['centre'];
  const rows: [string, string][] = [];
  if ($dock) {
    rows.push(['dock', `${tokens.layout.dock}px`]);
  }
  rows.push(['left', 'minmax(0, 1fr)']);
  if ($call) {
    rows.push(['call', 'auto']);
  }
  return {
    gridTemplateAreas: rows.map(([area]) => `"${[area, ...rest].join(' ')}"`).join(' '),
    gridTemplateColumns: [
      `${tokens.layout.leftColumn}px`,
      'minmax(0, 1fr)',
      ...($right ? [`${tokens.layout.rightColumn}px`] : []),
    ].join(' '),
    gridTemplateRows: rows.map(([, size]) => size).join(' '),
  };
}

/** One column of cells, top to bottom: the shown pane, the call bar (if any), the dock bar (if any). */
function phoneRange({ $dock, $call }: GridProps) {
  const rows: [string, string][] = [['pane', 'minmax(0, 1fr)']];
  if ($call) {
    rows.push(['call', 'auto']);
  }
  if ($dock) {
    rows.push(['dock', `${tokens.layout.dock}px`]);
  }
  return {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateAreas: rows.map(([area]) => `"${area}"`).join(' '),
    gridTemplateRows: rows.map(([, size]) => size).join(' '),
  };
}

/**
 * Written from the compact range up: the wide and phone rules only change what differs, so a browser that
 * cannot parse one query still has a grid.
 */
const Grid = styled('div', { shouldForwardProp: transientProps })<GridProps>((props) => ({
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gap: `${tokens.layout.gutter}px`,
  ...columnRange({ ...props, $right: false }),
  [atMedia(media.wide)]: columnRange(props),
  [atMedia(media.phone)]: phoneRange(props),
}));

const DockSlot = styled('div')({ gridArea: 'dock', minWidth: 0, display: 'block' });

const CallSlot = styled('div')({ gridArea: 'call', minWidth: 0, display: 'block' });

/** The left and centre islands share the `pane` cell of a phone; the other one is hidden there. */
const PhonePane = styled(Pane)({ [atMedia(media.phone)]: { gridArea: 'pane' } });

const noop = () => undefined;

/**
 * The chat screen: the dock, the place, the conversation and the context.
 *
 * - wide: a left column (the dock above the left island, the call bar under it) | the centre island | the right
 *   island while `rightOpen`.
 * - compact: the left column | the centre. The right content is a Sheet, shown while `rightOpen`.
 * - phone: one pane fills the frame (`phonePane`), then the call bar, then the dock bar. The other pane
 *   stays mounted but `hidden` and `inert`, so a draft typed in it survives and nothing in it can be reached.
 *   While the on-screen keyboard is up the dock bar is left out, so the composer keeps the room. The right
 *   content is a Sheet.
 *
 * Landmarks: the left island is a `nav`, the centre the `main`, the right an `aside`, and the dock its own
 * `nav`, in reading order. On a phone showing the left pane there would be no `main`, so that pane sits in one.
 * The centre island has no padding: the conversation brings its own header, list and composer, and on a
 * phone its own Back to the left pane.
 *
 * What is rebuilt when the width changes: the dock and the call bar (they move, so DOM order stays the visual
 * order) and the right content (island at wide, Sheet below; a closed Sheet holds nothing). Keep nothing
 * important only in them: a reply draft belongs in the screen's own state. Left and centre are never rebuilt.
 * When the pane that holds focus stops being shown, focus moves to the pane now shown.
 * Optional slots count as absent when they are `undefined`, `null`, `false` or `''`.
 * Render inside an `AppFrame`, which also keeps the bottom bar clear of the home indicator.
 */
export function ThreeIslands({
  dock,
  left,
  leftLabel,
  centre,
  centreLabel,
  right,
  rightLabel,
  rightOpen,
  onRightClose,
  callBar,
  phonePane = 'centre',
}: ThreeIslandsProps): JSX.Element {
  const range = useWidthRange();
  const keyboard = useKeyboardInset() > 0;
  const phone = range === 'phone';
  const hasRight = isPresent(right);
  const open = hasRight && (rightOpen ?? range === 'wide');
  const showIsland = open && range === 'wide';
  const hasCall = isPresent(callBar);
  const hasDock = isPresent(dock) && !(phone && keyboard);
  const name = rightLabel ?? 'Details';

  const leftRef = useRef<HTMLDivElement>(null);
  const centreRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftShown = !phone || phonePane === 'left';
  const centreShown = !phone || phonePane === 'centre';
  useFollowFocus(
    { left: leftRef, centre: centreRef, right: rightRef },
    [...(leftShown ? ['left'] : []), ...(centreShown ? ['centre'] : []), ...(showIsland ? ['right'] : [])],
    phone ? (phonePane === 'left' ? 'left' : 'centre') : 'centre',
  );

  return (
    <Grid $dock={hasDock} $call={hasCall} $right={showIsland}>
      {!phone && hasDock && <DockSlot>{dock}</DockSlot>}
      <PhonePane
        ref={leftRef}
        tabIndex={-1}
        $area="left"
        hidden={!leftShown}
        inert={!leftShown}
        role={phone && phonePane === 'left' ? 'main' : undefined}
      >
        <Island as="nav" label={leftLabel} padding="md" scroll>
          {left}
        </Island>
      </PhonePane>
      {!phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      <PhonePane ref={centreRef} tabIndex={-1} $area="centre" hidden={!centreShown} inert={!centreShown}>
        <Island as="main" label={centreLabel} padding="none" scroll>
          {centre}
        </Island>
      </PhonePane>
      {showIsland && (
        <Pane ref={rightRef} tabIndex={-1} $area="right">
          <Island as="aside" label={name} scroll>
            {right}
          </Island>
        </Pane>
      )}
      {phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      {phone && hasDock && <DockSlot>{dock}</DockSlot>}
      {range !== 'wide' && hasRight && (
        <Sheet open={open} onClose={onRightClose ?? noop} title={name}>
          {right}
        </Sheet>
      )}
    </Grid>
  );
}
