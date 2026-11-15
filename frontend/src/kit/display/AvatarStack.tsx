import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { Avatar, type AvatarSize } from './Avatar';
import { UNNAMED } from './unnamed';

export interface AvatarStackProps {
  people: { name: string; src?: string; colour?: string }[];
  /** How many avatars to show before the "+N"; default 3. */
  max?: number;
  size?: AvatarSize;
  /** The group's accessible name; default the shown names and "and N more". */
  label?: string;
}

const DEFAULT_MAX = 3;

interface SizeProps {
  $size: AvatarSize;
}

const Group = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
});

/** One avatar's slot: a ground ring around it, and the overlap onto the one before. */
const Slot = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'inline-flex',
    flexShrink: 0,
    borderRadius: `${tokens.radius.full}px`,
    boxShadow: `0 0 0 ${tokens.border.selected}px ${palette.ground}`,
    '&:not(:first-of-type)': { marginLeft: `-${tokens.space.sm}px` },
  };
});

const More = styled('span', { shouldForwardProp: transientProps })<SizeProps>(({ theme, $size }) => {
  const { palette } = kitTheme(theme);
  const type = $size === 'xs' || $size === 'sm' ? tokens.text.tag : tokens.text.meta;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    width: `${tokens.avatar[$size]}px`,
    height: `${tokens.avatar[$size]}px`,
    borderRadius: `${tokens.radius.full}px`,
    background: palette.fill,
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    whiteSpace: 'nowrap',
  };
});

/**
 * Overlapping avatars, each ringed in the page colour, with the rest as a
 * "+N" circle. One accessible name for the whole group, as an `img` (a
 * `group` whose children are all hidden is skipped by some screen readers);
 * the avatars inside are decorative.
 */
export function AvatarStack({ people, max = DEFAULT_MAX, size = 'sm', label }: AvatarStackProps): JSX.Element | null {
  if (people.length === 0) {
    return null;
  }
  const limit = Number.isNaN(max) ? DEFAULT_MAX : Math.max(0, Math.floor(max));
  const shown = people.slice(0, limit);
  const extra = people.length - shown.length;
  const names = shown.map((person) => (person.name.trim() === '' ? UNNAMED : person.name));
  // "A", "A and B", "A, B and C": "and" before the last, never found by searching the text for a comma.
  const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const summary =
    extra === 0 ? list : names.length === 0 ? `${extra} people` : `${names.join(', ')} and ${extra} more`;

  return (
    <Group role="img" aria-label={label ?? summary}>
      {shown.map((person, index) => (
        <Slot key={index}>
          <Avatar {...person} size={size} decorative />
        </Slot>
      ))}
      {extra > 0 && (
        <Slot>
          <More aria-hidden="true" $size={size}>
            +{extra}
          </More>
        </Slot>
      )}
    </Group>
  );
}
