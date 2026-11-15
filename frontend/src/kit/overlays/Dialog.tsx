import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { Modal, type ModalCloseReason } from './modal';
import { ModalTitle, actionsStack, gutterContainer, panelBase } from './modalParts';

export interface DialogProps {
  open: boolean;
  /**
   * Called on Escape (`'escape'`) and on a press on the scrim (`'scrim'`); the
   * parent decides whether to close. Called with no reason when the layer the
   * dialog was opened from closes: then it is already closed, and `open` should
   * follow.
   */
  onClose: (reason?: ModalCloseReason) => void;
  /** Names the dialog. */
  title: string;
  /** Describes it, for assistive technology and the eye. */
  description?: string;
  children?: ReactNode;
  /** Kit Buttons. Put the safe action first: focus starts on the first one. */
  actions: ReactNode;
  size?: 'sm' | 'md';
}

const WIDTH = { sm: tokens.layout.dialogSm, md: tokens.layout.dialogMd } as const;

const Description = styled('p')(({ theme }) => ({
  margin: `${tokens.space.sm}px 0 0`,
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.body.size}px`,
  lineHeight: `${tokens.text.body.line}px`,
  color: kitTheme(theme).palette.textSecondary,
}));

const Body = styled('div')({ marginTop: `${tokens.space.lg}px` });

const Actions = styled('div')({
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: `${tokens.space.sm}px`,
  marginTop: `${tokens.space.xl}px`,
  ...actionsStack,
});

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Moves focus to the first control in the actions row when the dialog opens. */
function Foot({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);
  return <Actions ref={ref}>{children}</Actions>;
}

/**
 * A modal dialog over a dimmed page, a layer of the overlay stack (see
 * `Modal`): the page behind is inert and does not scroll, Tab cycles inside,
 * Escape and a press on the scrim call `onClose`, and focus returns to the
 * opener.
 *
 * A Popover, Tooltip, Menu or SelectField list opened from inside render within
 * the Dialog, so its focus trap lets focus into them; Escape closes the
 * innermost layer first.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'sm',
}: DialogProps): JSX.Element {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-description` : undefined;
  return (
    <Modal
      kind="dialog"
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
      // The container is the margin: the panel stays a gutter inside the viewport.
      container={gutterContainer}
      panel={(theme) => {
        const lounge = kitTheme(theme);
        return {
          ...panelBase(lounge, shadow(lounge, 'overlay')),
          maxWidth: `${WIDTH[size]}px`,
          padding: `${tokens.space.xl}px`,
        };
      }}
    >
      <ModalTitle id={titleId}>{title}</ModalTitle>
      {description && <Description id={descriptionId}>{description}</Description>}
      {children !== undefined && <Body>{children}</Body>}
      <Foot>{actions}</Foot>
    </Modal>
  );
}
