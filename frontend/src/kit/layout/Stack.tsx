import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { transientProps } from '../theme/transientProps';

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface StackProps {
  /** The space between the children, from the space tokens. */
  gap: StackGap;
  children: ReactNode;
  /**
   * `column` (default): one under the other, each as wide as the Stack. `row`: side by side, centred on the cross
   * axis; the children keep their own width (an Avatar, a button) except a Stack with `fill`.
   */
  direction?: 'column' | 'row';
  /** In a row: this Stack takes the room the others leave, and the text in it can cut with an ellipsis. */
  fill?: boolean;
  /** In a column: `start` keeps each child its own width (a Pill under a name) instead of stretching it. */
  align?: 'stretch' | 'start';
}

interface RootProps {
  $gap: StackGap;
  $row: boolean;
  $fill: boolean;
  $start: boolean;
}

const FILL_ATTRIBUTE = 'data-kit-stack-fill';

const Root = styled('div', { shouldForwardProp: transientProps })<RootProps>(({ $gap, $row, $fill, $start }) => ({
  display: 'flex',
  flexDirection: $row ? 'row' : 'column',
  alignItems: $row ? 'center' : $start ? 'flex-start' : 'stretch',
  gap: `${tokens.space[$gap]}px`,
  minWidth: 0,
  // Only a filling Stack gives way in a row; the rest keep their size.
  ...($row && { [`& > :not([${FILL_ATTRIBUTE}])`]: { flexShrink: 0 } }),
  ...($fill && { flex: '1 1 0', minWidth: 0 }),
  // A start-aligned column still never lets a child outgrow it.
  ...($start && { '& > *': { maxWidth: '100%' } }),
}));

/**
 * Children one under the other (or side by side with `direction="row"`) with a fixed space between them: the
 * rhythm inside an island, a Card or an overlay's body. Layout only: no surface, no padding, no semantics.
 */
export function Stack({ gap, children, direction = 'column', fill = false, align = 'stretch' }: StackProps): JSX.Element {
  return (
    <Root
      $gap={gap}
      $row={direction === 'row'}
      $fill={fill}
      $start={align === 'start'}
      {...(fill ? { [FILL_ATTRIBUTE]: '' } : {})}
    >
      {children}
    </Root>
  );
}
