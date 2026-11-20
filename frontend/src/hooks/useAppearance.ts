/**
 * useAppearance Hook
 *
 * The appearance the new design shell needs, in kit-independent names:
 * `KitProvider` takes `base`, `mode` and `intensity`, and `newDesign` decides
 * whether that shell is shown at all.
 */

import { useTheme } from '../contexts/ThemeContext';
import type { IntensityName, ModeName } from '../theme/derive/derivePalette';

export interface Appearance {
  /** Any lower-case `#rrggbb`. */
  baseColor: string;
  /** The OS preference when "match system" is on, the chosen mode otherwise. */
  mode: ModeName;
  intensity: IntensityName;
  newDesign: boolean;
}

export function useAppearance(): Appearance {
  const { baseColor, effectiveMode, settings, newDesign } = useTheme();
  return { baseColor, mode: effectiveMode, intensity: settings.intensity, newDesign };
}
