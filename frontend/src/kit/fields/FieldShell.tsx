import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { Text } from '../typography/Text';
import { FieldLabelText } from './fieldLabel';
import { visuallyHidden } from '../theme/a11y';
import { transientProps } from '../theme/transientProps';

export interface FieldShellProps {
  label: string;
  /** Hides the label visually; it still names the field. */
  labelHidden?: boolean;
  required?: boolean;
  helper?: string;
  error?: string;
  disabled?: boolean;
  /** The id of the control the label points at. */
  controlId: string;
  labelId: string;
  messageId: string;
  /**
   * For a control a `<label for>` cannot reach (MUI's select is a div, not a
   * labelable element): the label then has no `for` and runs this on click.
   */
  onLabelClick?: () => void;
  /** Receives what the control needs to wire itself to the label and the message. */
  children: (wiring: FieldWiring) => ReactNode;
}

export interface FieldWiring {
  invalid: boolean;
  /** The id of the helper or error text, or undefined when there is none. */
  describedBy: string | undefined;
}

const Root = styled('div', {
  shouldForwardProp: transientProps,
})<{ $disabled: boolean }>(({ $disabled }) => ({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  width: '100%',
  minWidth: 0,
  ...($disabled && { opacity: tokens.state.disabled }),
}));

const LabelRow = styled('div', {
  shouldForwardProp: transientProps,
})<{ $hidden: boolean }>(({ $hidden }) => ({
  display: 'flex',
  alignItems: 'baseline',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
  overflowWrap: 'anywhere',
  ...($hidden && visuallyHidden),
}));

const Message = styled('div')({
  display: 'flex',
  alignItems: 'flex-start',
  gap: `${tokens.space.xs}px`,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

const MessageIcon = styled('span')({
  display: 'flex',
  alignItems: 'center',
  height: `${tokens.text.meta.line}px`,
});

/**
 * The label, helper and error text around a field. The label sits above, never
 * floating; an error replaces the helper in the same place, in danger colour.
 */
export function FieldShell({
  label,
  labelHidden = false,
  required = false,
  helper,
  error,
  disabled = false,
  controlId,
  labelId,
  messageId,
  onLabelClick,
  children,
}: FieldShellProps): JSX.Element {
  const hasError = error !== undefined && error !== '';
  const message = hasError ? error : helper;
  const hasMessage = message !== undefined && message !== '';

  return (
    <Root $disabled={disabled}>
      <LabelRow $hidden={labelHidden}>
        {/* A label click is a pointer convenience: the control it focuses is the keyboard path. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
        <label
          id={labelId}
          htmlFor={onLabelClick === undefined ? controlId : undefined}
          onClick={onLabelClick}
        >
          <FieldLabelText>{label}</FieldLabelText>
        </label>
        {required && (
          <span aria-hidden="true">
            <Text variant="meta" tone="dim">
              required
            </Text>
          </span>
        )}
      </LabelRow>
      {children({ invalid: hasError, describedBy: hasMessage ? messageId : undefined })}
      {hasMessage && (
        <Message id={messageId}>
          {hasError && (
            <MessageIcon>
              <Icon name="TriangleAlert" size="xs" tone="danger" />
            </MessageIcon>
          )}
          <Text variant="meta" tone={hasError ? 'danger' : 'secondary'}>
            {message}
          </Text>
        </Message>
      )}
    </Root>
  );
}
