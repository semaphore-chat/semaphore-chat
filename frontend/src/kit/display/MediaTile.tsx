import type { JSX, Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext, standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Avatar } from './Avatar';
import { SPEAKING_ATTRIBUTE, speakingRing } from './speaking';

export interface MediaTileProps {
  /** Whose tile or what it shows: the accessible name, the caption, and where an avatar tile's initials come from. */
  label: string;
  /** `screen` shows a shared screen whole; `camera` fills the box; `avatar` is the picture of someone with no video. */
  kind: 'screen' | 'camera' | 'avatar';
  /** Someone is talking: the speaking ring, and ", speaking" in the name. */
  speaking?: boolean;
  /**
   * Gives the caller the `<video>` element of a `screen` or `camera` tile, to attach a stream to. A video
   * element is drawn only when this is set (and never for `avatar`).
   */
  videoRef?: Ref<HTMLVideoElement>;
}

/** The shape of video: width to height. */
const RATIO = '16 / 9';

const Root = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface; $speaking: boolean }>(
  ({ theme, $on, $speaking }) => {
    const { palette } = kitTheme(theme);
    return {
      position: 'relative',
      boxSizing: 'border-box',
      width: '100%',
      aspectRatio: RATIO,
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

/** What shows without video: the avatar (for `avatar`) and the label, centred. */
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
});

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

const CentreLabel = styled('span')(({ theme }) => labelStyle(theme));

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
  return (
    <Root
      role="group"
      aria-label={speaking ? `${label}, speaking` : label}
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
              <Caption>{label}</Caption>
            </>
          ) : (
            <Centre>
              {kind === 'avatar' && <Avatar name={label} size="xl" decorative />}
              <CentreLabel>{label}</CentreLabel>
            </Centre>
          )}
        </SurfaceContext>
      </Frame>
    </Root>
  );
}
