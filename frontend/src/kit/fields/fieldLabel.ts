import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';

/** The label style every field and group label shares: meta size, semibold, secondary. */
export const FieldLabelText = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'block',
    fontSize: `${tokens.text.meta.size}px`,
    lineHeight: `${tokens.text.meta.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    color: palette.textSecondary,
  };
});
