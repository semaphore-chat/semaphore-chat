import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { transientProps } from '../theme/transientProps';

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface StackProps {
  /** The space between the children, from the space tokens. */
  gap: StackGap;
  children: ReactNode;
}

const Root = styled('div', { shouldForwardProp: transientProps })<{ $gap: StackGap }>(({ $gap }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: `${tokens.space[$gap]}px`,
  minWidth: 0,
}));

/**
 * Children one under the other with a fixed space between them: the vertical rhythm inside an island, a Card or an
 * overlay's body (a heading, a field, a list). Layout only: no surface, no padding, no semantics.
 */
export function Stack({ gap, children }: StackProps): JSX.Element {
  return <Root $gap={gap}>{children}</Root>;
}
