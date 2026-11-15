import { useId, useRef, type JSX, type KeyboardEvent } from 'react';
import { joinIds, useDescribedBy } from '../overlays/tooltipDescription';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { tintBase, useSurface, type Surface } from '../theme/onSurface';
import { FieldLabelText } from '../fields/fieldLabel';
import { ChoiceText } from './choiceParts';
import { visuallyHidden } from '../theme/a11y';
import { ChoiceInput, ChoiceRow, ChoiceSlot, choiceMarkStates } from './choiceStyle';
import { transientProps } from '../theme/transientProps';

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
  shouldForwardProp: transientProps,
})<{ $hidden: boolean }>(({ $hidden }) => ({
  minWidth: 0,
  overflowWrap: 'anywhere',
  ...($hidden && visuallyHidden),
}));

const Group = styled('div', {
  shouldForwardProp: transientProps,
})<{ $horizontal: boolean }>(({ $horizontal }) => ({
  display: 'flex',
  flexDirection: $horizontal ? 'row' : 'column',
  flexWrap: $horizontal ? 'wrap' : 'nowrap',
  columnGap: `${tokens.space.xl}px`,
  maxWidth: '100%',
  minWidth: 0,
}));

const Ring = styled('span', {
  shouldForwardProp: transientProps,
})<{ $on: boolean; $layer: Surface }>(({ theme, $on, $layer }) => {
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
    ...choiceMarkStates({ palette, under: tintBase(palette, $layer), hover, pressed }),
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
  const layer = useSurface();
  const uid = useId();
  const groupLabelId = `${uid}-group-label`;
  // An enclosing Tooltip's description, on whichever radio takes focus.
  const tooltipId = useDescribedBy(undefined);
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
              <ChoiceSlot>
                <ChoiceInput
                  type="radio"
                  name={uid}
                  data-radio={option.value}
                  checked={selected}
                  disabled={optionDisabled}
                  aria-labelledby={labelId}
                  aria-describedby={joinIds(option.description === undefined ? undefined : descriptionId, tooltipId)}
                  onChange={() => onChange(option.value)}
                />
                <Ring aria-hidden="true" $on={selected} $layer={layer} />
              </ChoiceSlot>
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
