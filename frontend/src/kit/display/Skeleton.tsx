import type { JSX } from 'react';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import type { AvatarSize } from './Avatar';

export type SkeletonProps =
  | { shape: 'text'; lines?: number }
  | { shape: 'circle'; size?: AvatarSize }
  | { shape: 'rect'; height?: keyof typeof tokens.control };

/** Most text lines a skeleton draws; anything above (or not a number) is clamped. */
const MAX_LINES = 20;

const pulse = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: tokens.state.disabled },
});

const Placeholder = styled('div', { shouldForwardProp: transientProps })<{
  $radius: number;
  $height: number;
  $width?: number;
  $on: Surface;
}>(({ theme, $radius, $height, $width, $on }) => ({
  boxSizing: 'border-box',
  flexShrink: 0,
  width: $width === undefined ? '100%' : `${$width}px`,
  height: `${$height}px`,
  borderRadius: `${$radius}px`,
  background: standOutFill(kitTheme(theme).palette, $on),
  animation: `${pulse} ${4 * tokens.motion.slow}ms ease-in-out infinite`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
}));

const Lines = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
});

/** One line of text's height, so the placeholder is as tall as the text that replaces it; the bar sits inset in it. */
const LineSlot = styled('div')({
  display: 'flex',
  alignItems: 'center',
  height: `${tokens.text.body.line}px`,
});

/** Placeholder shapes for content that is loading. Hidden from assistive technology: pair it with a named status elsewhere. */
export function Skeleton(props: SkeletonProps): JSX.Element {
  const on = useSurface();
  if (props.shape === 'circle') {
    const size = tokens.avatar[props.size ?? 'md'];
    return <Placeholder aria-hidden="true" $radius={tokens.radius.full} $height={size} $width={size} $on={on} />;
  }
  if (props.shape === 'rect') {
    return (
      <Placeholder
        aria-hidden="true"
        $radius={tokens.radius.card}
        $height={tokens.control[props.height ?? 'lg']}
        $on={on}
      />
    );
  }
  const requested = props.lines ?? 1;
  const count = Number.isFinite(requested) ? Math.min(MAX_LINES, Math.max(1, Math.floor(requested))) : requested > 0 ? MAX_LINES : 1;
  return (
    <Lines aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <LineSlot key={index}>
          <Placeholder $radius={tokens.radius.sm} $height={tokens.text.body.line - 2 * tokens.space.xs} $on={on} />
        </LineSlot>
      ))}
    </Lines>
  );
}
