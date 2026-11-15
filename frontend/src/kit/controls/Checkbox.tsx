import { useId, useImperativeHandle, useLayoutEffect, useRef, type JSX, type Ref } from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { ChoiceText } from './choiceParts';
import { ChoiceInput, ChoiceRow, ChoiceSlot, choiceMarkStates } from './choiceStyle';
import { transientProps } from '../theme/transientProps';

export interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  /** Hides the text visually; it still names and describes the checkbox. */
  labelHidden?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLInputElement>;
  id?: string;
}

const Mark = styled('span', {
  shouldForwardProp: transientProps,
})<{ $on: boolean }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  const under = $on ? palette.accent : palette.surface;
  const hover = $on ? tokens.state.hoverOnFill : tokens.state.hover;
  const pressed = $on ? tokens.state.pressedOnFill : tokens.state.pressed;
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    borderRadius: `${tokens.radius.sm}px`,
    border: `${tokens.border.selected}px solid ${$on ? palette.accent : palette.textDim}`,
    background: $on ? palette.accent : 'transparent',
    color: palette.onAccent,
    pointerEvents: 'none',
    transition: `background-color ${tokens.motion.fast}ms`,
    ...choiceMarkStates({ palette, under, hover, pressed }),
  };
});

/**
 * A native checkbox, drawn in the Lounge look. Controlled by `checked`;
 * `indeterminate` shows a dash and reports `aria-checked="mixed"`. The whole
 * row, text included, toggles it.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  description,
  labelHidden = false,
  disabled = false,
  ref,
  id,
}: CheckboxProps): JSX.Element {
  const uid = useId();
  const labelId = `${uid}-label`;
  const descriptionId = `${uid}-description`;

  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
  // The browser clears `indeterminate` on every click and React only restores
  // `checked`, so the property is assigned after every render to match the prop.
  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  });

  const on = checked || indeterminate;
  const describedBy = useDescribedBy(description === undefined ? undefined : descriptionId);

  return (
    <ChoiceRow>
      <ChoiceSlot>
        <ChoiceInput
          ref={inputRef}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : checked}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          onChange={(event) => {
            // The click has already cleared the browser's indeterminate flag;
            // put the prop's value back even if the parent does not re-render.
            event.target.indeterminate = indeterminate;
            onChange(!checked);
          }}
        />
        <Mark aria-hidden="true" $on={on}>
          {indeterminate ? <Icon name="Minus" size="xs" /> : checked ? <Icon name="Check" size="xs" /> : null}
        </Mark>
      </ChoiceSlot>
      <ChoiceText
        label={label}
        description={description}
        labelId={labelId}
        descriptionId={descriptionId}
        hidden={labelHidden}
        disabled={disabled}
      />
    </ChoiceRow>
  );
}
