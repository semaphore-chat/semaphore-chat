import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { IconButton } from '../controls/IconButton';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { transientProps } from '../theme/transientProps';
import { Modal } from './modal';
import { ModalTitle, PHONE, SAFE_BOTTOM, actionsStack, gutterContainer, panelBase } from './modalParts';

export interface SheetProps {
  open: boolean;
  /** Called on Escape, on a press on the scrim and on the Close button; the parent decides whether to close. */
  onClose: () => void;
  /** Names the sheet. */
  title: string;
  children: ReactNode;
  /** Kit Buttons in a row pinned to the bottom. */
  actions?: ReactNode;
  size?: 'md' | 'lg';
}

const WIDTH = { md: tokens.layout.dialogMd, lg: 2 * tokens.layout.dialogSm } as const;

const slideUp = keyframes({ from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } });

const Header = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: `${tokens.space.md}px`,
  padding: `${tokens.space.lg}px ${tokens.space.lg}px ${tokens.space.md}px ${tokens.space.xl}px`,
});

const Body = styled('div', { shouldForwardProp: transientProps })<{ $last: boolean }>(({ $last }) => ({
  flex: '1 1 auto',
  minHeight: 0,
  padding: `${tokens.space.xs}px ${tokens.space.xl}px ${tokens.space.xl}px`,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  // With no actions row the body is the last row: it clears the home indicator on a phone.
  ...($last && { [PHONE]: { paddingBottom: `calc(${tokens.space.xl}px + ${SAFE_BOTTOM})` } }),
}));

const Actions = styled('div')(({ theme }) => ({
  flex: '0 0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: `${tokens.space.sm}px`,
  padding: `${tokens.space.md}px ${tokens.space.xl}px`,
  borderTop: `${tokens.border.hairline}px solid ${kitTheme(theme).palette.hairline}`,
  ...actionsStack,
  // The actions row is the last row: it clears the home indicator on a phone.
  [PHONE]: { paddingBottom: `calc(${tokens.space.md}px + ${SAFE_BOTTOM})` },
}));

/** The title and Close. With no actions row, Close takes focus when the sheet opens (the panel is not a control). */
function Head({ titleId, title, onClose, focusClose }: { titleId: string; title: string; onClose: () => void; focusClose: boolean }): JSX.Element {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusClose) {
      close.current?.focus();
    }
  }, [focusClose]);
  return (
    <Header>
      <ModalTitle id={titleId}>{title}</ModalTitle>
      <IconButton ref={close} icon="X" label="Close" onClick={onClose} />
    </Header>
  );
}

/**
 * A modal panel over a dimmed page, for content that is more than a question: a
 * list of communities, a settings pane. It behaves like a Dialog (the page behind is
 * inert, focus moves in and is trapped, Escape and the scrim close it, focus returns;
 * layers opened from inside render within it) and shares its internals.
 *
 * The header (title and Close) and the optional actions row stay put; the body scrolls.
 * Above the phone breakpoint it is a centred panel; at or below it, a bottom sheet
 * that is full width, rounded on top, and slides up.
 */
export function Sheet({ open, onClose, title, children, actions, size = 'md' }: SheetProps): JSX.Element {
  const titleId = `${useId()}-title`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      container={{
        ...gutterContainer,
        [PHONE]: { padding: 0, alignItems: 'flex-end' },
      }}
      panel={(theme) => {
        const lounge = kitTheme(theme);
        return {
          ...panelBase(lounge, shadow(lounge, 'overlay')),
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxWidth: `${WIDTH[size]}px`,
          [PHONE]: {
            maxWidth: '100%',
            // The room the dock takes stays free below the bar's top edge.
            maxHeight: `calc(100% - ${tokens.layout.dock}px)`,
            borderRadius: `${tokens.radius.island}px ${tokens.radius.island}px 0 0`,
            borderBottom: 'none',
            animation: `${slideUp} ${tokens.motion.base}ms ease-out`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          },
        };
      }}
    >
      <Head titleId={titleId} title={title} onClose={onClose} focusClose={actions === undefined} />
      <Body $last={actions === undefined}>{children}</Body>
      {actions !== undefined && <Actions>{actions}</Actions>}
    </Modal>
  );
}
