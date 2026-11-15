import { useState, type JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { readableBackground } from '../theme/readable';
import { transientProps } from '../theme/transientProps';
import { Icon, type IconSize } from './Icon';
import { UNNAMED } from './unnamed';

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

/** A grapheme that can stand as an initial: starts with a letter, a number or a pictograph. */
const INITIAL = /^[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/** Upper-case one grapheme, keeping it as written if that would make it longer (`ß` is not `SS`). */
function upper(grapheme: string): string {
  const cased = grapheme.toLocaleUpperCase();
  return graphemes(cased).length === 1 ? cased : grapheme;
}

/**
 * The letters an avatar shows: the first letter of the first two words, or the
 * first two letters of a single word, upper-cased. Counted in graphemes, so an
 * accented letter, a CJK character or an emoji is one. Punctuation and symbols
 * are skipped (`(mike)` is "MI"), and a word with no letter is not a word.
 * Nothing left gives ''.
 */
function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => graphemes(word).filter((grapheme) => INITIAL.test(grapheme)))
    .filter((letters) => letters.length > 0);
  const letters = words.length >= 2 ? [words[0][0], words[1][0]] : (words[0] ?? []).slice(0, 2);
  return letters.map(upper).join('');
}

/** The face's type: tag for the small sizes, meta semibold for the middle, section for the largest. */
function typeFor(size: AvatarSize) {
  if (size === 'xs' || size === 'sm') {
    return tokens.text.tag;
  }
  if (size === 'xl') {
    return tokens.text.section;
  }
  return { ...tokens.text.meta, weight: tokens.text.bodyStrong.weight };
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
  $on: Surface;
}

const Root = styled('span', { shouldForwardProp: transientProps })<RootProps>(
  ({ theme, $size, $radius, $speaking, $on }) => {
    const { palette } = kitTheme(theme);
    const gap = tokens.border.selected;
    const behind = tintBase(palette, $on);
    return {
      position: 'relative',
      display: 'inline-flex',
      flexShrink: 0,
      boxSizing: 'border-box',
      width: `${tokens.avatar[$size]}px`,
      height: `${tokens.avatar[$size]}px`,
      borderRadius: `${$radius}px`,
      // A gap in the colour of the layer it sits on, then the ring: a shadow, so the box never grows.
      ...($speaking && {
        boxShadow: `0 0 0 ${gap}px ${behind}, 0 0 0 ${gap * 2}px ${palette.positive}`,
      }),
    };
  },
);

interface FaceProps {
  $size: AvatarSize;
  /** The image has loaded: the initials stay in the layout but are no longer painted, so a transparent image shows no letters. */
  $covered: boolean;
  /** The person's own colour, when they have one. */
  $colour: string | undefined;
  $on: Surface;
}

const Face = styled('span', { shouldForwardProp: transientProps })<FaceProps>(
  ({ theme, $size, $colour, $covered, $on }) => {
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
      background: own?.background ?? standOutFill(palette, $on),
      color: $covered ? 'transparent' : (own?.ink ?? palette.textSecondary),
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
  $on: Surface;
}

/**
 * Presence by shape as well as colour: online a filled dot, away a filled dot
 * with a bar across it, offline a hollow ring. A ground-coloured ring
 * (outside the dot, a shadow) separates it from the avatar.
 */
const Dot = styled('span', { shouldForwardProp: transientProps })<DotProps>(
  ({ theme, $size, $presence, $on }) => {
    const { palette } = kitTheme(theme);
    const diameter = $size === 'xs' ? tokens.space.sm : tokens.space.md;
    const outset = `-${tokens.border.hairline}px`;
    const offline = $presence === 'offline';
    const behind = tintBase(palette, $on);
    return {
      position: 'absolute',
      right: outset,
      bottom: outset,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      width: `${diameter}px`,
      height: `${diameter}px`,
      borderRadius: `${tokens.radius.full}px`,
      background: offline ? behind : $presence === 'online' ? palette.positive : palette.warning,
      border: offline ? `${tokens.border.selected}px solid ${palette.textDim}` : 'none',
      boxShadow: `0 0 0 ${tokens.border.selected}px ${behind}`,
    };
  },
);

/** Away's bar: the dot's width less a ring on each side, as high as a ring is thick, in the ground colour. */
const AwayBar = styled('span', { shouldForwardProp: transientProps })<{ $size: AvatarSize; $on: Surface }>(
  ({ theme, $size, $on }) => {
    const { palette } = kitTheme(theme);
    const diameter = $size === 'xs' ? tokens.space.sm : tokens.space.md;
    return {
      width: `${diameter - 2 * tokens.border.selected}px`,
      height: `${tokens.border.selected}px`,
      background: tintBase(palette, $on),
    };
  },
);

/**
 * A person's or community's picture: an image over their initials, which
 * stay underneath so a missing or broken image never shifts the layout (once
 * the image has loaded they stop being painted, so a transparent logo shows
 * no letters).
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
  const on = useSurface();
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
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
      $on={on}
    >
      <Face $size={size} $colour={colour} $covered={showPhoto && loadedSrc === src} $on={on}>
        {initials === '' ? <Icon name="User" size={ICON_FOR_SIZE[size]} /> : initials}
        {showPhoto && (
          <Photo
            src={src}
            alt=""
            draggable={false}
            onLoad={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
          />
        )}
      </Face>
      {presence !== undefined && presence !== 'speaking' && (
        <Dot aria-hidden="true" data-presence={presence} $size={size} $presence={presence} $on={on}>
          {presence === 'away' && <AwayBar data-presence-bar="" $size={size} $on={on} />}
        </Dot>
      )}
    </Root>
  );
}
