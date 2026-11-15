import { useCallback, type JSX, type MouseEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Avatar } from '../display/Avatar';
import { Badge } from '../display/Badge';
import { dotStyle } from '../display/dot';
import { Tooltip } from '../overlays/Tooltip';
import { useIgnoreTooltipDescription } from '../overlays/tooltipDescription';
import { reducedMotion } from '../overlays/surface';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { transientProps } from '../theme/transientProps';
import { assignRef } from '../behaviour/assignRef';
import { rowFocusProps, type RowFocus } from '../behaviour/hosts/listFocus';

export interface DockItemProps {
  /** The community's name: the accessible name, the tooltip and where the initials come from. */
  name: string;
  src?: string;
  /** The community's own colour, `#rrggbb`. */
  colour?: string;
  /** The community you are in: an accent ring, announced as current. */
  current?: boolean;
  /** A count on the item; nothing is shown for 0. */
  unread?: number;
  /**
   * New messages that do not mention you: a small accent dot, and ", new messages" in the name. When `unread` (a
   * count) is also given, the count badge is shown and the dot is not.
   */
  newMessages?: boolean;
  /** `reconnecting`: a warning dot, and the picture dimmed. */
  status?: 'reconnecting';
  /** Renders a button. */
  onClick?: () => void;
  /** Renders a link. */
  href?: string;
  ref?: Ref<HTMLElement>;
  id?: string;
  /** Joins a keyboard list: `useListFocus(...).rowFocus(id)`. The Dock is then one Tab stop. */
  focus?: RowFocus;
}

/** The ring and the gap that separates it from the picture. The outer size always includes both. */
const RING = tokens.border.selected;

interface LookProps {
  $current: boolean;
}

/**
 * One look for the button and the link. The ring is a border that is always there (transparent when
 * not current), so becoming current moves nothing. Inside it a surface-coloured gap, then the avatar.
 */
const look = ({ theme, $current }: LookProps & { theme: Parameters<typeof kitTheme>[0] }) => {
  const { palette } = kitTheme(theme);
  return {
    ...reducedMotion,
    position: 'relative',
    flex: '0 0 auto',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${tokens.control.md + 2 * RING}px`,
    height: `${tokens.control.md + 2 * RING}px`,
    margin: 0,
    padding: `${(tokens.control.md - tokens.avatar.md) / 2}px`,
    border: `${RING}px solid ${$current ? palette.accent : 'transparent'}`,
    borderRadius: `${tokens.radius.full}px`,
    background: palette.surface,
    color: palette.text,
    font: 'inherit',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: `background-color ${tokens.motion.fast}ms`,
    ...interactiveStates({
      palette,
      under: palette.surface,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    }),
  } as const;
};

const options = { shouldForwardProp: transientProps };
const Button = styled('button', options)<LookProps>(look);
const Anchor = styled('a', options)<LookProps>(look);

const Picture = styled('span', { shouldForwardProp: transientProps })<{ $dim: boolean }>(({ $dim }) => ({
  display: 'inline-flex',
  opacity: $dim ? tokens.state.disabled : undefined,
}));

const BadgeSlot = styled('span')(({ theme }) => ({
  position: 'absolute',
  top: `${-tokens.space.xs}px`,
  right: `${-tokens.space.xs}px`,
  display: 'inline-flex',
  borderRadius: `${tokens.radius.full}px`,
  // A surface-coloured ring separates the count from the picture.
  boxShadow: `0 0 0 ${RING}px ${kitTheme(theme).palette.surface}`,
}));

/** The "new messages" dot: where the count badge would sit, in the accent colour, ringed in the surface colour. */
const NewDot = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    position: 'absolute',
    top: 0,
    right: 0,
    ...dotStyle(palette.accent),
    boxShadow: `0 0 0 ${RING}px ${palette.surface}`,
  };
});

const WarningDot = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    position: 'absolute',
    right: 0,
    bottom: 0,
    ...dotStyle(palette.warning),
    boxShadow: `0 0 0 ${RING}px ${palette.surface}`,
  };
});

/** The tooltip repeats the accessible name, so it must not describe the item with it a second time. */
function NameOnly({ children }: { children: ReactElement }): ReactElement {
  useIgnoreTooltipDescription();
  return children;
}

/**
 * A community in the Dock: a round button (or link) holding its picture. Its accessible name
 * says everything the picture shows: the name, then ", current", ", 3 unread" or
 * ", new messages", and ", reconnecting" as they apply. The name also shows in a tooltip on hover and focus.
 */
export function DockItem({
  name,
  src,
  colour,
  current = false,
  unread = 0,
  newMessages = false,
  status,
  onClick,
  href,
  ref,
  id,
  focus,
}: DockItemProps): JSX.Element {
  const count = Number.isFinite(unread) ? Math.floor(unread) : 0;
  const reconnecting = status === 'reconnecting';
  // The count wins: a dot beside a badge would say the same thing twice.
  const dot = newMessages && count <= 0;
  const roving = rowFocusProps(focus);
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
  const label = [
    name,
    current ? 'current' : undefined,
    count > 0 ? `${count} unread` : undefined,
    dot ? 'new messages' : undefined,
    reconnecting ? 'reconnecting' : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(', ');
  const ariaCurrent = current ? ('page' as const) : undefined;
  const content: ReactNode = (
    <>
      <Picture $dim={reconnecting}>
        <Avatar name={name} src={src} colour={colour} size="md" shape="circle" decorative />
      </Picture>
      {count > 0 && (
        <BadgeSlot aria-hidden="true">
          <Badge count={count} tone="danger" label={`${count} unread`} />
        </BadgeSlot>
      )}
      {dot && <NewDot aria-hidden="true" data-kit-new-messages="" />}
      {reconnecting && <WarningDot aria-hidden="true" />}
    </>
  );
  return (
    <Tooltip label={name}>
      <NameOnly>
      {href !== undefined ? (
        <Anchor
          ref={mainRef as Ref<HTMLAnchorElement>}
          id={id}
          href={href}
          tabIndex={roving?.tabIndex}
          onClick={roving?.onClick}
          aria-label={label}
          aria-current={ariaCurrent}
          $current={current}
        >
          {content}
        </Anchor>
      ) : (
        <Button
          ref={mainRef as Ref<HTMLButtonElement>}
          id={id}
          type="button"
          tabIndex={roving?.tabIndex}
          onClick={roving === undefined ? onClick : handleClick}
          aria-label={label}
          aria-current={ariaCurrent}
          $current={current}
        >
          {content}
        </Button>
      )}
      </NameOnly>
    </Tooltip>
  );
}
