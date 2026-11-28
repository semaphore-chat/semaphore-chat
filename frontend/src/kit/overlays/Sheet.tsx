import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { IconButton } from '../controls/IconButton';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { transientProps } from '../theme/transientProps';
import { Modal, type SheetCloseReason } from './modal';
import { ModalTitle, PHONE, SAFE_BOTTOM, actionsStack, gutterContainer, panelBase } from './modalParts';

export interface SheetProps {
  open: boolean;
  /**
   * Called on Escape (`'escape'`), on a press on the scrim (`'scrim'`) and on the
   * Close button (`'button'`); the parent decides whether to close.
   * `'parentClosed'`: the layer the sheet was opened from closed, so it has
   * closed already; set `open` false.
   */
  onClose: (reason: SheetCloseReason) => void;
  /** Names the sheet. */
  title: string;
  children: ReactNode;
  /**
   * Content fixed under the title, above the scrolling body: an instance heading, a search field that filters the
   * body. It does not scroll with the body.
   */
  top?: ReactNode;
  /** Kit Buttons in a row pinned to the bottom. */
  actions?: ReactNode;
  size?: 'md' | 'lg';
  /**
   * Where focus returns when the sheet closes, whatever has focus as it opens: for a sheet opened from inside another
   * layer that closes at the same moment (focus would otherwise return into the gone layer). Default: what had focus.
   */
  opener?: HTMLElement | null;
  /**
   * The content brings its own header (with a Close that calls `onClose`), its own scrolling and its own padding: a
   * thread with its list and composer. No title row (the title still names the sheet for screen readers), no
   * padded body, and the panel takes the full height it is allowed. `top` and `actions` are not drawn.
   */
  fill?: boolean;
  /** Called once the closing transition has finished: until then the content stays as it was. */
  onExited?: () => void;
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

/** A filling sheet's body: the content sizes itself to the panel and scrolls itself. */
const FillBody = styled('div')({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  [PHONE]: { paddingBottom: SAFE_BOTTOM },
});

/** Names a filling sheet, which has no visible title row. */
const HiddenTitle = styled('h2')({
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
});

const Top = styled('div')({
  flex: '0 0 auto',
  minWidth: 0,
  padding: `0 ${tokens.space.xl}px ${tokens.space.md}px`,
});

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
function Head({ titleId, title, onClose, focusClose }: { titleId: string; title: string; onClose: (reason: SheetCloseReason) => void; focusClose: boolean }): JSX.Element {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusClose) {
      close.current?.focus();
    }
  }, [focusClose]);
  return (
    <Header>
      <ModalTitle id={titleId}>{title}</ModalTitle>
      <IconButton ref={close} icon="X" label="Close" onClick={() => onClose('button')} />
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
export function Sheet({ open, onClose, title, children, top, actions, size = 'md', opener, fill = false, onExited }: SheetProps): JSX.Element {
  const titleId = `${useId()}-title`;
  return (
    <Modal
      kind="sheet"
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      opener={opener}
      onExited={onExited}
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
          ...(fill && { height: '100%' }),
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
      {fill ? (
        <>
          <HiddenTitle id={titleId}>{title}</HiddenTitle>
          <FillBody data-kit-sheet-body="">{children}</FillBody>
        </>
      ) : (
        <>
          <Head titleId={titleId} title={title} onClose={onClose} focusClose={actions === undefined} />
          {top !== undefined && <Top>{top}</Top>}
          <Body $last={actions === undefined} data-kit-sheet-body="">
            {children}
          </Body>
          {actions !== undefined && <Actions>{actions}</Actions>}
        </>
      )}
    </Modal>
  );
}
