import { useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import MuiMenu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { styled, type Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { LiveRegionSlot } from '../behaviour/hosts/LiveRegionSlot';
import { useOverlayLayer } from '../behaviour/hosts/overlay';
import { Icon } from '../display/Icon';
import { KeyCap } from '../display/KeyCap';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { useOverlayContainer } from './overlayContainer';
import {
  ANCHOR_GAP,
  fadeTransition,
  menuItemStyle,
  overlaySurface,
  placementOrigins,
  reducedMotion,
  type Placement,
} from './surface';

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: IconName;
      /** Keys shown at the right, one KeyCap each: `['Shift', 'D']`. */
      shortcut?: string[];
      tone?: 'default' | 'danger';
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; divider: true };

export interface MenuProps {
  open: boolean;
  /** The element the menu opens from; focus returns to whatever had it when the menu opened. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Names the menu for assistive technology. */
  label: string;
  items: MenuEntry[];
  placement?: Placement;
}

const Item = styled(MenuItem, {
  shouldForwardProp: transientProps,
})<{ $danger: boolean }>(({ theme, $danger }) => {
  const { palette } = kitTheme(theme);
  return {
    ...menuItemStyle(kitTheme(theme)),
    ...($danger && { color: palette.danger }),
    '& > .icon': {
      display: 'inline-flex',
      color: $danger ? palette.danger : palette.textSecondary,
    },
  };
});

const Keys = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: `${tokens.space['2xs']}px`,
  marginLeft: `${tokens.space.lg}px`,
});

const Line = styled('li')(({ theme }) => ({
  listStyle: 'none',
  height: `${tokens.border.hairline}px`,
  margin: `${tokens.space.xs}px 0`,
  background: kitTheme(theme).palette.hairline,
}));

/** MUI's MenuList gives focus to its first child that does not set this flag; a divider must never get it. */
function Divider(): JSX.Element {
  return <Line role="separator" />;
}
Divider.muiSkipListHighlight = true;

const paperSx = (theme: Theme) => ({
  ...overlaySurface(kitTheme(theme)),
  ...reducedMotion,
});

const listSx = { padding: `${tokens.space.xs}px` };

/**
 * A menu of actions that opens from an `anchor`, a layer of the overlay stack.
 * The stack decides when it closes (Escape, a press outside, Tab) and where
 * focus goes after (back to whatever had it when the menu opened). MUI's Menu
 * draws it, keeps the press outside from reaching the page (its invisible
 * backdrop), and supplies the list keys: focus moves to the first item, the
 * arrows, Home, End and typing a letter move it, a disabled item is skipped.
 * Choosing an item calls `onSelect`, then `onClose`.
 */
export function Menu({ open, anchor, onClose, label, items, placement = 'bottom-start' }: MenuProps): JSX.Element {
  const { anchorOrigin, transformOrigin } = placementOrigins(placement);
  const gap = placement.startsWith('bottom') ? ANCHOR_GAP : -ANCHOR_GAP;
  // Inside a Dialog the menu renders in the Dialog, where its focus trap lets focus in.
  const container = useOverlayContainer();
  // The menu's modal root: its live-region slot goes there, outside the list MUI manages.
  const [modalRoot, setModalRoot] = useState<HTMLElement | null>(null);
  const paper = useRef<HTMLDivElement>(null);
  const { forcedClosed } = useOverlayLayer({
    kind: 'menu',
    open,
    panel: paper,
    // Safari does not focus a clicked button: then focus returns to the anchor.
    fallbackOpener: anchor,
    onRequestClose: () => onClose(),
  });
  const shown = open && !forcedClosed;
  return (
    // A portal: reset to the menu's own layer, whatever it was opened from.
    <SurfaceContext value="surface">
    <MuiMenu
      open={shown}
      anchorEl={anchor}
      container={container}
      // No onClose: MUI's reasons (escapeKeyDown, backdropClick, tabKeyDown) are not ours to act on.
      disableEscapeKeyDown
      disableRestoreFocus
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      marginThreshold={tokens.layout.gutter}
      transitionDuration={tokens.motion.fast}
      {...fadeTransition}
      slotProps={{
        root: { ref: setModalRoot },
        paper: { sx: [paperSx, { marginTop: `${gap}px` }], ref: paper },
        list: { 'aria-label': label, sx: listSx },
      }}
    >
      {items.map((entry) => {
        if ('divider' in entry) {
          return <Divider key={entry.id} />;
        }
        const danger = entry.tone === 'danger';
        return (
          <Item
            key={entry.id}
            $danger={danger}
            disabled={entry.disabled}
            // MUI relies on CSS pointer-events to keep a disabled item from
            // being chosen; an assistive technology's synthetic click skips CSS.
            onClick={() => {
              if (entry.disabled) {
                return;
              }
              entry.onSelect();
              onClose();
            }}
          >
            {entry.icon !== undefined && (
              <span className="icon">
                <Icon name={entry.icon} size="md" />
              </span>
            )}
            <span className="label">{entry.label}</span>
            {entry.shortcut !== undefined && (
              <Keys>
                {entry.shortcut.map((key) => (
                  <KeyCap key={key}>{key}</KeyCap>
                ))}
              </Keys>
            )}
          </Item>
        );
      })}
    </MuiMenu>
    {modalRoot !== null && createPortal(<LiveRegionSlot scope="layer" active={shown} />, modalRoot)}
    </SurfaceContext>
  );
}
