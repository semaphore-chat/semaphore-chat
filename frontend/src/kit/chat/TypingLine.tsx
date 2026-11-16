import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { TYPING_LINE_HEIGHT, typingText } from './typingText';

export interface TypingLineProps {
  /** Who is typing, by name, the first to start first. Nothing is drawn while it is empty. */
  names: readonly string[];
}

const Root = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.small;
  return {
    display: 'flex',
    alignItems: 'center',
    height: `${TYPING_LINE_HEIGHT}px`,
    minWidth: 0,
    paddingInline: `${tokens.space.md}px`,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontStyle: 'italic',
    color: palette.textSecondary,
  };
});

const Words = styled('span')({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/**
 * Who is typing in the conversation, one quiet line at the bottom of the message list (`ChatPane`'s `typing`).
 * A long name gives way with an ellipsis; the line never wraps or grows.
 */
export function TypingLine({ names }: TypingLineProps): JSX.Element | null {
  if (names.length === 0) return null;
  return (
    <Root data-testid="typing-line">
      <Words dir="auto">{typingText(names)}</Words>
    </Root>
  );
}
