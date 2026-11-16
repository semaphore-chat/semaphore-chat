import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { Avatar } from '../display/Avatar';
import { Icon } from '../display/Icon';
import { Spinner } from '../display/Spinner';
import type { IconName } from '../icons/generated';
import { overlaySurface } from '../overlays/surface';

export interface Suggestion {
  /** A stable key. */
  key: string;
  /** What is inserted, as read: "aiko", "here". */
  label: string;
  /** A second, quieter line: the display name, "Notify online members in this channel", "4 members". */
  detail?: string;
  /** A person: their avatar (picture or initials from `label`). */
  avatar?: { src?: string; colour?: string };
  /** Anything else (a group, `@here`): an icon in the avatar's place. */
  icon?: IconName;
}

export interface SuggestionListProps {
  /** The listbox's id: the composer's `popup.listId`. */
  id: string;
  /** Names the list: "Mention suggestions". */
  label: string;
  options: readonly Suggestion[];
  /** The highlighted option (moved with ↑/↓ in the field), or -1. */
  activeIndex: number;
  /** Each option's element id: the composer's `popup.activeId` for the highlighted one. */
  optionId: (index: number) => string;
  /** An option was pressed. */
  onPick: (index: number) => void;
  /** The options are still loading: a spinner row, "Loading…". */
  loading?: boolean;
}

const MAX_SHOWN = 6;

const Root = styled('div')(({ theme }) => {
  const lounge = kitTheme(theme);
  return {
    ...overlaySurface(lounge),
    boxSizing: 'border-box',
    // About six rows, then it scrolls: the conversation keeps most of a phone's height.
    maxHeight: `${MAX_SHOWN * tokens.control.lg + 2 * tokens.space.xs}px`,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: `${tokens.space.xs}px`,
    margin: 0,
    listStyle: 'none',
  };
});

const Option = styled('li')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.sm}px`,
    minWidth: 0,
    boxSizing: 'border-box',
    minHeight: `${tokens.control.lg}px`,
    padding: `0 ${tokens.space.md}px`,
    borderRadius: `${tokens.radius.md}px`,
    cursor: 'pointer',
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
    '@media (hover: hover)': { '&:hover': { background: mix(palette.text, palette.surface, tokens.state.hover) } },
    '&[aria-selected="true"]': { background: mix(palette.accent, palette.surface, tokens.state.pressed) },
  };
});

const Words = styled('span')({ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' });

const Line = styled('span')({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

const Detail = styled(Line)(({ theme }) => ({
  fontSize: `${tokens.text.small.size}px`,
  lineHeight: `${tokens.text.small.line}px`,
  color: kitTheme(theme).palette.textSecondary,
}));

const IconBox = styled('span')({
  flex: `0 0 ${tokens.avatar.sm}px`,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: `${tokens.avatar.sm}px`,
  height: `${tokens.avatar.sm}px`,
});

/**
 * The suggestions of a composer while the reader types a mention (`Composer`'s `suggestions`): a listbox the field
 * drives as a combobox. Focus never leaves the field: ↑/↓ move the highlight (`activeIndex`, read through the
 * field's `aria-activedescendant`), Enter or Tab picks, Escape closes, all handled by the screen in the field's
 * keys. A press on an option picks it without taking focus from the field (the keyboard stays up on a phone).
 */
export function SuggestionList({
  id,
  label,
  options,
  activeIndex,
  optionId,
  onPick,
  loading = false,
}: SuggestionListProps): JSX.Element {
  return (
    <Root as="ul" id={id} role="listbox" aria-label={label} aria-busy={loading || undefined}>
      {loading && options.length === 0 ? (
        <Option as="li" role="option" aria-selected={false} aria-disabled>
          <IconBox>
            <Spinner size="sm" />
          </IconBox>
          <Words>
            <Line>Loading…</Line>
          </Words>
        </Option>
      ) : (
        options.map((option, index) => (
          <Option
            key={option.key}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            // Keep focus (and the on-screen keyboard) in the field.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(index)}
          >
            <IconBox aria-hidden="true">
              {option.avatar !== undefined ? (
                <Avatar decorative name={option.label} src={option.avatar.src} colour={option.avatar.colour} size="sm" />
              ) : (
                <Icon name={option.icon ?? 'AtSign'} size="sm" tone="secondary" />
              )}
            </IconBox>
            <Words>
              <Line dir="auto">{option.label}</Line>
              {option.detail !== undefined && <Detail dir="auto">{option.detail}</Detail>}
            </Words>
          </Option>
        ))
      )}
    </Root>
  );
}
