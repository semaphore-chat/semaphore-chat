import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Button } from '../controls/Button';
import { BUTTON_PADDING } from '../controls/buttonPadding';
import { IconButton } from '../controls/IconButton';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Icon, type IconTone } from './Icon';
import { liveRole } from './live';

export type AlertSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  severity: AlertSeverity;
  title?: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  /** A second action beside `action`, for a choice (Join and Decline). It is not a dismiss: use `onClose` for that. */
  secondaryAction?: { label: string; onClick: () => void };
  onClose?: () => void;
  /**
   * Speak when it appears (default). Pass `false` for an alert that is already
   * on the page when it loads, so a screen reader does not read it out on every
   * visit; it is then a quiet `note`.
   */
  announce?: boolean;
  /**
   * One line (the banner row while a phone's on-screen keyboard is up): the title and the text run on one line and
   * are cut with an ellipsis; the actions and Dismiss stay beside them. The whole text stays in the alert for screen
   * readers.
   */
  oneLine?: boolean;
}

const LOOK: Record<AlertSeverity, { icon: IconName; tone: IconTone }> = {
  info: { icon: 'Info', tone: 'accent' },
  success: { icon: 'CircleCheck', tone: 'positive' },
  warning: { icon: 'TriangleAlert', tone: 'warning' },
  danger: { icon: 'CircleAlert', tone: 'danger' },
};

const Root = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface; $oneLine: boolean }>(({ theme, $on, $oneLine }) => {
  const { palette } = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: $oneLine ? 'center' : 'flex-start',
    gap: `${tokens.space.md}px`,
    width: '100%',
    padding: $oneLine ? `${tokens.space.sm}px ${tokens.space.md}px` : `${tokens.space.lg}px`,
    borderRadius: `${tokens.radius.card}px`,
    background: standOutFill(palette, $on),
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
  };
});

/** Keeps the icon on the first line of text whatever the line height. */
const IconSlot = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  height: `${tokens.text.body.line}px`,
});

const Body = styled('div')({
  flex: '1 1 0',
  minWidth: 0,
  overflowWrap: 'anywhere',
});

const Title = styled('div')({
  fontWeight: tokens.text.bodyStrong.weight,
});

/** One line: the title and the text side by side, cut with an ellipsis; the actions after them, never wrapped. */
const OneLineBody = styled('div')({
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.sm}px`,
});

const OneLineText = styled('span')({
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const OneLineTitle = styled('span')({
  fontWeight: tokens.text.bodyStrong.weight,
});

const OneLineActions = styled('span')({
  display: 'inline-flex',
  flexShrink: 0,
  gap: `${tokens.space.xs}px`,
});

const ActionRow = styled('div')({
  display: 'flex',
  // Wraps at a narrow width instead of overflowing; the rows of buttons stay close.
  flexWrap: 'wrap',
  gap: `${tokens.space.xs}px ${tokens.space.sm}px`,
  // The text button has its own side padding: pull it back so its label lines up with the text above.
  margin: `${tokens.space.sm}px 0 0 ${-BUTTON_PADDING.sm}px`,
});

/** What a small icon button has around its icon: (control - icon) / 2 on each side. */
const CLOSE_INSET = (tokens.control.sm - tokens.icon.sm) / 2;

/**
 * The close button is `control.sm` tall: pull it up so its centre meets the
 * first line of text, and right by the space around its icon so the icon
 * (not the button box) sits on the padding edge.
 */
const CloseSlot = styled('span')({
  flexShrink: 0,
  marginTop: `${-(tokens.control.sm - tokens.text.body.line) / 2}px`,
  marginRight: `${-CLOSE_INSET}px`,
});

/** An inline message banner. Warnings and errors interrupt (`alert`); info and success wait (`status`); `announce={false}` makes it a quiet `note`. */
export function Alert({ severity, title, children, action, secondaryAction, onClose, announce = true, oneLine = false }: AlertProps): JSX.Element {
  const look = LOOK[severity];
  const on = useSurface();
  const actions = [action, secondaryAction].filter((a): a is { label: string; onClick: () => void } => a !== undefined);
  if (oneLine) {
    return (
      <Root $on={on} $oneLine role={liveRole(severity === 'warning' || severity === 'danger', announce)} data-kit-alert-one-line="">
        <IconSlot>
          <Icon name={look.icon} size="lg" tone={look.tone} />
        </IconSlot>
        <OneLineBody>
          <OneLineText>
            {title !== undefined && <OneLineTitle>{`${title} `}</OneLineTitle>}
            {children}
          </OneLineText>
          {actions.length > 0 && (
            <OneLineActions>
              {actions.map((a) => (
                <Button key={a.label} variant="text" size="sm" onClick={a.onClick}>
                  {a.label}
                </Button>
              ))}
            </OneLineActions>
          )}
        </OneLineBody>
        {onClose && <IconButton icon="X" label="Dismiss" size="sm" onClick={onClose} />}
      </Root>
    );
  }
  return (
    <Root $on={on} $oneLine={false} role={liveRole(severity === 'warning' || severity === 'danger', announce)}>
      <IconSlot>
        <Icon name={look.icon} size="lg" tone={look.tone} />
      </IconSlot>
      <Body>
        {title !== undefined && <Title>{title}</Title>}
        <div>{children}</div>
        {(action || secondaryAction) && (
          <ActionRow>
            {action && (
              <Button variant="text" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button variant="text" size="sm" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )}
          </ActionRow>
        )}
      </Body>
      {onClose && (
        <CloseSlot>
          <IconButton icon="X" label="Dismiss" size="sm" onClick={onClose} />
        </CloseSlot>
      )}
    </Root>
  );
}
