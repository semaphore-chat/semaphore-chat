import { useId, useRef, type JSX, type KeyboardEvent } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { FieldLabelText } from '../fields/fieldLabel';
import { ChoiceText } from './choiceParts';
import { ChoiceRow, firstLineOffset, visuallyHidden } from './choiceStyle';

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Names the group; shown above the options unless `labelHidden`. */
  label: string;
  /** Hides the label visually; it still names the group. */
  labelHidden?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  id?: string;
}

const Root = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  maxWidth: '100%',
  minWidth: 0,
});

const GroupLabel = styled('span', {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<{ $hidden: boolean }>(({ $hidden }) => ({
  minWidth: 0,
  overflowWrap: 'anywhere',
  ...($hidden && visuallyHidden),
}));

const Group = styled('div', {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<{ $horizontal: boolean }>(({ $horizontal }) => ({
  display: 'flex',
  flexDirection: $horizontal ? 'row' : 'column',
  flexWrap: $horizontal ? 'wrap' : 'nowrap',
  columnGap: `${tokens.space.xl}px`,
  maxWidth: '100%',
  minWidth: 0,
}));

const Circle = styled('span')({
  position: 'relative',
  display: 'block',
  flexShrink: 0,
  width: `${tokens.icon.lg}px`,
  height: `${tokens.icon.lg}px`,
  marginTop: `${firstLineOffset(tokens.icon.lg)}px`,
});

/** The real input covers the drawn ring: invisible, but focusable and clickable. */
const Input = styled('input')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  cursor: 'inherit',
});

const Ring = styled('span', {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<{ $on: boolean }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  const hover = tokens.state.hover;
  const pressed = tokens.state.pressed;
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    borderRadius: `${tokens.radius.full}px`,
    border: `${tokens.border.selected}px solid ${$on ? palette.accent : palette.textDim}`,
    pointerEvents: 'none',
    transition: `background-color ${tokens.motion.fast}ms`,
    '&::after': {
      content: '""',
      width: `${tokens.space.sm}px`,
      height: `${tokens.space.sm}px`,
      borderRadius: `${tokens.radius.full}px`,
      background: $on ? palette.accent : 'transparent',
    },
    'label:hover > span > input:not(:disabled) ~ &': {
      '@media (hover: hover)': { background: mix(palette.text, palette.surface, hover) },
    },
    'input:active:not(:disabled) ~ &': { background: mix(palette.text, palette.surface, pressed) },
    'input:disabled ~ &': { opacity: tokens.state.disabled },
    'input:focus-visible ~ &': {
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    },
  };
});

/**
 * Native radio inputs in a `radiogroup`, drawn in the Lounge look. Controlled
 * by `value`. Arrows move focus and selection, skipping disabled options and
 * wrapping; only the selected radio is a Tab stop.
 */
export function RadioGroup({
  label,
  labelHidden = false,
  value,
  onChange,
  options,
  orientation = 'vertical',
  disabled = false,
  id,
}: RadioGroupProps): JSX.Element {
  const uid = useId();
  const groupLabelId = `${uid}-group-label`;
  const groupRef = useRef<HTMLDivElement>(null);
  const enabled = options.filter((option) => !option.disabled);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (step === undefined || enabled.length === 0) {
      return;
    }
    const focused = document.activeElement?.getAttribute('data-radio');
    const current = enabled.findIndex((option) => option.value === focused);
    if (current === -1) {
      return;
    }
    event.preventDefault();
    const next = enabled[(current + step + enabled.length) % enabled.length];
    if (next === undefined) {
      return;
    }
    Array.from(groupRef.current?.querySelectorAll<HTMLInputElement>('input[data-radio]') ?? [])
      .find((node) => node.dataset.radio === next.value)
      ?.focus();
    onChange(next.value);
  };

  return (
    <Root>
      <GroupLabel id={groupLabelId} $hidden={labelHidden}>
        <FieldLabelText>{label}</FieldLabelText>
      </GroupLabel>
    <Group
      ref={groupRef}
      id={id}
      role="radiogroup"
      aria-labelledby={groupLabelId}
      onKeyDown={handleKeyDown}
      $horizontal={orientation === 'horizontal'}
    >
      {options.map((option, index) => {
        const optionDisabled = disabled || option.disabled === true;
        const selected = option.value === value;
        const labelId = `${uid}-${index}-label`;
        const descriptionId = `${uid}-${index}-description`;
        return (
          <ChoiceRow key={option.value}>
            <Circle>
              <Input
                type="radio"
                name={uid}
                data-radio={option.value}
                checked={selected}
                disabled={optionDisabled}
                aria-labelledby={labelId}
                aria-describedby={option.description === undefined ? undefined : descriptionId}
                onChange={() => onChange(option.value)}
              />
              <Ring aria-hidden="true" $on={selected} />
            </Circle>
            <ChoiceText
              label={option.label}
              description={option.description}
              labelId={labelId}
              descriptionId={descriptionId}
              disabled={optionDisabled}
            />
          </ChoiceRow>
        );
      })}
    </Group>
    </Root>
  );
}
