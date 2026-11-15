import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Avatar, type AvatarSize } from './Avatar';
import { UNNAMED } from './unnamed';

export interface AvatarStackProps {
  people: { name: string; src?: string; colour?: string; speaking?: boolean }[];
  /** How many avatars to show before the "+N"; default 3. */
  max?: number;
  size?: AvatarSize;
  /** The group's accessible name; default the shown names and "and N more". */
  label?: string;
}

const DEFAULT_MAX = 3;

/** Up to three speakers by name; more are "A, B and 4 more", so the name stays short. */
const MAX_NAMED_TALKING = 3;
function joinTalking(names: string[]): string {
  return names.length <= MAX_NAMED_TALKING
    ? joinNames(names)
    : `${names.slice(0, MAX_NAMED_TALKING - 1).join(', ')} and ${names.length - (MAX_NAMED_TALKING - 1)} more`;
}

/** "A", "A and B", "A, B and C": "and" before the last, never found by searching the text for a comma. */
function joinNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface SizeProps {
  $size: AvatarSize;
  $on: Surface;
}

const Group = styled('span')({
  // A raised speaker stays inside the stack's own stacking context: it never paints over a sticky header.
  isolation: 'isolate',
  display: 'inline-flex',
  alignItems: 'center',
});

/** One avatar's slot: a ground ring around it, and the overlap onto the one before. */
const Slot = styled('span', { shouldForwardProp: transientProps })<{ $on: Surface; $speaking?: boolean }>(({ theme, $on, $speaking }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'inline-flex',
    flexShrink: 0,
    borderRadius: `${tokens.radius.full}px`,
    boxShadow: `0 0 0 ${tokens.border.selected}px ${tintBase(palette, $on)}`,
    // The speaking ring is drawn whole, over the avatar that overlaps it.
    ...($speaking && { position: 'relative', zIndex: 1 }),
    '&:not(:first-of-type)': { marginLeft: `-${tokens.space.sm}px` },
  };
});

const More = styled('span', { shouldForwardProp: transientProps })<SizeProps>(({ theme, $size, $on }) => {
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
    background: standOutFill(palette, $on),
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    whiteSpace: 'nowrap',
  };
});

/**
 * Overlapping avatars, each ringed in the colour of the layer it sits on, with the rest as a
 * "+N" circle. One accessible name for the whole group, as an `img` (a
 * `group` whose children are all hidden is skipped by some screen readers);
 * the avatars inside are decorative.
 */
export function AvatarStack({ people, max = DEFAULT_MAX, size = 'sm', label }: AvatarStackProps): JSX.Element | null {
  const on = useSurface();
  if (people.length === 0) {
    return null;
  }
  const limit = Number.isNaN(max) ? DEFAULT_MAX : Math.max(0, Math.floor(max));
  const shown = people.slice(0, limit);
  const extra = people.length - shown.length;
  const names = shown.map((person) => (person.name.trim() === '' ? UNNAMED : person.name));
  const list = joinNames(names);
  const who =
    extra === 0 ? list : names.length === 0 ? `${extra} people` : `${names.join(', ')} and ${extra} more`;
  // Everyone who is talking, also behind the "+N": the name describes the whole group.
  const talking = people
    .filter((person) => person.speaking === true)
    .map((person) => (person.name.trim() === '' ? UNNAMED : person.name));
  const summary =
    talking.length === 0
      ? who
      : `${who}, ${joinTalking(talking)} ${talking.length === 1 ? 'is' : 'are'} talking`;

  return (
    <Group role="img" aria-label={label ?? summary}>
      {shown.map(({ speaking, ...person }, index) => (
        <Slot key={index} $on={on} $speaking={speaking === true}>
          <Avatar {...person} size={size} presence={speaking === true ? 'speaking' : undefined} decorative />
        </Slot>
      ))}
      {extra > 0 && (
        <Slot $on={on}>
          <More aria-hidden="true" $size={size} $on={on}>
            +{extra}
          </More>
        </Slot>
      )}
    </Group>
  );
}
