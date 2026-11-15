import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { Icon, type IconTone } from './Icon';

export type AlertSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  severity: AlertSeverity;
  title?: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
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
  margin: `${tokens.space.sm}px 0 0 ${-tokens.space.md}px`,
});

/** The close button is 32 tall; pull it up so its icon lines up with the first line of text. */
const CloseSlot = styled('span')({
  flexShrink: 0,
  marginTop: `${-(tokens.control.sm - tokens.text.body.line) / 2}px`,
  marginRight: `${-tokens.space.sm}px`,
});

/** An inline message banner. Warnings and errors interrupt (`alert`); info and success wait (`status`). */
export function Alert({ severity, title, children, action, onClose }: AlertProps): JSX.Element {
  const look = LOOK[severity];
  return (
    <Root role={severity === 'warning' || severity === 'danger' ? 'alert' : 'status'}>
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
