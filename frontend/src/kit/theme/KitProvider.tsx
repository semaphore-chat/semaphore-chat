import { useCallback, useMemo, type HTMLAttributes, type JSX, type ReactNode } from 'react';
import { ThemeProvider, useTheme, type Theme } from '@mui/material/styles';
import { derivePalette, type IntensityName, type ModeName } from '../../theme/derive/derivePalette';
import { createLoungeTheme, type LoungeTheme } from './createLoungeTheme';
// The kit bundles its own fonts; import them wherever a KitProvider renders.
import '../fonts';
import { BehaviourHost } from '../behaviour/hosts/BehaviourHost';

export interface KitProviderProps {
  base: string;
  mode: ModeName;
  intensity: IntensityName;
  children: ReactNode;
}

/**
 * The kit's theme boundary: derives the palette and theme from `base`, `mode`
 * and `intensity`, and hands them to a nested MUI tree.
 *
 * The function form of `theme` replaces the outer theme instead of being
 * shallow-merged over it, so old-screen theme entries (typography variants,
 * component overrides) never leak into kit components.
 */
export function KitProvider({ base, mode, intensity, children }: KitProviderProps): JSX.Element {
  const theme = useMemo(
    () => createLoungeTheme(derivePalette(base, mode, intensity), mode),
    [base, mode, intensity],
  );
  const themeFn = useCallback(() => theme, [theme]);
  return (
    <ThemeProvider theme={themeFn}>
      <BehaviourHost>{children}</BehaviourHost>
    </ThemeProvider>
  );
}

/**
 * A plain block that paints the lounge ground and base text on itself only
 * (no CssBaseline/GlobalStyles: the kit never styles outside its own subtree).
 */
export function KitRoot({ style, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  const theme = useTheme();
  const lounge = kitTheme(theme);
  return (
    <div
      {...props}
      style={{
        background: lounge.palette.ground,
        color: lounge.palette.text,
        fontFamily: theme.typography.fontFamily,
        fontSize: lounge.tokens.text.body.size,
        lineHeight: `${lounge.tokens.text.body.line}px`,
        ...style,
      }}
    />
  );
}

/**
 * The lounge theme a kit component renders under. Throws rather than falling
 * back to the app theme: a kit component outside a KitProvider would otherwise
 * paint with the old screens' colours.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function kitTheme(theme: Theme): LoungeTheme {
  const lounge = theme.lounge;
  if (lounge === undefined) {
    throw new Error('Kit components must be rendered inside <KitProvider>.');
  }
  return lounge;
}
