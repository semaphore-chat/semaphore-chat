import { useTheme } from '@mui/material/styles';
import type { Palette } from '../../theme/derive/derivePalette';
import { kitTheme } from './KitProvider';

/** The palette roles of the KitProvider above, for what lives outside the page (the browser's `theme-color`). */
export function useKitPalette(): Palette {
  return kitTheme(useTheme()).palette;
}
