import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { transientProps } from '../theme/transientProps';
import { reducedMotion } from '../overlays/surface';
import { shadow } from '../theme/shadow';
import { Icon } from '../display/Icon';
import { Spinner } from '../display/Spinner';

export interface JumpToLatestProps {
  onJump: () => void;
  /** Messages that arrived while the reader was away from the bottom. Shown as "N new" (above 99, "99+ new"). */
  newCount?: number;
  /** The jump is loading the latest messages: busy, presses ignored, focus stays. */
  busy?: boolean;
}

/** Above this, the count reads "99+", as a Badge does. */
const MAX_COUNT = 99;

const Place = styled('div')({
  // Floats over the bottom of the list it belongs to: the list region is its positioned container.
  position: 'absolute',
  insetInline: 0,
  bottom: `${tokens.space.lg}px`,
  zIndex: 1,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
});

const Root = styled('button', { shouldForwardProp: transientProps })<{ $busy: boolean; $count: boolean }>(
  ({ theme, $busy, $count }) => {
    const lounge = kitTheme(theme);
    const { palette } = lounge;
    const rest = $count ? palette.accent : palette.surface;
    const type = tokens.text.bodyStrong;
    return {
      ...reducedMotion,
      pointerEvents: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      gap: `${tokens.space.sm}px`,
      boxSizing: 'border-box',
      maxWidth: `calc(100% - ${2 * tokens.space.lg}px)`,
      height: `${tokens.control.md}px`,
      margin: 0,
      padding: `0 ${tokens.space.lg}px 0 ${tokens.space.md}px`,
      borderRadius: `${tokens.radius.full}px`,
      border: $count ? 'none' : `${tokens.border.hairline}px solid ${palette.hairline}`,
      background: rest,
      color: $count ? palette.onAccent : palette.text,
      boxShadow: shadow(lounge, 'island'),
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: type.weight,
      whiteSpace: 'nowrap',
      cursor: $busy ? 'default' : 'pointer',
      transition: `background-color ${tokens.motion.fast}ms`,
      '&:focus-visible': focusRing(palette),
      ...(!$busy && {
        '@media (hover: hover)': {
          '&:hover': { background: mix(palette.text, rest, $count ? tokens.state.hoverOnFill : tokens.state.hover) },
        },
        '&:active': { background: mix(palette.text, rest, $count ? tokens.state.pressedOnFill : tokens.state.pressed) },
      }),
    };
  },
);

const Label = styled('span')({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

/**
 * The floating "Jump to latest" control over a message list, shown while the reader is scrolled away from the
 * newest message. With `newCount` it says how many arrived meanwhile ("3 new") in the accent. It places itself
 * centred above the bottom edge of its positioned container (the list region), over the rows.
 */
export function JumpToLatest({ onJump, newCount, busy = false }: JumpToLatestProps): JSX.Element {
  const count = newCount !== undefined && Number.isFinite(newCount) ? Math.max(0, Math.floor(newCount)) : 0;
  const drawn = count > MAX_COUNT ? `${MAX_COUNT}+` : String(count);
  const text = count > 0 ? `${drawn} new` : 'Jump to latest';
  const name = count > 0 ? `Jump to latest, ${drawn} new ${count === 1 ? 'message' : 'messages'}` : 'Jump to latest';
  return (
    <Place>
      <Root
        type="button"
        aria-label={name}
        aria-busy={busy || undefined}
        onClick={busy ? undefined : onJump}
        $busy={busy}
        $count={count > 0}
      >
        {busy ? <Spinner size="md" /> : <Icon name="ChevronDown" size="md" />}
        <Label aria-hidden="true">{text}</Label>
      </Root>
    </Place>
  );
}
