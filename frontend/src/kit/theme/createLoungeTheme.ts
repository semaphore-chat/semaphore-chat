import { createTheme, type Shadows, type Theme } from '@mui/material/styles';
import type { ModeName, Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

/** The kit's own theme state, carried on `theme.lounge` for kit components. */
export interface LoungeTheme {
  tokens: typeof tokens;
  palette: Palette;
  mode: ModeName;
}

declare module '@mui/material/styles' {
  interface Theme {
    lounge?: LoungeTheme;
  }
  interface ThemeOptions {
    lounge?: LoungeTheme;
  }
}

/** The body font, with a system fallback stack so text shows before the webfont loads. */
const BODY_FONT_FAMILY = `'${tokens.font.body}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

export function createLoungeTheme(palette: Palette, mode: ModeName): Theme {
  // MUI asks for the full 25-step elevation scale; the kit is flat, so every
  // step is `none` and elevation reads as a hairline in components.
  const shadows = Array.from({ length: 25 }, () => 'none') as unknown as Shadows;

  // Positive and warning have no on-colour in the palette: use the page colour
  // that sits opposite the mode.
  const onStatus = mode === 'dark' ? palette.ground : palette.surface;

  return createTheme({
    palette: {
      mode,
      primary: { main: palette.accent, contrastText: palette.onAccent },
      secondary: { main: palette.accent, contrastText: palette.onAccent },
      info: { main: palette.accent, contrastText: palette.onAccent },
      success: { main: palette.positive, contrastText: onStatus },
      warning: { main: palette.warning, contrastText: onStatus },
      error: { main: palette.danger },
      background: { default: palette.ground, paper: palette.surface },
      text: { primary: palette.text, secondary: palette.textSecondary },
      divider: palette.hairline,
    },
    typography: {
      fontFamily: BODY_FONT_FAMILY,
      button: { textTransform: 'none', letterSpacing: 'normal' },
    },
    shape: { borderRadius: tokens.radius.field },
    shadows,
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiPaper: { defaultProps: { elevation: 0 } },
    },
    transitions: {
      duration: {
        shortest: tokens.motion.fast,
        shorter: tokens.motion.fast,
        short: tokens.motion.base,
        standard: tokens.motion.base,
      },
    },
    lounge: { tokens, palette, mode },
  });
}
