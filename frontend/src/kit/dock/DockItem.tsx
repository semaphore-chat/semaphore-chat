import type { JSX, ReactNode, Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Avatar } from '../display/Avatar';
import { Badge } from '../display/Badge';
import { dotStyle } from '../display/dot';
import { Tooltip } from '../overlays/Tooltip';
import { useDescribedBy } from '../overlays/tooltipDescription';
import { reducedMotion } from '../overlays/surface';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { transientProps } from '../theme/transientProps';

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
  /** `reconnecting`: a warning dot, and the picture dimmed. */
  status?: 'reconnecting';
  /** Renders a button. */
  onClick?: () => void;
  /** Renders a link. */
  href?: string;
  ref?: Ref<HTMLElement>;
  id?: string;
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

/**
 * A community in the Dock: a round button (or link) holding its picture. Its accessible name
 * says everything the picture shows: the name, then ", current", ", 3 unread" and
 * ", reconnecting" as they apply. The name also shows in a tooltip on hover and focus.
 */
export function DockItem({
  name,
  src,
  colour,
  current = false,
  unread = 0,
  status,
  onClick,
  href,
  ref,
  id,
}: DockItemProps): JSX.Element {
  const describedBy = useDescribedBy(undefined);
  const count = Number.isNaN(unread) ? 0 : Math.floor(unread);
  const reconnecting = status === 'reconnecting';
  const label = [
    name,
    current ? 'current' : undefined,
    count > 0 ? `${count} unread` : undefined,
    reconnecting ? 'reconnecting' : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(', ');
  const ariaCurrent = current ? ('page' as const) : undefined;
  const content: ReactNode = (
    <>
      <Picture data-dock-avatar="" $dim={reconnecting}>
        <Avatar name={name} src={src} colour={colour} size="md" shape="circle" decorative />
      </Picture>
      {count > 0 && (
        <BadgeSlot aria-hidden="true">
          <Badge count={count} tone="danger" label={`${count} unread`} />
        </BadgeSlot>
      )}
      {reconnecting && <WarningDot aria-hidden="true" />}
    </>
  );
  return (
    <Tooltip label={name}>
      {href !== undefined ? (
        <Anchor
          ref={ref as Ref<HTMLAnchorElement>}
          id={id}
          href={href}
          aria-label={label}
          aria-current={ariaCurrent}
          aria-describedby={describedBy}
          $current={current}
        >
          {content}
        </Anchor>
      ) : (
        <Button
          ref={ref as Ref<HTMLButtonElement>}
          id={id}
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={ariaCurrent}
          aria-describedby={describedBy}
          $current={current}
        >
          {content}
        </Button>
      )}
    </Tooltip>
  );
}
