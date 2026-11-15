import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext, standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Avatar, type AvatarSize } from './Avatar';
import { UNNAMED } from './unnamed';
import { SPEAKING_ATTRIBUTE, speakingRing } from './speaking';

export interface MediaTileProps {
  /** Whose tile or what it shows: the accessible name, the caption, and where an avatar tile's initials come from. */
  label: string;
  /** `screen` shows a shared screen whole; `camera` fills the box; `avatar` is the picture of someone with no video. */
  kind: 'screen' | 'camera' | 'avatar';
  /** Someone is talking: the speaking ring, and ", speaking" in the name. */
  speaking?: boolean;
  /**
   * A callback ref for the tile's `<video>` element (a `screen` or `camera` tile): called with the element when it
   * is drawn and with `null` when it goes. The element is drawn only while this is set, and never for `avatar`, and
   * it is replaced whenever `kind` crosses `avatar`, this is set or unset, or the tile remounts: attach the stream
   * in the callback, detach on `null`. (A ref object would not be told about the new element.)
   */
  videoRef?: (element: HTMLVideoElement | null) => void;
}

/** The shape of video: width to height. */
const RATIO = '16 / 9';

/** What the centred avatar, gap and label take (`space.md` padding each side, `space.sm` between, one meta line). */
const stackHeight = (avatar: AvatarSize, padding: number) =>
  2 * padding + tokens.avatar[avatar] + tokens.space.sm + tokens.text.meta.line;
/** The tile width at which a 16:9 box is as high as that stack. */
const widthFor = (height: number) => Math.ceil((height * 16) / 9);
/** Tile widths (container query breakpoints): below the first the avatar steps down, then the padding, then the label goes. */
const FITS_XL = widthFor(stackHeight('xl', tokens.space.md));
const FITS_LG = widthFor(stackHeight('lg', tokens.space.md));
const FITS_MD = widthFor(stackHeight('md', tokens.space.sm));

const Root = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface; $speaking: boolean }>(
  ({ theme, $on, $speaking }) => {
    const { palette } = kitTheme(theme);
    return {
      position: 'relative',
      boxSizing: 'border-box',
      width: '100%',
      aspectRatio: RATIO,
      // The avatar tile fits its contents to the tile's own width (see FITS_*).
      containerType: 'inline-size',
      borderRadius: `${tokens.radius.card}px`,
      ...($speaking && { boxShadow: speakingRing(palette, tintBase(palette, $on)) }),
    };
  },
);

/** Clips the picture to the rounded corners; the ring on the root is not clipped. */
const Frame = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  return {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    borderRadius: 'inherit',
    background: standOutFill(palette, $on),
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
  };
});

const Video = styled('video', { shouldForwardProp: transientProps })<{ $contain: boolean }>(({ $contain }) => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  // A shared screen is shown whole; a camera fills the box.
  objectFit: $contain ? 'contain' : 'cover',
}));

/** What shows without video: the avatar (for `avatar`) and the label, centred. Padding steps down in a small tile. */
const Centre = styled('div')({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: `${tokens.space.sm}px`,
  padding: `${tokens.space.md}px`,
  minWidth: 0,
  [`@container (max-width: ${FITS_LG - 1}px)`]: { padding: `${tokens.space.sm}px` },
});

/**
 * One avatar per step, one shown: xl, then lg, then md as the tile narrows. (CSS cannot change an Avatar's size,
 * so each is drawn and the others are `display: none`: hidden ones are also out of the accessibility tree.)
 */
const AvatarStep = styled('span', { shouldForwardProp: transientProps })<{ $step: 'xl' | 'lg' | 'md' }>(({ $step }) => ({
  display: $step === 'xl' ? 'inline-flex' : 'none',
  [`@container (max-width: ${FITS_XL - 1}px)`]: { display: $step === 'lg' ? 'inline-flex' : 'none' },
  [`@container (max-width: ${FITS_LG - 1}px)`]: { display: $step === 'md' ? 'inline-flex' : 'none' },
}));

const labelStyle = (theme: Parameters<typeof kitTheme>[0]) => ({
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.meta.size}px`,
  lineHeight: `${tokens.text.meta.line}px`,
  fontWeight: tokens.text.bodyStrong.weight,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
});

/** Below FITS_MD the label no longer fits beside the avatar: it goes (the group's name still carries it). */
const CentreLabel = styled('span')(({ theme }) => ({
  ...labelStyle(theme),
  [`@container (max-width: ${FITS_MD - 1}px)`]: { display: 'none' },
}));

/** Over video the label sits on its own opaque chip, so it reads on any picture. */
const Caption = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    ...labelStyle(theme),
    position: 'absolute',
    left: `${tokens.space.sm}px`,
    bottom: `${tokens.space.sm}px`,
    maxWidth: `calc(100% - ${2 * tokens.space.sm}px)`,
    boxSizing: 'border-box',
    padding: `0 ${tokens.space.sm}px`,
    borderRadius: `${tokens.radius.sm}px`,
    background: palette.surface,
    color: palette.text,
  };
});

/**
 * A 16:9 rounded box for one participant's video, shared screen or avatar. The tile is one group named
 * by `label` (and ", speaking"); the video inside is picture only. With no video it shows the label, and
 * for `avatar` a kit Avatar above it.
 */
export function MediaTile({ label, kind, speaking = false, videoRef }: MediaTileProps): JSX.Element {
  const on = useSurface();
  const hasVideo = kind !== 'avatar' && videoRef !== undefined;
  const name = label.trim() === '' ? UNNAMED : label;
  return (
    <Root
      role="group"
      aria-label={speaking ? `${name}, speaking` : name}
      {...(speaking && { [SPEAKING_ATTRIBUTE]: '' })}
      $on={on}
      $speaking={speaking}
    >
      <Frame $on={on}>
        {/* The frame is the stand-out fill of its layer; what is drawn on it (the avatar) sits one layer over. */}
        <SurfaceContext value={on === 'fill' ? 'surface' : 'fill'}>
          {hasVideo ? (
            <>
              <Video ref={videoRef} autoPlay muted playsInline aria-hidden="true" $contain={kind === 'screen'} />
              <Caption aria-hidden="true">{label}</Caption>
            </>
          ) : (
            <Centre>
              {kind === 'avatar' && (
                <>
                  <AvatarStep $step="xl">
                    <Avatar name={name} size="xl" decorative />
                  </AvatarStep>
                  <AvatarStep $step="lg">
                    <Avatar name={name} size="lg" decorative />
                  </AvatarStep>
                  <AvatarStep $step="md">
                    <Avatar name={name} size="md" decorative />
                  </AvatarStep>
                </>
              )}
              <CentreLabel aria-hidden="true">{label}</CentreLabel>
            </Centre>
          )}
        </SurfaceContext>
      </Frame>
    </Root>
  );
}
