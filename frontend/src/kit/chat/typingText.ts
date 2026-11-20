import { tokens } from '../../theme/generated/tokens';

/**
 * The typing line's height: the room the message list core keeps under its last row for it
 * (`TYPING_INDICATOR_HEIGHT`, 32 px), so it never covers a message.
 */
export const TYPING_LINE_HEIGHT = tokens.space['2xl'];

/** The words, as the old shell writes them: one name, two names, or the first name and how many others. */
export function typingText(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  const others = names.length - 1;
  return `${names[0]} and ${others} others are typing…`;
}
