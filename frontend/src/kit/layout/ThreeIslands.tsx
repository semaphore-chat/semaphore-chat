import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Island } from '../surfaces/Island';
import { Sheet } from '../overlays/Sheet';
import { transientProps } from '../theme/transientProps';
import { atMedia, media, useWidthRange } from './breakpoints';
import { Pane } from './Pane';

export interface ThreeIslandsProps {
  /** A kit Dock. Above the left island, or the bar at the bottom of a phone. */
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
  /** Below wide, whether the Sheet is showing. */
  rightOpen?: boolean;
  /** Called when the Sheet asks to close (Escape, the scrim, Close). */
  onRightClose?: () => void;
  /** Which pane a phone shows. */
  phonePane?: 'left' | 'centre';
}

interface GridProps {
  $dock: boolean;
  $right: boolean;
}

/** The rows' and columns' names for a range: the dock (if any) above `left`, the centre, then the right. */
function rowRange({ $dock, $right }: GridProps, withRight: boolean) {
  const row = (cells: string[]) => `"${cells.join(' ')}"`;
  const hasRight = $right && withRight;
  const top = $dock ? [row(['dock', 'centre', ...(hasRight ? ['right'] : [])])] : [];
  const main = row(['left', 'centre', ...(hasRight ? ['right'] : [])]);
  return {
    gridTemplateAreas: [...top, main].join(' '),
    gridTemplateColumns: [
      `${tokens.layout.leftColumn}px`,
      'minmax(0, 1fr)',
      ...(hasRight ? [`${tokens.layout.rightColumn}px`] : []),
    ].join(' '),
    gridTemplateRows: $dock ? `${tokens.layout.dock}px minmax(0, 1fr)` : 'minmax(0, 1fr)',
  };
}

const Grid = styled('div', { shouldForwardProp: transientProps })<GridProps>((props) => ({
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gap: `${tokens.layout.gutter}px`,
  [atMedia(media.wide)]: rowRange(props, true),
  [atMedia(media.compact)]: rowRange(props, false),
  [atMedia(media.phone)]: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: props.$dock ? `minmax(0, 1fr) ${tokens.layout.dock}px` : 'minmax(0, 1fr)',
    gridTemplateAreas: props.$dock ? '"pane" "dock"' : '"pane"',
  },
}));

const DockSlot = styled('div')({ gridArea: 'dock', minWidth: 0, display: 'block' });

/** The left and centre islands share the `pane` cell of a phone; the other one is hidden there. */
const PhonePane = styled(Pane)({ [atMedia(media.phone)]: { gridArea: 'pane' } });

const noop = () => undefined;

/**
 * The chat screen: the dock, the place, the conversation and the context.
 *
 * - wide: a left column (the dock above the left island) | the centre island | the right island.
 * - compact: the left column | the centre. The right content is a Sheet, shown while `rightOpen`.
 * - phone: one pane fills the frame (`phonePane`) and the dock is the bar under it. The other pane
 *   stays mounted but `hidden` and `inert`, so a draft typed in it survives and nothing in it can be reached.
 *   The right content is a Sheet.
 *
 * Landmarks: the left island is a `nav`, the centre the `main`, the right an `aside`, and the dock its own
 * `nav`, in reading order. On a phone showing the left pane there would be no `main`, so that pane sits in one.
 * The centre island has no padding: the conversation brings its own header, list and composer.
 * The dock is mounted where the width puts it (above the left island, or at the bottom of a phone),
 * and the right content is mounted in its island or in the Sheet, as that is what the width shows.
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
  rightOpen = false,
  onRightClose,
  phonePane = 'centre',
}: ThreeIslandsProps): JSX.Element {
  const range = useWidthRange();
  const phone = range === 'phone';
  const hasDock = dock !== undefined;
  const hasRight = right !== undefined;
  const name = rightLabel ?? 'Details';
  return (
    <Grid $dock={hasDock} $right={hasRight}>
      {!phone && hasDock && <DockSlot>{dock}</DockSlot>}
      <PhonePane
        $area="left"
        hidden={phone && phonePane !== 'left'}
        inert={phone && phonePane !== 'left'}
        role={phone && phonePane === 'left' ? 'main' : undefined}
      >
        <Island as="nav" label={leftLabel} padding="md" scroll>
          {left}
        </Island>
      </PhonePane>
      <PhonePane $area="centre" hidden={phone && phonePane !== 'centre'} inert={phone && phonePane !== 'centre'}>
        <Island as="main" label={centreLabel} padding="none" scroll>
          {centre}
        </Island>
      </PhonePane>
      {range === 'wide' && hasRight && (
        <Pane $area="right">
          <Island as="aside" label={name} scroll>
            {right}
          </Island>
        </Pane>
      )}
      {phone && hasDock && <DockSlot>{dock}</DockSlot>}
      {range !== 'wide' && hasRight && (
        <Sheet open={rightOpen} onClose={onRightClose ?? noop} title={name}>
          {right}
        </Sheet>
      )}
    </Grid>
  );
}
