import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Button } from '../controls/Button';
import { BUTTON_PADDING } from '../controls/buttonPadding';
import { IconButton } from '../controls/IconButton';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { Icon, type IconTone } from './Icon';
import { liveRole } from './live';

export type AlertSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  severity: AlertSeverity;
  title?: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
  /**
   * Speak when it appears (default). Pass `false` for an alert that is already
   * on the page when it loads, so a screen reader does not read it out on every
   * visit; it is then a quiet `note`.
   */
  announce?: boolean;
}

const LOOK: Record<AlertSeverity, { icon: IconName; tone: IconTone }> = {
  info: { icon: 'Info', tone: 'accent' },
  success: { icon: 'CircleCheck', tone: 'positive' },
  warning: { icon: 'TriangleAlert', tone: 'warning' },
  danger: { icon: 'CircleAlert', tone: 'danger' },
};

const Root = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'flex-start',
    gap: `${tokens.space.md}px`,
    width: '100%',
    padding: `${tokens.space.lg}px`,
    borderRadius: `${tokens.radius.card}px`,
    background: palette.fill,
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

const ActionRow = styled('div')({
  display: 'flex',
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
export function Alert({ severity, title, children, action, onClose, announce = true }: AlertProps): JSX.Element {
  const look = LOOK[severity];
  return (
    <Root role={liveRole(severity === 'warning' || severity === 'danger', announce)}>
      <IconSlot>
        <Icon name={look.icon} size="lg" tone={look.tone} />
      </IconSlot>
      <Body>
        {title !== undefined && <Title>{title}</Title>}
        <div>{children}</div>
        {action && (
          <ActionRow>
            <Button variant="text" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
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
