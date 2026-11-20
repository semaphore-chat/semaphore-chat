import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { reducedMotion } from '../overlays/surface';
import { drawnReactionCount } from './reactionCount';
import { useRowTabIndex } from './rowTabScope';
import { GHOST_CLICK_MS, LONG_PRESS_MS } from './MessageRow';

export interface ReactionChipProps {
  /** The emoji as text (`😂`). For a custom emoji, give `src` and its `:name:` here as the fallback. */
  emoji: string;
  /** A custom emoji's image. */
  src?: string;
  /** What the reaction is, in words, for its name: "Laugh", "partyparrot". Read as "Laugh reaction, 4". */
  label: string;
  count: number;
  /** The reader has reacted with it: the chip is pressed (`aria-pressed`) and drawn in the accent. */
  mine?: boolean;
  /** Adds or removes the reader's reaction. */
  onToggle: () => void;
  /**
   * The reader may not react here: still focusable and named, reads as unavailable, a press does not toggle. Say
   * why with `onUnavailablePress`, as IconButton's contract.
   */
  'aria-disabled'?: boolean;
  /** Called instead of `onToggle` when an unavailable chip is pressed: say why it cannot act (`useAnnounce`). */
  onUnavailablePress?: () => void;
  /**
   * The toggle is on its way to the server: busy (`aria-busy` and `aria-disabled`, as every busy kit control),
   * presses are ignored, focus stays.
   */
  busy?: boolean;
  /**
   * Shows who reacted with it (the screen's list). Asked for by a touch long press (500 ms, cancelled if the finger
   * moves), a right-click, or the context-menu key or Shift+F10 on the chip, never by a plain press, which toggles.
   * The row's own actions do not open for these. Works on an unavailable or busy chip too.
   */
  onShowPeople?: () => void;
}

/** A finger that moves further than this before the long press fires is scrolling, not pressing. */
const LONG_PRESS_SLOP = tokens.space.sm;

interface RootProps {
  $mine: boolean;
  $on: Surface;
  $inactive: boolean;
}

const Root = styled('button', { shouldForwardProp: transientProps })<RootProps>(({ theme, $mine, $on, $inactive }) => {
  const { palette } = kitTheme(theme);
  const rest = $mine ? mix(palette.accent, tintBase(palette, $on), tokens.state.hoverOnFill) : standOutFill(palette, $on);
  const type = tokens.text.meta;
  return {
    ...reducedMotion,
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: `${tokens.space.xs}px`,
    boxSizing: 'border-box',
    height: `${tokens.control.sm}px`,
    margin: 0,
    padding: `0 ${tokens.space.md}px 0 ${tokens.space.sm}px`,
    borderRadius: `${tokens.radius.full}px`,
    // Mine is a ring as well as a tint, so it does not rest on colour alone.
    border: `${tokens.border.selected}px solid ${$mine ? palette.accent : 'transparent'}`,
    background: rest,
    color: $mine ? palette.accentText : palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    fontVariantNumeric: 'tabular-nums',
    cursor: $inactive ? 'default' : 'pointer',
    // A long press is the chip's own (who reacted), not iOS's callout.
    WebkitTouchCallout: 'none',
    transition: `background-color ${tokens.motion.fast}ms`,
    '&:focus-visible': focusRing(palette),
    ...(!$inactive && {
      '@media (hover: hover)': { '&:hover': { background: mix(palette.text, rest, tokens.state.hover) } },
      '&:active': { background: mix(palette.text, rest, tokens.state.pressed) },
    }),
    '&[aria-disabled="true"]:not([aria-busy="true"])': { opacity: tokens.state.disabled },
  };
});

const Emoji = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: `${tokens.icon.md}px`,
  lineHeight: `${tokens.icon.md}px`,
});

const EmojiImage = styled('img')({
  height: `${tokens.icon.md}px`,
  width: 'auto',
  objectFit: 'contain',
});

/**
 * One reaction under a message: the emoji and how many reacted with it. A toggle button: pressed when it is the
 * reader's. Named "Laugh reaction, 4" (and "pressed" when mine), so the emoji is never the only clue.
 */
export function ReactionChip({
  emoji,
  src,
  label,
  count,
  mine = false,
  onToggle,
  'aria-disabled': unavailable = false,
  onUnavailablePress,
  busy = false,
  onShowPeople,
}: ReactionChipProps): JSX.Element {
  const on = useSurface();
  const tabIndex = useRowTabIndex();
  const [failed, setFailed] = useState(false);
  const whole = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const inactive = unavailable || busy;
  // A held key clicks on each repeat: an unavailable chip says why once per press.
  const repeatingRef = useRef(false);
  const longPress = useLongPressPeople(onShowPeople);
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    // The click a fired long press leaves behind (iOS) is the long press's, not a toggle.
    if (longPress.swallowClick(event)) return;
    if (busy) return;
    if (unavailable) {
      if (!repeatingRef.current) onUnavailablePress?.();
      return;
    }
    onToggle();
  };
  return (
    <Root
      type="button"
      tabIndex={tabIndex}
      aria-label={`${label} reaction, ${whole}`}
      aria-pressed={mine}
      aria-disabled={inactive || undefined}
      aria-busy={busy || undefined}
      onClick={press}
      {...longPress.handlers}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        longPress.onKey();
        repeatingRef.current = event.repeat;
      }}
      onKeyUp={() => {
        repeatingRef.current = false;
      }}
      $mine={mine}
      $on={on}
      $inactive={inactive}
    >
      <Emoji aria-hidden="true">
        {src !== undefined && !failed ? <EmojiImage src={src} alt="" onError={() => setFailed(true)} /> : emoji}
      </Emoji>
      <span aria-hidden="true">{drawnReactionCount(whole)}</span>
    </Root>
  );
}

/** The long press, right-click and context-menu key that ask a chip for its people. */
function useLongPressPeople(onShowPeople: (() => void) | undefined) {
  const timer = useRef<{ id: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // Just asked: the click (iOS) or the context menu (Android) the same press leaves behind is not a new request.
  const echo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current.id);
    timer.current = null;
  };
  const endEcho = () => {
    if (echo.current !== null) clearTimeout(echo.current);
    echo.current = null;
  };
  useEffect(
    () => () => {
      cancel();
      endEcho();
    },
    [],
  );
  const fire = () => {
    cancel();
    endEcho();
    echo.current = setTimeout(() => {
      echo.current = null;
    }, GHOST_CLICK_MS);
    onShowPeople?.();
  };
  if (onShowPeople === undefined) return { handlers: {}, swallowClick: () => false, onKey: () => undefined };
  return {
    // A key press is a new press: the echo window is for the click a touch or a context menu leaves behind.
    onKey: endEcho,
    swallowClick(event: MouseEvent<HTMLButtonElement>): boolean {
      if (echo.current === null) return false;
      endEcho();
      event.preventDefault();
      return true;
    },
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        endEcho();
        if (event.pointerType !== 'touch') return;
        cancel();
        const x = event.clientX;
        const y = event.clientY;
        timer.current = { id: setTimeout(fire, LONG_PRESS_MS), x, y };
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const start = timer.current;
        if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
      },
      // A fired long press is released: its ghost click (iOS) comes within GHOST_CLICK_MS from now.
      onPointerUp: () => {
        cancel();
        if (echo.current !== null) {
          endEcho();
          echo.current = setTimeout(() => {
            echo.current = null;
          }, GHOST_CLICK_MS);
        }
      },
      onPointerCancel: cancel,
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
        // The chip's, not the row's (whose actions would open) nor the browser's.
        event.preventDefault();
        event.stopPropagation();
        // Android raises it during the long press (the timer's work, done now) or just after it fired (done already).
        if (timer.current === null && echo.current !== null) return;
        fire();
      },
    },
  };
}
