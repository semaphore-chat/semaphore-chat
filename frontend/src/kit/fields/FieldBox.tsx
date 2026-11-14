import { styled } from '@mui/material/styles';
import InputBase, { type InputBaseProps } from '@mui/material/InputBase';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';

export interface FieldBoxProps extends InputBaseProps {
  $error: boolean;
  $round: boolean;
  $multiline: boolean;
}

/**
 * The field surface both TextField and SelectField draw: fill background, no
 * border at rest (a transparent one holds the room an error border takes),
 * focus ring on `.Mui-focused`. MUI's InputBase supplies only behaviour.
 */
export const FieldBox = styled(InputBase, {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<FieldBoxProps>(({ theme, $error, $round, $multiline }) => {
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
    padding: $multiline ? `${(tokens.control.lg - text.line) / 2}px ${padding}` : `0 ${padding}`,
    borderRadius: `${$round ? tokens.radius.full : tokens.radius.field}px`,
    border: `${tokens.border.selected}px solid ${$error ? palette.danger : 'transparent'}`,
    background: palette.fill,
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${text.size}px`,
    lineHeight: `${text.line}px`,
    fontWeight: text.weight,
    '&.Mui-focused': {
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    },
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
  };
});
