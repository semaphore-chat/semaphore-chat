import type { JSX } from 'react';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import type { AvatarSize } from './Avatar';

export type SkeletonProps =
  | { shape: 'text'; lines?: number }
  | { shape: 'circle'; size?: AvatarSize }
  | { shape: 'rect'; height?: keyof typeof tokens.control };

const pulse = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: tokens.state.disabled },
});

const Placeholder = styled('div', { shouldForwardProp: transientProps })<{
  $radius: number;
  $height: number;
  $width?: number;
}>(({ theme, $radius, $height, $width }) => ({
  boxSizing: 'border-box',
  flexShrink: 0,
  width: $width === undefined ? '100%' : `${$width}px`,
  height: `${$height}px`,
  borderRadius: `${$radius}px`,
  background: kitTheme(theme).palette.fill,
  animation: `${pulse} ${4 * tokens.motion.slow}ms ease-in-out infinite`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
}));

const Lines = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  width: '100%',
});

/** Placeholder shapes for content that is loading. Hidden from assistive technology: pair it with a named status elsewhere. */
export function Skeleton(props: SkeletonProps): JSX.Element {
  if (props.shape === 'circle') {
    const size = tokens.avatar[props.size ?? 'md'];
    return <Placeholder aria-hidden="true" $radius={tokens.radius.full} $height={size} $width={size} />;
  }
  if (props.shape === 'rect') {
    return (
      <Placeholder
        aria-hidden="true"
        $radius={tokens.radius.card}
        $height={tokens.control[props.height ?? 'lg']}
      />
    );
  }
  const count = Math.max(1, Math.floor(props.lines ?? 1));
  return (
    <Lines aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Placeholder key={index} $radius={tokens.radius.sm} $height={tokens.text.body.line} />
      ))}
    </Lines>
  );
}
