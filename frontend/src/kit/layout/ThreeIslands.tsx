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
import { CallSlot, DockSlot, leftColumnGrid, phoneColumnGrid } from './leftColumnGrid';

export interface ThreeIslandsProps {
  /** A kit Dock. Above the left island, or the bar at the bottom of a phone (left out while the keyboard is up). */
  dock?: ReactNode;
  /** The place: community header, channels, voice rooms, the user's card. */
  left: ReactNode;
  /**
   * Stays at the foot of the left island while the rest of it scrolls (the user's own card). Inside the island, so
   * the call bar (compact and wide) stays under the island, below this footer.
   */
  leftFooter?: ReactNode;
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
  /** Called when the Sheet below wide has finished closing. */
  onRightExited?: () => void;
  /**
   * The right content brings its own header (with a Close), scrolling and padding, and fills the region: a thread
   * with its list and composer. The island has no padding and the Sheet below wide is a filling one (`Sheet` `fill`).
   */
  rightFill?: boolean;
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
  /** The on-screen keyboard is up. */
  $keyboard: boolean;
}

function columnRange({ $dock, $call, $right }: GridProps) {
  return leftColumnGrid({
    dock: $dock,
    call: $call,
    column: 'left',
    rest: $right ? ['centre', 'right'] : ['centre'],
    restColumns: ['minmax(0, 1fr)', ...($right ? [`${tokens.layout.rightColumn}px`] : [])],
  });
}

function phoneRange({ $dock, $call, $keyboard }: GridProps) {
  return phoneColumnGrid({ dock: $dock, call: $call, keyboard: $keyboard });
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
  // A size container: the call slot's video is capped against the height this grid really has (after the banner
  // row, the keyboard and the safe areas), in `cqh`.
  containerType: 'size',
  ...columnRange({ ...props, $right: false }),
  [atMedia(media.wide)]: columnRange(props),
  [atMedia(media.phone)]: phoneRange(props),
}));

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
 * Toasts sit at the bottom centre of the pane that is the `main` (the centre, or the left pane on a phone showing
 * it), so they never cover the left column, the call bar or the dock.
 * Render inside an `AppFrame`, which also keeps the bottom bar clear of the home indicator.
 */
export function ThreeIslands({
  dock,
  left,
  leftFooter,
  leftLabel,
  centre,
  centreLabel,
  right,
  rightLabel,
  rightOpen,
  onRightClose,
  onRightExited,
  rightFill = false,
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
    <Grid $dock={hasDock} $call={hasCall} $right={showIsland} $keyboard={keyboard}>
      {!phone && hasDock && <DockSlot data-slot="dock">{dock}</DockSlot>}
      <PhonePane
        ref={leftRef}
        tabIndex={-1}
        $area="left"
        hidden={!leftShown}
        inert={!leftShown}
        role={phone && phonePane === 'left' ? 'main' : undefined}
        data-kit-toast-anchor={phone && phonePane === 'left' ? '' : undefined}
      >
        <Island as="nav" label={leftLabel} padding="md" scroll footer={leftFooter ?? null}>
          {left}
        </Island>
      </PhonePane>
      {!phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      <PhonePane
        ref={centreRef}
        tabIndex={-1}
        $area="centre"
        hidden={!centreShown}
        inert={!centreShown}
        data-kit-toast-anchor={centreShown ? '' : undefined}
      >
        <Island as="main" label={centreLabel} padding="none" scroll>
          {centre}
        </Island>
      </PhonePane>
      {showIsland && (
        <Pane ref={rightRef} tabIndex={-1} $area="right">
          <Island as="aside" label={name} padding={rightFill ? 'none' : undefined} scroll>
            {right}
          </Island>
        </Pane>
      )}
      {phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      {phone && hasDock && <DockSlot data-slot="dock">{dock}</DockSlot>}
      {range !== 'wide' && hasRight && (
        <Sheet open={open} onClose={onRightClose ?? noop} title={name} fill={rightFill} onExited={onRightExited}>
          {right}
        </Sheet>
      )}
    </Grid>
  );
}
