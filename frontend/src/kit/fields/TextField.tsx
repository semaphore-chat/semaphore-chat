import { useId, type ChangeEvent, type JSX, type KeyboardEventHandler, type Ref } from 'react';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';
import { FieldBox } from './FieldBox';
import { FieldShell } from './FieldShell';

/** Rows a multiline field starts with when `rows` is not given; it grows past them. */
const DEFAULT_ROWS = 3;

export interface TextFieldProps {
  /** Names the field; shown above it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: string;
  /** An error message. Marks the field invalid and replaces the helper. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Hides the label visually; it still names the field. */
  labelHidden?: boolean;
  shape?: 'field' | 'round';
  type?: 'text' | 'password' | 'email' | 'search' | 'url';
  multiline?: boolean;
  rows?: number;
  startIcon?: IconName;
  name?: string;
  autoComplete?: string;
  maxLength?: number;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  id?: string;
}

/**
 * A text input in the Lounge look: label above, fill background, focus ring.
 * Controlled by `value`. An `error` sets `aria-invalid` and is the field's
 * description in place of `helper`.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  helper,
  error,
  required = false,
  disabled = false,
  labelHidden = false,
  shape = 'field',
  type = 'text',
  multiline = false,
  rows,
  startIcon,
  name,
  autoComplete,
  maxLength,
  onKeyDown,
  ref,
  id,
}: TextFieldProps): JSX.Element {
  const uid = useId();
  const controlId = id ?? `${uid}-input`;
  const messageId = `${uid}-message`;

  return (
    <FieldShell
      label={label}
      labelHidden={labelHidden}
      required={required}
      helper={helper}
      error={error}
      disabled={disabled}
      controlId={controlId}
      labelId={`${uid}-label`}
      messageId={messageId}
    >
      {({ invalid, describedBy }) => (
        <FieldBox
          id={controlId}
          inputRef={ref}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          type={type}
          name={name}
          autoComplete={autoComplete}
          multiline={multiline}
          rows={multiline ? rows : undefined}
          minRows={multiline && rows === undefined ? DEFAULT_ROWS : undefined}
          startAdornment={
            startIcon === undefined ? undefined : <Icon name={startIcon} tone="secondary" />
          }
          inputProps={{
            maxLength,
            'aria-invalid': invalid ? true : undefined,
            'aria-describedby': describedBy,
            'aria-required': required ? true : undefined,
          }}
          $error={invalid}
          $round={shape === 'round'}
          $multiline={multiline}
        />
      )}
    </FieldShell>
  );
}
