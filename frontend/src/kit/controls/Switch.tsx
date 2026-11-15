import { useId, type JSX, type Ref } from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import ButtonBase from '@mui/material/ButtonBase';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { ChoiceText } from './choiceParts';
import { ChoiceRow, firstLineOffset } from './choiceStyle';
import { transientProps } from '../theme/transientProps';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  /** Hides the text visually; it still names and describes the switch. */
  labelHidden?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  id?: string;
}

const PAD = (tokens.icon.xl - tokens.icon.md) / 2;
const TRAVEL = tokens.control.md - 2 * PAD - tokens.icon.md;

const Track = styled(ButtonBase, {
  shouldForwardProp: transientProps,
})<{ $checked: boolean }>(({ theme, $checked }) => {
  const { palette } = kitTheme(theme);
  const background = $checked ? palette.accent : palette.textDim;
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    width: `${tokens.control.md}px`,
    height: `${tokens.icon.xl}px`,
    marginTop: `${firstLineOffset(tokens.icon.xl)}px`,
    padding: `${PAD}px`,
    border: 'none',
    borderRadius: `${tokens.radius.full}px`,
    background,
    transition: `background-color ${tokens.motion.fast}ms`,
    ...interactiveStates({
      palette,
      under: background,
      hover: $checked ? tokens.state.hoverOnFill : tokens.state.hover,
      pressed: $checked ? tokens.state.pressedOnFill : tokens.state.pressed,
    }),
    '&:disabled': { opacity: tokens.state.disabled, pointerEvents: 'none' },
  };
});

const Thumb = styled('span', {
  shouldForwardProp: transientProps,
})<{ $checked: boolean }>(({ theme, $checked }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'block',
    width: `${tokens.icon.md}px`,
    height: `${tokens.icon.md}px`,
    borderRadius: `${tokens.radius.full}px`,
    background: $checked ? palette.onAccent : palette.surface,
    transform: `translateX(${$checked ? TRAVEL : 0}px)`,
    transition: `transform ${tokens.motion.fast}ms, background-color ${tokens.motion.fast}ms`,
  };
});

/**
 * An on/off switch (`role="switch"`). Controlled by `checked`; the whole row,
 * text included, toggles it. Label and description sit left, the track at the right.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  labelHidden = false,
  disabled = false,
  ref,
  id,
}: SwitchProps): JSX.Element {
  const uid = useId();
  const labelId = `${uid}-label`;
  const descriptionId = `${uid}-description`;
  const describedBy = useDescribedBy(description === undefined ? undefined : descriptionId);

  return (
    <ChoiceRow>
      <ChoiceText
        label={label}
        description={description}
        labelId={labelId}
        descriptionId={descriptionId}
        hidden={labelHidden}
        disabled={disabled}
      />
      <Track
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        disableRipple
        $checked={checked}
      >
        <Thumb aria-hidden="true" $checked={checked} />
      </Track>
    </ChoiceRow>
  );
}
