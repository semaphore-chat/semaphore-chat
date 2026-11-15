import { useId, type ChangeEvent, type CSSProperties, type JSX, type KeyboardEvent, type Ref } from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { railFill, useSurface, type Surface } from '../theme/onSurface';
import { Text } from '../typography/Text';
import { FieldLabelText } from '../fields/fieldLabel';
import { focusRing } from '../theme/states';
import { visuallyHidden } from '../theme/a11y';
import { transientProps } from '../theme/transientProps';

export interface SliderProps {
  /** Names the slider. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Turns the value into text, for `aria-valuetext` and the value shown beside the label. */
  formatValue?: (value: number) => string;
  /** Hides the label row visually; the label still names the slider. */
  labelHidden?: boolean;
  disabled?: boolean;
  /** The range input, so a form can focus it. */
  ref?: Ref<HTMLInputElement>;
  id?: string;
}

const Root = styled('div', {
  shouldForwardProp: transientProps,
})<{ $disabled: boolean }>(({ $disabled }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  ...($disabled && { opacity: tokens.state.disabled }),
}));

const LabelRow = styled('div', {
  shouldForwardProp: transientProps,
})<{ $hidden: boolean }>(({ $hidden }) => ({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: `${tokens.space.md}px`,
  minWidth: 0,
  overflowWrap: 'anywhere',
  ...($hidden && visuallyHidden),
}));

const Value = styled('span')({ flexShrink: 0, fontVariantNumeric: 'tabular-nums' });

const RAIL = tokens.space.xs;
const THUMB = tokens.icon.md;

/** Set on the input from the component: how far along the rail the value is, 0 to 1. */
const FILL = '--fill';

const Input = styled('input', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  // The thumb travels the rail minus its own width, so the fill stops at the
  // thumb's centre: the share of the rail, plus half a thumb at 0 and minus half at 1.
  const fillEnd = `calc(var(${FILL}) * 100% + (0.5 - var(${FILL})) * ${THUMB}px)`;
  const rail = {
    boxSizing: 'border-box',
    height: `${RAIL}px`,
    borderRadius: `${tokens.radius.full}px`,
    background: `linear-gradient(to right, ${palette.accent} ${fillEnd}, ${railFill(palette, $on)} ${fillEnd})`,
    border: 'none',
  } as const;
  const thumb = {
    boxSizing: 'border-box',
    width: `${THUMB}px`,
    height: `${THUMB}px`,
    border: 'none',
    borderRadius: `${tokens.radius.full}px`,
    background: palette.accent,
  } as const;
  const ring = focusRing(palette);
  return {
    appearance: 'none',
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    height: `${tokens.control.md}px`,
    margin: 0,
    padding: 0,
    background: 'transparent',
    cursor: 'pointer',
    outline: 'none',
    '&::-webkit-slider-runnable-track': rail,
    '&::-moz-range-track': rail,
    '&::-webkit-slider-thumb': {
      ...thumb,
      appearance: 'none',
      marginTop: `${(RAIL - THUMB) / 2}px`,
    },
    '&::-moz-range-thumb': thumb,
    '&:focus-visible::-webkit-slider-thumb': ring,
    '&:focus-visible::-moz-range-thumb': ring,
    '&:disabled': { cursor: 'default' },
  };
});

/** Decimal places of a number, so a snapped value can be rounded back to them. */
function decimalsOf(n: number): number {
  return (String(n).split('.')[1] ?? '').length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A native range input in the Lounge look. Controlled by `value`; the formatted
 * value is the `aria-valuetext` and shows at the right of the label row. Arrows
 * step, Home/End jump to the ends (the browser handles PageUp/PageDown).
 */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  formatValue,
  labelHidden = false,
  disabled = false,
  ref,
  id,
}: SliderProps): JSX.Element {
  const on = useSurface();
  const uid = useId();
  const inputId = id ?? `${uid}-input`;
  const describedBy = useDescribedBy(undefined);
  const text = formatValue ? formatValue(value) : String(value);
  const span = max - min;
  const fraction = span > 0 ? clamp((value - min) / span, 0, 1) : 0;

  const decimals = Math.max(decimalsOf(step), decimalsOf(min));
  // Snap to the step grid from `min`, rounding away float noise (0.2 + 0.1).
  const snap = (v: number) => Number((Math.round((v - min) / step) * step + min).toFixed(decimals));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      Home: min,
      End: max,
    };
    const target = moves[event.key];
    if (target === undefined) {
      return;
    }
    // The browser's own stepping would fire a second change; the value is ours.
    event.preventDefault();
    const next = clamp(snap(target), min, max);
    if (next !== value) {
      onChange(next);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isNaN(next) && next !== value) {
      onChange(next);
    }
  };

  return (
    <Root $disabled={disabled}>
      <LabelRow $hidden={labelHidden}>
        <label htmlFor={inputId}>
          <FieldLabelText>{label}</FieldLabelText>
        </label>
        <Value>
          <Text variant="meta" tone="secondary">
            {text}
          </Text>
        </Value>
      </LabelRow>
      <Input
        $on={on}
        ref={ref}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-valuetext={text}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={{ [FILL]: fraction } as CSSProperties}
      />
    </Root>
  );
}
