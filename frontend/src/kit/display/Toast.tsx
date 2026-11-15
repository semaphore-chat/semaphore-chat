import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { Icon, type IconTone } from './Icon';
import { liveRole } from './live';

export type ToastTone = 'neutral' | 'positive' | 'danger';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
  /** Speak when it appears (default). `false` makes it a quiet `note`, for a notice already on the page at load. */
  announce?: boolean;
}

const MARK: Partial<Record<ToastTone, { icon: IconName; tone: IconTone }>> = {
  positive: { icon: 'CircleCheck', tone: 'positive' },
  danger: { icon: 'CircleAlert', tone: 'danger' },
};

const Root = styled('div')(({ theme }) => {
  const lounge = kitTheme(theme);
  const { palette } = lounge;
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.md}px`,
    maxWidth: '100%',
    padding: `${tokens.space.md}px ${tokens.space.lg}px`,
    border: `${tokens.border.hairline}px solid ${palette.hairline}`,
    borderRadius: `${tokens.radius.card}px`,
    background: palette.surface,
    color: palette.text,
    boxShadow: shadow(lounge, 'overlay'),
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
  };
});

const Message = styled('span')({
  flex: '1 1 0',
  minWidth: 0,
  overflowWrap: 'anywhere',
});

const Fixed = styled('span')({
  display: 'inline-flex',
  flexShrink: 0,
});

/**
 * One floating notice. Presentational only: where it appears, how long it
 * stays and how notices queue belong to the behaviour layer.
 */
export function Toast({ message, tone = 'neutral', action, onClose, announce = true }: ToastProps): JSX.Element {
  const mark = MARK[tone];
  return (
    <Root role={liveRole(tone === 'danger', announce)}>
      {mark && (
        <Fixed>
          <Icon name={mark.icon} size="lg" tone={mark.tone} />
        </Fixed>
      )}
      <Message>{message}</Message>
      {action && (
        <Fixed>
          <Button variant="text" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </Fixed>
      )}
      {onClose && (
        <Fixed>
          <IconButton icon="X" label="Dismiss" size="sm" onClick={onClose} />
        </Fixed>
      )}
    </Root>
  );
}
