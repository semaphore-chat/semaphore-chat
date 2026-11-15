import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import MuiDialog from '@mui/material/Dialog';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { fadeTransition, reducedMotion } from './surface';

export interface DialogProps {
  open: boolean;
  /** Called on Escape and on a press on the scrim; the parent decides whether to close. */
  onClose: () => void;
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

const Title = styled('h2')(({ theme }) => {
  const type = tokens.text.title;
  return {
    margin: 0,
    fontFamily: `'${type.family}', ${theme.typography.fontFamily}`,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    color: kitTheme(theme).palette.text,
  };
});

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
  // At phone width the buttons take a full row each, in order: the safe action on top.
  [`@media (max-width: ${tokens.breakpoint.phone}px)`]: {
    flexDirection: 'column',
    '& > *': { width: '100%' },
  },
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
 * A modal dialog over a dimmed page. MUI's Dialog supplies the behaviour: the
 * page behind is inert and does not scroll, Tab cycles inside, Escape and a
 * press on the scrim call `onClose`, and focus returns to the opener.
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
    <MuiDialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth={false}
      transitionDuration={tokens.motion.base}
      {...fadeTransition}
      sx={{
        // The container is the margin: the panel stays a gutter inside the viewport.
        '& .MuiDialog-container': {
          boxSizing: 'border-box',
          padding: `${tokens.layout.gutter}px`,
          ...reducedMotion,
        },
      }}
      slotProps={{
        backdrop: {
          sx: (theme) => ({ background: kitTheme(theme).palette.scrim, ...reducedMotion }),
        },
        paper: {
          sx: (theme) => {
            const lounge = kitTheme(theme);
            return {
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: `${WIDTH[size]}px`,
              margin: 0,
              padding: `${tokens.space.xl}px`,
              background: lounge.palette.surface,
              backgroundImage: 'none',
              borderRadius: `${tokens.radius.island}px`,
              border: `${tokens.border.hairline}px solid ${lounge.palette.hairline}`,
              boxShadow: shadow(lounge, 'overlay'),
              color: lounge.palette.text,
            };
          },
        },
      }}
    >
      <Title id={titleId}>{title}</Title>
      {description && <Description id={descriptionId}>{description}</Description>}
      {children !== undefined && <Body>{children}</Body>}
      <Foot>{actions}</Foot>
    </MuiDialog>
  );
}
