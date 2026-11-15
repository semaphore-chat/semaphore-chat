import { useState, type JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { readableBackground } from '../theme/readable';
import { transientProps } from '../theme/transientProps';
import { Icon, type IconSize } from './Icon';

export type AvatarSize = keyof typeof tokens.avatar;
export type Presence = 'online' | 'away' | 'offline' | 'speaking';

export interface AvatarProps {
  /** Who it is: the accessible name, and where the initials come from. */
  name: string;
  src?: string;
  /** A person's or community's own colour, `#rrggbb`. */
  colour?: string;
  size?: AvatarSize;
  /** `circle` for people, `rounded` for communities. */
  shape?: 'circle' | 'rounded';
  presence?: Presence;
  /** Hides it from assistive technology, for an avatar beside its own name. */
  decorative?: boolean;
}

/** Name used when the name is blank, so the avatar is never an unlabelled image. */
const UNNAMED = 'Unknown user';

const ICON_FOR_SIZE: Record<AvatarSize, IconSize> = { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' };

/** The slice of `Intl.Segmenter` used here; the project's TS lib predates it. */
interface GraphemeSegmenter {
  segment(text: string): Iterable<{ segment: string }>;
}
const IntlWithSegmenter = Intl as unknown as {
  Segmenter?: new (locale: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
};
const segmenter = IntlWithSegmenter.Segmenter
  ? new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function graphemes(text: string): string[] {
  return segmenter === null ? Array.from(text) : Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * The letters an avatar shows: the first letter of the first two words, or the
 * first two letters of a single word, upper-cased. Counted in graphemes, so an
 * accented letter, a CJK character or an emoji is one. Blank gives ''.
 */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== '');
  const letters =
    words.length >= 2
      ? [graphemes(words[0])[0], graphemes(words[1])[0]]
      : graphemes(words[0] ?? '').slice(0, 2);
  return letters.join('').toLocaleUpperCase();
}

/** The face's type: tag for the small sizes, meta semibold for the middle, section for the largest. */
function typeFor(size: AvatarSize) {
  if (size === 'xs' || size === 'sm') {
    return tokens.text.tag;
  }
  if (size === 'xl') {
    return tokens.text.section;
  }
  return { ...tokens.text.meta, weight: 600 };
}

function radiusFor(shape: 'circle' | 'rounded', size: AvatarSize): number {
  if (shape === 'circle') {
    return tokens.radius.full;
  }
  return size === 'xl' ? tokens.radius.card : tokens.radius.md;
}

interface RootProps {
  $size: AvatarSize;
  $radius: number;
  $speaking: boolean;
}

const Root = styled('span', { shouldForwardProp: transientProps })<RootProps>(
  ({ theme, $size, $radius, $speaking }) => {
    const { palette } = kitTheme(theme);
    const gap = tokens.border.selected;
    return {
      position: 'relative',
      display: 'inline-flex',
      flexShrink: 0,
      boxSizing: 'border-box',
      width: `${tokens.avatar[$size]}px`,
      height: `${tokens.avatar[$size]}px`,
      borderRadius: `${$radius}px`,
      // A ground-coloured gap, then the ring: a shadow, so the box never grows.
      ...($speaking && {
        boxShadow: `0 0 0 ${gap}px ${palette.ground}, 0 0 0 ${gap * 2}px ${palette.positive}`,
      }),
    };
  },
);

interface FaceProps {
  $size: AvatarSize;
  /** The person's own colour, when they have one. */
  $colour: string | undefined;
}

const Face = styled('span', { shouldForwardProp: transientProps })<FaceProps>(
  ({ theme, $size, $colour }) => {
    const { palette } = kitTheme(theme);
    const type = typeFor($size);
    // The person's colour, nudged in lightness only as far as the initials need.
    const own = $colour === undefined ? null : readableBackground($colour, [palette.ground, palette.text]);
    return {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      borderRadius: 'inherit',
      background: own?.background ?? palette.fill,
      color: own?.ink ?? palette.textSecondary,
      fontFamily: `'${type.family}', ${theme.typography.fontFamily}`,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: type.weight,
      whiteSpace: 'nowrap',
      userSelect: 'none',
    };
  },
);

const Photo = styled('img')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

interface DotProps {
  $size: AvatarSize;
  $presence: Exclude<Presence, 'speaking'>;
}

const Dot = styled('span', { shouldForwardProp: transientProps })<DotProps>(
  ({ theme, $size, $presence }) => {
    const { palette } = kitTheme(theme);
    const colours = { online: palette.positive, away: palette.warning, offline: palette.textDim };
    const diameter = $size === 'xs' ? tokens.space.sm : tokens.space.md;
    const outset = `-${tokens.border.hairline}px`;
    return {
      position: 'absolute',
      right: outset,
      bottom: outset,
      boxSizing: 'border-box',
      width: `${diameter}px`,
      height: `${diameter}px`,
      borderRadius: `${tokens.radius.full}px`,
      background: colours[$presence],
      border: `${tokens.border.selected}px solid ${palette.ground}`,
    };
  },
);

/**
 * A person's or community's picture: an image over their initials, which
 * stay underneath so a missing or broken image never shifts the layout.
 * Initials on a data colour take whichever of the page and text colours
 * contrasts more. Named `name` (plus the presence) unless `decorative`.
 */
export function Avatar({
  name,
  src,
  colour,
  size = 'md',
  shape = 'circle',
  presence,
  decorative = false,
}: AvatarProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const showPhoto = src !== undefined && src !== '' && failedSrc !== src;

  const initials = initialsOf(name);
  const label = `${name.trim() === '' ? UNNAMED : name}${presence ? `, ${presence}` : ''}`;
  const accessibility = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': label };

  return (
    <Root
      {...accessibility}
      $size={size}
      $radius={radiusFor(shape, size)}
      $speaking={presence === 'speaking'}
    >
      <Face $size={size} $colour={colour}>
        {initials === '' ? <Icon name="User" size={ICON_FOR_SIZE[size]} /> : initials}
        {showPhoto && <Photo src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} />}
      </Face>
      {presence !== undefined && presence !== 'speaking' && (
        <Dot aria-hidden="true" $size={size} $presence={presence} />
      )}
    </Root>
  );
}
