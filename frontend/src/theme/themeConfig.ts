import { createTheme, Theme, alpha, emphasize, getContrastRatio } from '@mui/material/styles';
import { chipClasses } from '@mui/material/Chip';
import type { ThemeMode, AccentColor, ThemeIntensity } from './constants';
import { FONT_FAMILY, HTML_FONT_SIZE, TYPE_SCALE, ICON_SCALE, RADIUS_UNIT } from './tokens';
import type { TypeScale, IconScale } from './tokens';
// Self-hosted UI font (see tokens.ts for why). Loaded here so it is present
// wherever the theme is: app, Electron and the Ladle sandbox.
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/600.css';
import '@fontsource/roboto/700.css';

// Extend MUI theme with custom semantic colors
declare module '@mui/material/styles' {
  /**
   * Named font-size scales (see theme/tokens.ts). Not Typography variants:
   * they exist so `sx={{ fontSize: 'scale.sm' }}` / `'icon.md'` resolve
   * against the theme.
   */
  interface TypographyVariants {
    scale: TypeScale;
    icon: IconScale;
  }
  interface TypographyVariantsOptions {
    scale?: TypeScale;
    icon?: IconScale;
  }
  interface TypeBackground {
    /**
     * CSS `background` value for full-page grounds. In dark + balanced/vibrant
     * this is a subtle accent gradient; otherwise it equals `default`.
     *
     * `default` itself is ALWAYS a solid colour: MUI runs colour maths on it
     * (e.g. SnackbarContent calls `emphasize(background.default)`), which
     * throws on a gradient. Use `ground` with the `background` shorthand
     * (never `backgroundColor`) when you want the gradient.
     */
    ground: string;
    /**
     * `background-color` for full-screen app containers (mobile/tablet screen
     * stacks, thread panel, admin main, onboarding, error fallback).
     * `transparent` when the body carries the accent page gradient
     * (dark + balanced/vibrant) so the gradient shows through; otherwise
     * equals `default`. Not a parseable colour — never feed it to alpha() etc.
     */
    canvas: string;
  }
  interface Palette {
    semantic: {
      status: {
        positive: string;  // Green - for speaking, enabled, success states
        negative: string;  // Red - for muted, disabled, error states
      };
      overlay: {
        light: string;   // Subtle backgrounds, hover states
        medium: string;  // Stronger backgrounds
        heavy: string;   // Scrollbars, heavy overlays
      };
    };
  }
  interface PaletteOptions {
    semantic?: {
      status?: {
        positive?: string;
        negative?: string;
      };
      overlay?: {
        light?: string;
        medium?: string;
        heavy?: string;
      };
    };
  }
}

// Helper to blend two hex colors
function blendColors(color1: string, color2: string, weight: number): string {
  const hex = (c: string) => parseInt(c, 16);
  const r1 = hex(color1.slice(1, 3));
  const g1 = hex(color1.slice(3, 5));
  const b1 = hex(color1.slice(5, 7));
  const r2 = hex(color2.slice(1, 3));
  const g2 = hex(color2.slice(3, 5));
  const b2 = hex(color2.slice(5, 7));
  const r = Math.round(r1 * weight + r2 * (1 - weight));
  const g = Math.round(g1 * weight + g2 * (1 - weight));
  const b = Math.round(b1 * weight + b2 * (1 - weight));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** WCAG 2.x AA minimum contrast for normal-size text (1.4.3). */
export const WCAG_AA_TEXT_CONTRAST = 4.5;

/**
 * `preferred` when it reaches `minRatio` against every colour in `backdrops`;
 * otherwise `preferred` mixed towards `towards` (black for light surfaces,
 * white for dark ones) in 5% steps until it does. Keeps the accent's hue
 * wherever it is legible and only darkens/lightens it as far as needed.
 */
export function readableTextColor(
  preferred: string,
  backdrops: string[],
  towards: '#000000' | '#ffffff',
  minRatio = WCAG_AA_TEXT_CONTRAST,
): string {
  for (let step = 0; step <= 20; step++) {
    const candidate = step === 0 ? preferred : blendColors(towards, preferred, step / 20);
    if (backdrops.every((backdrop) => getContrastRatio(candidate, backdrop) >= minRatio)) {
      return candidate;
    }
  }
  return towards;
}

// Accent color palettes
const accentPalettes = {
  teal: {
    primary: '#0d9488',
    light: '#14b8a6',
    dark: '#0f766e',
    lighter: '#5eead4',
    subtle: '#2dd4bf',
  },
  blue: {
    primary: '#3b82f6',
    light: '#60a5fa',
    dark: '#2563eb',
    lighter: '#93c5fd',
    subtle: '#60a5fa',
  },
  indigo: {
    primary: '#6366f1',
    light: '#818cf8',
    dark: '#4f46e5',
    lighter: '#a5b4fc',
    subtle: '#818cf8',
  },
  purple: {
    primary: '#8b5cf6',
    light: '#a78bfa',
    dark: '#7c3aed',
    lighter: '#c4b5fd',
    subtle: '#a78bfa',
  },
  rose: {
    primary: '#f43f5e',
    light: '#fb7185',
    dark: '#e11d48',
    lighter: '#fda4af',
    subtle: '#fb7185',
  },
  red: {
    primary: '#ef4444',
    light: '#f87171',
    dark: '#dc2626',
    lighter: '#fca5a5',
    subtle: '#f87171',
  },
  orange: {
    primary: '#f97316',
    light: '#fb923c',
    dark: '#ea580c',
    lighter: '#fdba74',
    subtle: '#fb923c',
  },
  amber: {
    primary: '#f59e0b',
    light: '#fbbf24',
    dark: '#d97706',
    lighter: '#fcd34d',
    subtle: '#fbbf24',
  },
  lime: {
    primary: '#84cc16',
    light: '#a3e635',
    dark: '#65a30d',
    lighter: '#bef264',
    subtle: '#a3e635',
  },
  emerald: {
    primary: '#10b981',
    light: '#34d399',
    dark: '#059669',
    lighter: '#6ee7b7',
    subtle: '#34d399',
  },
  cyan: {
    primary: '#06b6d4',
    light: '#22d3ee',
    dark: '#0891b2',
    lighter: '#67e8f9',
    subtle: '#22d3ee',
  },
  slate: {
    primary: '#64748b',
    light: '#94a3b8',
    dark: '#475569',
    lighter: '#cbd5e1',
    subtle: '#94a3b8',
  },
};

// Base colors for dark mode
const darkBase = {
  background: {
    default: '#111318',
    paper: '#1a1d24',
  },
  text: {
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.7)',
    disabled: 'rgba(255, 255, 255, 0.5)',
  },
};

// Base colors for light mode
const lightBase = {
  background: {
    default: '#f5f5f5',
    paper: '#ffffff',
  },
  text: {
    primary: '#1a1a1a',
    secondary: 'rgba(0, 0, 0, 0.6)',
    disabled: 'rgba(0, 0, 0, 0.38)',
  },
};

export function generateTheme(
  mode: ThemeMode,
  accentColor: AccentColor,
  intensity: ThemeIntensity
): Theme {
  const accent = accentPalettes[accentColor];
  const base = mode === 'dark' ? darkBase : lightBase;
  const isDark = mode === 'dark';

  // Intensity levels: minimal (0), balanced (1), vibrant (2)
  const intensityLevel = intensity === 'minimal' ? 0 : intensity === 'balanced' ? 1 : 2;
  const isBalanced = intensityLevel >= 1;
  const isVibrant = intensityLevel >= 2;

  // Semantic colors that adapt to light/dark mode
  // Simplified to just status indicators and overlay levels
  const semanticColors = {
    status: {
      positive: '#22c55e', // Green - for speaking, enabled, success states
      negative: '#ef4444', // Red - for muted, disabled, error states
    },
    overlay: {
      light: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)',
      medium: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      heavy: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    },
  };

  // Tint paper background in vibrant/subtle modes
  const paperBackground = isVibrant
    ? blendColors(accent.primary, base.background.paper, isDark ? 0.2 : 0.22)
    : isBalanced
    ? blendColors(accent.primary, base.background.paper, isDark ? 0.1 : 0.08)
    : base.background.paper;

  // Chips: every chip, whatever its `color` prop, is a translucent accent tint
  // with accent-coloured text (the MuiChip override below replaces MUI's
  // per-colour fills). The text colour is checked against that tint over each
  // solid surface a chip sits on (paper, page ground), at rest and in the
  // stronger hover/focus tint, and moved towards black (light) or white (dark)
  // until it reaches WCAG AA. accent.lighter on a pale tint was ~1.0-1.8:1 in
  // light mode (e.g. the voice bar's "Connected" chip); dark mode keeps
  // accent.lighter wherever it already passes.
  const chipTint = isVibrant ? 0.3 : isBalanced ? 0.18 : 0.1;
  const chipHoverTint = chipTint + 0.1;
  const chipBackdrops = [paperBackground, base.background.default].flatMap((surface) => [
    blendColors(accent.primary, surface, chipTint),
    blendColors(accent.primary, surface, chipHoverTint),
  ]);
  const chipText = readableTextColor(
    isDark ? accent.lighter : accent.dark,
    chipBackdrops,
    isDark ? '#ffffff' : '#000000',
  );

  // Same formula MUI's SnackbarContent uses, computed from the solid ground.
  const snackbarBackground = emphasize(base.background.default, isDark ? 0.98 : 0.8);
  // Same rule as palette.getContrastText (contrastThreshold 3).
  const snackbarText = getContrastRatio(snackbarBackground, '#fff') >= 3 ? '#fff' : 'rgba(0, 0, 0, 0.87)';

  return createTheme({
    shape: {
      borderRadius: RADIUS_UNIT,
    },
    typography: {
      fontFamily: FONT_FAMILY,
      htmlFontSize: HTML_FONT_SIZE,
      fontSize: 14,
      fontWeightLight: 400, // 300 isn't loaded; never ask for it
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 700,
      scale: TYPE_SCALE,
      icon: ICON_SCALE,
      // Every variant takes its size from the scale. h3–overline keep the MUI
      // default sizes the app was laid out with, so this is a naming change,
      // not a relayout. h1/h2 (MUI 96px/60px, only the 404 page uses h1) are
      // pulled onto the scale. h1–h3 were MUI "light" (300), never loaded.
      h1: { fontSize: TYPE_SCALE['7xl'], fontWeight: 700 },
      h2: { fontSize: TYPE_SCALE['6xl'], fontWeight: 700 },
      h3: { fontSize: TYPE_SCALE['6xl'], fontWeight: 400 },
      h4: { fontSize: TYPE_SCALE['4xl'], fontWeight: 400 },
      h5: { fontSize: TYPE_SCALE['3xl'], fontWeight: 400 },
      h6: { fontSize: TYPE_SCALE['2xl'], fontWeight: 500 },
      subtitle1: { fontSize: TYPE_SCALE.lg, fontWeight: 400 },
      subtitle2: { fontSize: TYPE_SCALE.base, fontWeight: 500 },
      body1: { fontSize: TYPE_SCALE.lg, fontWeight: 400 },
      body2: { fontSize: TYPE_SCALE.base, fontWeight: 400 },
      button: { fontSize: TYPE_SCALE.base, fontWeight: 500 },
      caption: { fontSize: TYPE_SCALE.sm, fontWeight: 400 },
      overline: { fontSize: TYPE_SCALE.sm, fontWeight: 400 },
    },
    palette: {
      mode,
      primary: {
        main: accent.primary,
        light: accent.light,
        dark: accent.dark,
      },
      background: {
        // Solid colour only — see the TypeBackground.ground note above.
        default: base.background.default,
        ground: isVibrant && isDark
          ? `linear-gradient(180deg, ${alpha(accent.dark, 0.25)} 0%, ${base.background.default} 100%)`
          : isBalanced && isDark
          ? `linear-gradient(180deg, ${alpha(accent.dark, 0.12)} 0%, ${base.background.default} 100%)`
          : base.background.default,
        canvas: isBalanced && isDark ? 'transparent' : base.background.default,
        paper: paperBackground,
      },
      text: base.text,
      semantic: semanticColors,
    },
    components: {
      // Paper components
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            // Use palette background.paper (which is now tinted in vibrant/subtle modes)
            border: `1px solid ${alpha(accent.primary, isVibrant ? 0.4 : isBalanced ? 0.2 : 0.08)}`,
            ...(isVibrant && {
              boxShadow: `0 0 20px ${alpha(accent.primary, 0.15)}, 0 0 0 1px ${alpha(accent.primary, 0.1)} inset`,
            }),
            ...(isBalanced && !isVibrant && {
              boxShadow: `0 0 0 1px ${alpha(accent.primary, 0.05)} inset`,
            }),
          },
        },
      },

      // Card components
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            // Use palette background.paper (tinted in vibrant/subtle modes)
            border: `1px solid ${alpha(accent.primary, isVibrant ? 0.5 : isBalanced ? 0.25 : 0.08)}`,
            transition: 'box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out, border-color 0.2s ease-in-out',
            ...(isVibrant && {
              boxShadow: `0 4px 20px ${alpha(accent.primary, 0.25)}, 0 0 30px ${alpha(accent.primary, 0.1)}`,
            }),
            ...(isBalanced && !isVibrant && {
              boxShadow: `0 2px 12px ${alpha(accent.primary, 0.1)}`,
            }),
            '&:hover': {
              boxShadow: isDark
                ? `0 8px 32px ${alpha(accent.primary, isVibrant ? 0.45 : isBalanced ? 0.25 : 0.1)}`
                : `0 6px 24px ${alpha(accent.primary, isVibrant ? 0.35 : isBalanced ? 0.15 : 0.08)}`,
              ...(isVibrant && {
                borderColor: alpha(accent.primary, 0.7),
                transform: 'translateY(-2px)',
              }),
              ...(isBalanced && !isVibrant && {
                borderColor: alpha(accent.primary, 0.4),
              }),
            },
          },
        },
      },

      // Buttons
      MuiButton: {
        styleOverrides: {
          contained: {
            background: isVibrant
              ? `linear-gradient(135deg, ${accent.light} 0%, ${accent.primary} 50%, ${accent.dark} 100%)`
              : isBalanced
              ? `linear-gradient(135deg, ${accent.primary} 0%, ${accent.light} 100%)`
              : accent.primary,
            boxShadow: isVibrant
              ? `0 4px 15px ${alpha(accent.primary, 0.4)}, 0 0 20px ${alpha(accent.primary, 0.2)}`
              : 'none',
            '&:hover': {
              background: isVibrant
                ? `linear-gradient(135deg, ${accent.primary} 0%, ${accent.dark} 50%, ${blendColors(accent.dark, '#000000', 0.5)} 100%)`
                : isBalanced
                ? `linear-gradient(135deg, ${accent.dark} 0%, ${accent.primary} 100%)`
                : accent.dark,
              boxShadow: isVibrant
                ? `0 6px 20px ${alpha(accent.primary, 0.5)}, 0 0 30px ${alpha(accent.primary, 0.3)}`
                : `0 2px 8px ${alpha(accent.primary, 0.4)}`,
            },
          },
          outlined: {
            borderColor: alpha(accent.primary, isVibrant ? 0.7 : isBalanced ? 0.5 : 0.3),
            color: accent.light,
            ...(isVibrant && {
              boxShadow: `0 0 10px ${alpha(accent.primary, 0.15)}`,
            }),
            '&:hover': {
              borderColor: accent.primary,
              backgroundColor: alpha(accent.primary, isVibrant ? 0.15 : 0.08),
              ...(isVibrant && {
                boxShadow: `0 0 15px ${alpha(accent.primary, 0.25)}`,
              }),
            },
          },
        },
      },

      // List item buttons (sidebar)
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS_UNIT * 2,
            marginBottom: 2,
            transition: 'background-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
            '&:hover': {
              backgroundColor: alpha(accent.primary, isVibrant ? 0.18 : isBalanced ? 0.12 : 0.06),
              ...(isVibrant && {
                boxShadow: `inset 0 0 15px ${alpha(accent.primary, 0.1)}`,
              }),
            },
            '&.Mui-selected': {
              backgroundColor: alpha(accent.primary, isVibrant ? 0.28 : isBalanced ? 0.18 : 0.1),
              borderLeft: `${isVibrant ? 4 : 3}px solid ${accent.primary}`,
              ...(isVibrant && {
                boxShadow: `inset 0 0 20px ${alpha(accent.primary, 0.15)}, 0 0 10px ${alpha(accent.primary, 0.1)}`,
              }),
              '&:hover': {
                backgroundColor: alpha(accent.primary, isVibrant ? 0.35 : isBalanced ? 0.22 : 0.14),
              },
            },
          },
        },
      },

      // Chips
      MuiChip: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(accent.primary, chipTint),
            // Readable on the tint in every mode/accent/intensity (see chipText).
            color: chipText,
            border: isVibrant
              ? `1px solid ${alpha(accent.primary, 0.5)}`
              : isBalanced
              ? `1px solid ${alpha(accent.primary, 0.25)}`
              : 'none',
            ...(isVibrant && {
              boxShadow: `0 0 8px ${alpha(accent.primary, 0.2)}`,
            }),
            // MUI fills a coloured clickable chip with palette[color].dark on
            // hover/focus (a coloured deletable one on focus), under chipText:
            // 2-3.7:1 in dark mode, worse in light. Stay on the accent tint,
            // one step stronger, which chipText is checked against.
            [`&.${chipClasses.clickable}:hover, &.${chipClasses.clickable}.${chipClasses.focusVisible}, &.${chipClasses.deletable}.${chipClasses.focusVisible}`]: {
              backgroundColor: alpha(accent.primary, chipHoverTint),
            },
          },
        },
      },

      // Drawer (sidebar)
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: base.background.paper,
            borderRight: 'none',
            ...(isVibrant && {
              background: isDark
                ? `linear-gradient(180deg, ${blendColors(accent.primary, base.background.paper, 0.5)} 0%, ${base.background.paper} 60%)`
                : `linear-gradient(180deg, ${blendColors(accent.primary, base.background.paper, 0.35)} 0%, ${base.background.paper} 60%)`,
              boxShadow: `4px 0 25px ${alpha(accent.primary, 0.15)}`,
            }),
            ...(isBalanced && !isVibrant && {
              background: isDark
                ? `linear-gradient(180deg, ${blendColors(accent.dark, base.background.paper, 0.3)} 0%, ${base.background.paper} 100%)`
                : `linear-gradient(180deg, ${blendColors(accent.primary, base.background.paper, 0.2)} 0%, ${base.background.paper} 100%)`,
            }),
          },
        },
      },

      // AppBar
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? '#151820' : '#ffffff',
            // The bar is repainted below as a neutral / pale accent-tinted
            // surface, so its content (and every color="inherit" icon in it,
            // e.g. the notification bell) must use the surface's text token.
            // MUI's default for color="primary" is primary.contrastText,
            // which it applies in light mode only: white for most accents,
            // i.e. white icons on a white bar. Dark mode already resolves to
            // text.primary (MUI drops the colour, Paper supplies it).
            color: base.text.primary,
            ...(isVibrant && {
              background: isDark
                ? `linear-gradient(90deg, ${blendColors(accent.dark, '#151820', 0.4)} 0%, ${blendColors(accent.primary, '#151820', 0.55)} 50%, ${blendColors(accent.dark, '#151820', 0.4)} 100%)`
                : `linear-gradient(90deg, ${blendColors(accent.primary, '#ffffff', 0.3)} 0%, ${blendColors(accent.light, '#ffffff', 0.35)} 50%, ${blendColors(accent.primary, '#ffffff', 0.3)} 100%)`,
              boxShadow: `0 4px 20px ${alpha(accent.primary, 0.2)}`,
            }),
            ...(isBalanced && !isVibrant && {
              background: isDark
                ? `linear-gradient(90deg, #151820 0%, ${blendColors(accent.dark, '#151820', 0.35)} 100%)`
                : `linear-gradient(90deg, #ffffff 0%, ${blendColors(accent.primary, '#ffffff', 0.2)} 100%)`,
            }),
          },
        },
      },

      // Links
      MuiLink: {
        styleOverrides: {
          root: {
            color: accent.subtle,
            '&:hover': {
              color: accent.light,
            },
          },
        },
      },

      // Typography for links
      MuiTypography: {
        styleOverrides: {
          root: {
            '&.MuiTypography-colorPrimary': {
              color: accent.subtle,
            },
          },
        },
      },

      // Text fields
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: accent.primary,
            },
          },
          notchedOutline: {
            borderColor: alpha(accent.primary, 0.3),
          },
        },
      },

      // Icon buttons
      MuiIconButton: {
        styleOverrides: {
          root: {
            '&:hover': {
              backgroundColor: alpha(accent.primary, 0.1),
            },
          },
        },
      },

      // Tabs
      MuiTab: {
        styleOverrides: {
          root: {
            '&.Mui-selected': {
              color: accent.light,
            },
          },
        },
      },

      // Switch
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            '&.Mui-checked': {
              color: accent.primary,
              '& + .MuiSwitch-track': {
                backgroundColor: accent.primary,
              },
            },
          },
        },
      },

      // Checkbox
      MuiCheckbox: {
        styleOverrides: {
          root: {
            '&.Mui-checked': {
              color: accent.primary,
            },
          },
        },
      },

      // Radio
      MuiRadio: {
        styleOverrides: {
          root: {
            '&.Mui-checked': {
              color: accent.primary,
            },
          },
        },
      },

      // Slider
      MuiSlider: {
        styleOverrides: {
          root: {
            color: accent.primary,
          },
        },
      },

      // Linear Progress
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(accent.primary, 0.2),
          },
          bar: {
            backgroundColor: accent.primary,
          },
        },
      },

      // Circular Progress
      MuiCircularProgress: {
        styleOverrides: {
          root: {
            color: accent.primary,
          },
        },
      },

      // Snackbars: a solid, high-contrast surface (MUI's own derivation from the
      // solid base ground), pinned explicitly so every intensity matches and
      // snackbars never depend on page-ground styling.
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            backgroundColor: snackbarBackground,
            backgroundImage: 'none',
            color: snackbarText,
          },
        },
      },

      // Tooltip
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? '#2a2d35' : '#333',
          },
        },
      },

      // CssBaseline for body background
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: base.background.default,
            ...(isVibrant && {
              background: isDark
                ? `linear-gradient(180deg, ${blendColors(accent.primary, base.background.default, 0.35)} 0%, ${base.background.default} 600px)`
                : `linear-gradient(180deg, ${blendColors(accent.primary, base.background.default, 0.25)} 0%, ${base.background.default} 600px)`,
              backgroundAttachment: 'fixed',
            }),
            ...(isBalanced && !isVibrant && {
              background: isDark
                ? `linear-gradient(180deg, ${blendColors(accent.dark, base.background.default, 0.15)} 0%, ${base.background.default} 400px)`
                : `linear-gradient(180deg, ${blendColors(accent.primary, base.background.default, 0.1)} 0%, ${base.background.default} 400px)`,
              backgroundAttachment: 'fixed',
            }),
          },
        },
      },
    },
  });
}
