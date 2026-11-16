import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';

/**
 * The typing line's height: the room the message list core keeps under its last row for it
 * (`TYPING_INDICATOR_HEIGHT`, 32 px), so it never covers a message.
 */
export const TYPING_LINE_HEIGHT = tokens.space['2xl'];

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

/** The words, as the old shell writes them: one name, two names, or the first name and how many others. */
export function typingText(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  const others = names.length - 1;
  return `${names[0]} and ${others} others are typing…`;
}

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
