import { useCallback, useLayoutEffect, useRef, type JSX, type MouseEvent, type ReactNode, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { TooltipDescriptionContext } from '../overlays/tooltipDescription';
import { reducedMotion } from '../overlays/surface';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { SurfaceContext, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import {
  ROW_ATTRIBUTE,
  restoreTrailingTabOrder,
  rowFocusProps,
  takeTrailingOutOfTabOrder,
  TRAILING_ATTRIBUTE,
  type RowFocus,
} from '../behaviour/hosts/listFocus';

export interface ListRowProps {
  primary: string;
  secondary?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** `md` is one line (control md high); `lg` has room for two. */
  size?: 'md' | 'lg';
  /** The current item: the solid accent pill. Sets `aria-current`. */
  selected?: boolean;
  /** Bolder primary line, in the full text colour. */
  unread?: boolean;
  /** Both lines dimmed. */
  muted?: boolean;
  disabled?: boolean;
  /** Renders a link. */
  href?: string;
  /** Renders a button. */
  onClick?: () => void;
  ref?: Ref<HTMLElement>;
  id?: string;
  /**
   * Joins a keyboard list: `useListFocus(...).rowFocus(id)`. The row becomes one stop of the list's
   * roving Tab stop, and the controls in `trailing` leave the Tab order (Right and Left reach them).
   */
  focus?: RowFocus;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

interface LookProps {
  $size: 'md' | 'lg';
  $selected: boolean;
  $interactive: boolean;
  $disabled: boolean;
  $on: Surface;
}

/**
 * The whole row: background, hover and selection live here so a trailing slot sits inside the pill.
 * It is a stacking context (`zIndex: 0`) so the link or button's stretched layer can sit behind the
 * text yet above this background.
 */
const Wrapper = styled('div', { shouldForwardProp: transientProps })<LookProps>(
  ({ theme, $size, $selected, $interactive, $disabled, $on }) => {
    const { palette } = kitTheme(theme);
    const under = $selected ? palette.accent : tintBase(palette, $on);
    return {
      ...reducedMotion,
      position: 'relative',
      zIndex: 0,
      display: 'flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
      gap: `${tokens.space.sm}px`,
      minHeight: `${$size === 'md' ? tokens.control.md : tokens.control.lg}px`,
      padding: `0 ${tokens.space.md}px 0 ${tokens.space.xs}px`,
      borderRadius: `${$size === 'md' ? tokens.radius.full : tokens.radius.card}px`,
      background: $selected ? palette.accent : 'transparent',
      color: $selected ? palette.onAccent : palette.textSecondary,
      transition: `background-color ${tokens.motion.fast}ms`,
      // Hover is the row's. Pressed and the focus ring belong to the link or button (see `mainStyle`):
      // pressing a trailing control must not show the row as pressed.
      ...($interactive &&
        !$disabled && {
          '@media (hover: hover)': {
            '&:hover': {
              background: mix(
                palette.text,
                under,
                $selected ? tokens.state.hoverOnFill : tokens.state.hover,
              ),
            },
          },
        }),
      ...($disabled && { opacity: tokens.state.disabled }),
    };
  },
);

const mainStyle = (theme: Parameters<typeof kitTheme>[0], interactive: boolean, on: Surface) => {
  const { palette } = kitTheme(theme);
  // Pressed tint over the row's own colour. Selected is on the accent pill: its pressed tint is the on-fill one.
  const pressed = (selected: boolean) =>
    mix(palette.text, selected ? palette.accent : tintBase(palette, on), selected ? tokens.state.pressedOnFill : tokens.state.pressed);
  return {
    display: 'flex',
    alignItems: 'center',
    flex: '1 1 auto',
    minWidth: 0,
    alignSelf: 'stretch',
    gap: `${tokens.space.sm}px`,
    boxSizing: 'border-box',
    margin: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    borderRadius: 'inherit',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    textDecoration: 'none',
    cursor: interactive ? 'pointer' : 'default',
    '&:focus-visible': { outline: 'none' },
    '&:disabled, &[aria-disabled="true"]': { cursor: 'default' },
    // The stretched layer: it covers the whole row (padding, gaps and all), so a press anywhere on the
    // row is a press on this link or button. It sits behind the row's text (`zIndex: -1` inside the
    // wrapper's stacking context) and behind the trailing slot, which is positioned above it. It also
    // carries the pressed tint and the focus ring, so both outline the whole pill.
    ...(interactive && {
      '&::after': {
        content: '""',
        position: 'absolute',
        inset: 0,
        zIndex: -1,
        borderRadius: 'inherit',
      },
      '&:active::after': { background: pressed(false) },
      '&[aria-current]:active::after': { background: pressed(true) },
      '&:focus-visible::after': focusRing(palette, -tokens.border.focus),
      // On the accent pill a ring in the focus colour does not show (they are the same hue), and an outer ring
      // is clipped by a scrolling list. So a selected row's ring is the on-accent ink, a ring's width further in.
      '&[aria-current]:focus-visible::after': {
        ...focusRing(palette, -2 * tokens.border.focus),
        outlineColor: palette.onAccent,
      },
      '&:disabled::after, &[aria-disabled="true"]::after': { display: 'none' },
    }),
  } as const;
};

const mainOptions = { shouldForwardProp: transientProps };
const Anchor = styled('a', mainOptions)<{ $on: Surface }>(({ theme, $on }) => mainStyle(theme, true, $on));
const Button = styled('button', mainOptions)<{ $on: Surface }>(({ theme, $on }) => mainStyle(theme, true, $on));
const Plain = styled('div', mainOptions)<{ $on: Surface }>(({ theme, $on }) => mainStyle(theme, false, $on));

const Leading = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  // Keeps the text column aligned whether the slot holds an icon or an avatar.
  minWidth: `${tokens.avatar.sm}px`,
});

const Trailing = styled('span')({
  // Above the row's stretched layer, so its own controls take their own presses.
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  gap: `${tokens.space.xs}px`,
});

const Column = styled('span')({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
});

interface LineProps {
  $weight: number;
  $type: 'body' | 'meta';
  $tone: 'row' | 'strong' | 'dim';
}

const Line = styled('span', { shouldForwardProp: transientProps })<LineProps>(
  ({ theme, $type, $weight, $tone }) => {
    const { palette } = kitTheme(theme);
    const style = tokens.text[$type];
    return {
      display: 'block',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontFamily: theme.typography.fontFamily,
      fontSize: `${style.size}px`,
      lineHeight: `${style.line}px`,
      fontWeight: $weight,
      // `row` takes the row's own colour: secondary text, or the on-accent ink when selected.
      color: $tone === 'dim' ? palette.textDim : $tone === 'strong' ? palette.text : 'inherit',
    };
  },
);

/**
 * A row in a list of channels, people or places. A link with `href`, a button
 * with `onClick`, plain content with neither; the whole row is the hit area.
 * `trailing` sits beside the link or button, never inside it, so it can hold
 * its own buttons. `selected` is the solid accent pill.
 */
export function ListRow({
  primary,
  secondary,
  leading,
  trailing,
  size = 'md',
  selected = false,
  unread = false,
  muted = false,
  disabled = false,
  href,
  onClick,
  ref,
  id,
  focus,
}: ListRowProps): JSX.Element {
  const on = useSurface();
  // Only a link or a button joins a keyboard list: a plain row is not interactive, so `focus` is ignored there.
  const roving = href !== undefined || onClick !== undefined ? rowFocusProps(focus) : undefined;
  const rovingOn = roving !== undefined;
  const hasTrailing = trailing !== undefined;
  const trailingRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const slot = trailingRef.current;
    if (!rovingOn || slot === null) return undefined;
    takeTrailingOutOfTabOrder(slot);
    // A control can mount in the slot, or remount through its own state, without this row rendering again.
    if (typeof MutationObserver === 'undefined') return () => restoreTrailingTabOrder(slot);
    const observer = new MutationObserver(() => takeTrailingOutOfTabOrder(slot));
    observer.observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'] });
    return () => {
      observer.disconnect();
      restoreTrailingTabOrder(slot);
    };
  }, [rovingOn, hasTrailing]);
  const rovingRef = roving?.ref;
  // Stable, so neither the caller's ref nor the list's is detached and attached again on every render.
  const mainRef = useCallback(
    (element: HTMLElement | null) => {
      assignRef(ref, element);
      rovingRef?.(element);
    },
    [ref, rovingRef],
  );
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    roving?.onClick(event);
    onClick?.();
  };
  // A disabled row gets no tabindex: it stays out of reach of the mouse and the keyboard, as before.
  const focusProps = roving === undefined || disabled ? {} : { tabIndex: roving.tabIndex };
  const current = selected ? (href !== undefined ? 'page' : 'true') : undefined;
  // Selected keeps the on-accent ink whatever else is set.
  const tone = (dim: boolean, strong: boolean): 'row' | 'strong' | 'dim' =>
    selected ? 'row' : dim ? 'dim' : strong ? 'strong' : 'row';
  const interactive = href !== undefined || onClick !== undefined;

  const content = (
    <>
      {leading !== undefined && <Leading>{leading}</Leading>}
      <Column>
        <Line
          $type="body"
          $weight={unread ? tokens.text.bodyStrong.weight : tokens.text.body.weight}
          $tone={tone(muted, unread && !selected)}
        >
          {primary}
        </Line>
        {secondary !== undefined && (
          <Line $type="meta" $weight={tokens.text.meta.weight} $tone={tone(muted, false)}>
            {secondary}
          </Line>
        )}
      </Column>
    </>
  );

  let main: JSX.Element;
  if (href !== undefined && !disabled) {
    main = (
      <Anchor
        ref={mainRef}
        id={id}
        href={href}
        aria-current={current}
        $on={on}
        {...focusProps}
        onClick={roving === undefined ? undefined : roving.onClick}
      >
        {content}
      </Anchor>
    );
  } else if (href !== undefined) {
    // A disabled link has no destination: not focusable, not navigable.
    main = (
      <Anchor
        ref={mainRef}
        id={id}
        role="link"
        aria-disabled="true"
        aria-current={current}
        $on={on}
        {...focusProps}
        onClick={(event: MouseEvent) => event.preventDefault()}
      >
        {content}
      </Anchor>
    );
  } else if (onClick !== undefined) {
    main = (
      <Button
        ref={mainRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-current={current}
        $on={on}
        {...focusProps}
        onClick={roving === undefined ? onClick : handleClick}
      >
        {content}
      </Button>
    );
  } else {
    main = (
      <Plain
        ref={mainRef}
        id={id}
        aria-current={current}
        $on={on}
        {...focusProps}
        onClick={roving === undefined ? undefined : roving.onClick}
      >
        {content}
      </Plain>
    );
  }

  return (
    <Wrapper
      $size={size}
      $selected={selected}
      $interactive={interactive}
      $disabled={disabled}
      $on={on}
      {...(roving !== undefined && { [ROW_ATTRIBUTE]: '' })}
    >
      {/* A selected row is the accent pill; an unselected one keeps the layer around it. */}
      <SurfaceContext value={selected ? 'accent' : on}>
        {main}
        {trailing !== undefined && (
          // A Tooltip around the row describes its link or button, not a control in the slot.
          <TooltipDescriptionContext value={null}>
            <Trailing ref={trailingRef} {...(roving !== undefined && { [TRAILING_ATTRIBUTE]: '' })}>
              {trailing}
            </Trailing>
          </TooltipDescriptionContext>
        )}
      </SurfaceContext>
    </Wrapper>
  );
}
