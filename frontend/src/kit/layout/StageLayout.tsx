import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Island } from '../surfaces/Island';
import { Sheet } from '../overlays/Sheet';

export interface StageLayoutProps {
  /** The title row: room name, who is here, how long. */
  header: ReactNode;
  /** The big thing: a shared screen or the people's tiles. */
  stage: ReactNode;
  /** A row of small tiles under the stage. Leaves no gap when left out. */
  strip?: ReactNode;
  /** The call controls, centred at the bottom. */
  controls: ReactNode;
  /** Names the main landmark. */
  stageLabel: string;
  /** The people. A Sheet at every width, shown while `sideOpen`. */
  side?: ReactNode;
  /** Names the Sheet. Falls back to "People". */
  sideLabel?: string;
  sideOpen?: boolean;
  onSideClose?: () => void;
}

const Column = styled('div')({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

const Header = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.md}px`,
  minHeight: `${tokens.control.md + 2 * tokens.space.lg}px`,
  boxSizing: 'border-box',
  padding: `0 ${tokens.space.lg}px`,
});

/**
 * Takes the rest of the height. Whatever the stage holds is centred and held inside it: never cropped, never wider.
 * It is a size container, so its content can size itself to the room with `cqw` and `cqh` (a 16:9 picture that
 * fits whichever of the width or the height runs out first).
 */
const Stage = styled('div')({
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  containerType: 'size',
  padding: `0 ${tokens.space.lg}px`,
  '& > *': { maxWidth: '100%', maxHeight: '100%', minWidth: 0 },
});

const Strip = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  justifyContent: 'center',
  gap: `${tokens.space.md}px`,
  padding: `${tokens.space.md}px ${tokens.space.lg}px 0`,
  overflowX: 'auto',
  overscrollBehaviorX: 'contain',
});

const Controls = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: `${tokens.space.md}px`,
  padding: `${tokens.space.lg}px`,
});

const noop = () => undefined;

/**
 * The call screen: one island filling the frame (the `main`), a header row, the stage taking the rest of
 * the height with its content centred and contained, an optional strip, and the controls centred at the bottom.
 * `side` (the people) is a Sheet at every width, shown while `sideOpen`. Render inside an `AppFrame`,
 * which keeps the controls above the home indicator.
 */
export function StageLayout({
  header,
  stage,
  strip,
  controls,
  stageLabel,
  side,
  sideLabel,
  sideOpen = false,
  onSideClose,
}: StageLayoutProps): JSX.Element {
  return (
    <>
      <Island as="main" label={stageLabel} padding="none" scroll>
        <Column>
          <Header data-slot="header">{header}</Header>
          <Stage data-slot="stage">{stage}</Stage>
          {strip !== undefined && <Strip data-slot="strip">{strip}</Strip>}
          <Controls data-slot="controls">{controls}</Controls>
        </Column>
      </Island>
      {side !== undefined && (
        <Sheet open={sideOpen} onClose={onSideClose ?? noop} title={sideLabel ?? 'People'}>
          {side}
        </Sheet>
      )}
    </>
  );
}
