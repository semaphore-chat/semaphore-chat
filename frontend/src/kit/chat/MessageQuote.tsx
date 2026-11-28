import { stripBidiOverrides } from './messageSegments';
import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { visuallyHidden } from '../theme/a11y';
import { useRowTabIndex } from './rowTabScope';

export interface MessageQuoteProps {
  /** Who wrote the message replied to. */
  author: string;
  /** One line of it; it gives way with an ellipsis. */
  line: string;
  /** The message replied to was deleted: no author or words, and nothing to open. */
  deleted?: boolean;
  /** Shows the message replied to (a jump in the list). Without it, or when `deleted`, the quote is plain. */
  onOpen?: () => void;
}

const DELETED_LINE = 'Original message was deleted';

interface LookProps {
  $on: Surface;
  $deleted: boolean;
}

const look = ({ theme, $on, $deleted }: LookProps & { theme: Parameters<typeof kitTheme>[0] }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.small;
  return {
    display: 'flex',
    alignItems: 'baseline',
    gap: `${tokens.space.sm}px`,
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box' as const,
    margin: 0,
    padding: `${tokens.space['2xs']}px ${tokens.space.sm}px`,
    border: 'none',
    borderInlineStart: `${tokens.border.selected}px solid ${$deleted ? palette.hairline : palette.accent}`,
    borderRadius: `0 ${tokens.radius.sm}px ${tokens.radius.sm}px 0`,
    background: 'none',
    textAlign: 'start' as const,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    color: palette.textSecondary,
    '& [data-author]': { flexShrink: 0, fontWeight: tokens.text.bodyStrong.weight, color: palette.text },
    '@media (hover: hover)': {
      '&:is(button):hover': { background: mix(palette.text, tintBase(palette, $on), tokens.state.hover) },
    },
  };
};

const Plain = styled('div', { shouldForwardProp: transientProps })<LookProps>(look);
const Pressable = styled('button', { shouldForwardProp: transientProps })<LookProps>((props) => ({
  ...look(props),
  cursor: 'pointer',
  outline: 'none',
  '&:focus-visible': focusRing(kitTheme(props.theme).palette, 0),
}));

const Line = styled('span', { shouldForwardProp: transientProps })<{ $deleted: boolean }>(({ $deleted }) => ({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...($deleted && { fontStyle: 'italic' }),
}));

const Hidden = styled('span')({ ...visuallyHidden });

/**
 * The message a reply answers, above the reply's words (`MessageRow`'s `quote`): the author and one line. With
 * `onOpen` it is a button that shows that message ("Reply to aiko: ok that run…"). A deleted original says so and
 * opens nothing.
 */
export function MessageQuote({ author, line: rawLine, deleted = false, onOpen }: MessageQuoteProps): JSX.Element {
  const line = stripBidiOverrides(rawLine);
  const on = useSurface();
  const tabIndex = useRowTabIndex();
  const content = (
    <>
      {!deleted && (
        <span data-author="" dir="auto">
          {author}
        </span>
      )}
      <Line dir="auto" $deleted={deleted}>
        {deleted ? DELETED_LINE : line}
      </Line>
    </>
  );
  if (onOpen === undefined || deleted) {
    return (
      <Plain $on={on} $deleted={deleted}>
        <Hidden>{deleted ? 'Reply to a deleted message' : 'Reply to'} </Hidden>
        {content}
      </Plain>
    );
  }
  return (
    <Pressable type="button" tabIndex={tabIndex} onClick={onOpen} aria-label={`Reply to ${author}: ${line}`} $on={on} $deleted={false}>
      {content}
    </Pressable>
  );
}
