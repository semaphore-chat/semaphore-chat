import { styled } from '@mui/material/styles';
import InputBase, { type InputBaseProps } from '@mui/material/InputBase';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, type Surface } from '../theme/onSurface';
import { focusRing } from '../theme/states';
import { transientProps } from '../theme/transientProps';

export interface FieldBoxProps extends InputBaseProps {
  $error: boolean;
  $round: boolean;
  $multiline: boolean;
  /** The layer the field sits on: the box stands out from it. */
  $on?: Surface;
}

/**
 * The field surface both TextField and SelectField draw: a fill background that stands out from its layer, no
 * border at rest (a transparent one holds the room an error border takes),
 * focus ring on `.Mui-focused`. MUI's InputBase supplies only behaviour.
 */
export const FieldBox = styled(InputBase, {
  shouldForwardProp: transientProps,
})<FieldBoxProps>(({ theme, $error, $round, $multiline, $on = 'surface' }) => {
  const { palette } = kitTheme(theme);
  const text = tokens.text.body;
  const padding = `${tokens.space.lg}px`;
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: $multiline ? 'flex-start' : 'center',
    gap: `${tokens.space.sm}px`,
    width: '100%',
    minWidth: 0,
    minHeight: `${tokens.control.lg}px`,
    // The transparent border is part of the box, so it comes off the vertical
    // padding: a one-row multiline field is as tall as a single-line one.
    padding: $multiline
      ? `${(tokens.control.lg - text.line) / 2 - tokens.border.selected}px ${padding}`
      : `0 ${padding}`,
    borderRadius: `${$round ? tokens.radius.full : tokens.radius.field}px`,
    border: `${tokens.border.selected}px solid ${$error ? palette.danger : 'transparent'}`,
    background: standOutFill(palette, $on),
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${text.size}px`,
    lineHeight: `${text.line}px`,
    fontWeight: text.weight,
    '&.Mui-focused': focusRing(palette),
    '&.Mui-disabled': { color: palette.text },
    '& .MuiInputBase-input': {
      boxSizing: 'border-box',
      height: $multiline ? 'auto' : '100%',
      padding: 0,
      resize: 'none',
      color: 'inherit',
      WebkitTextFillColor: 'currentcolor',
      '&::placeholder': { color: palette.textDim, opacity: 1 },
    },
    // MUI paints a disabled input's text in text.disabled; the field already
    // dims as a whole (FieldShell), so the text must not be dimmed twice.
    '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: 'currentcolor' },
  };
});
