import { useCallback, useId, type JSX, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { ChoiceText } from './choiceParts';
import { ChoiceRow, firstLineOffset } from './choiceStyle';

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

const Box = styled('span')({
  position: 'relative',
  display: 'block',
  flexShrink: 0,
  width: `${tokens.icon.lg}px`,
  height: `${tokens.icon.lg}px`,
  marginTop: `${firstLineOffset(tokens.icon.lg)}px`,
});

/** The real input covers the drawn box: invisible, but focusable and clickable. */
const Input = styled('input')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  cursor: 'inherit',
});

const Mark = styled('span', {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
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
    'label:hover > span > input:not(:disabled) ~ &': {
      '@media (hover: hover)': { background: mix(palette.text, under, hover) },
    },
    'input:active:not(:disabled) ~ &': { background: mix(palette.text, under, pressed) },
    'input:disabled ~ &': { opacity: tokens.state.disabled },
    'input:focus-visible ~ &': {
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    },
  };
});

const Dash = styled('span')({
  display: 'block',
  width: `${tokens.icon.xs}px`,
  height: `${tokens.border.selected}px`,
  borderRadius: `${tokens.radius.full}px`,
  background: 'currentColor',
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

  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) {
        node.indeterminate = indeterminate;
      }
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref, indeterminate],
  );

  const on = checked || indeterminate;

  return (
    <ChoiceRow>
      <Box>
        <Input
          ref={setRef}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : checked}
          aria-labelledby={labelId}
          aria-describedby={description === undefined ? undefined : descriptionId}
          onChange={() => onChange(!checked)}
        />
        <Mark aria-hidden="true" $on={on}>
          {indeterminate ? <Dash /> : checked ? <Icon name="Check" size="xs" /> : null}
        </Mark>
      </Box>
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
