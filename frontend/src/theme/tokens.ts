/**
 * Design tokens for type and shape.
 *
 * FONT
 * ----
 * The UI font is Roboto, self-hosted through `@fontsource/roboto` (imported
 * in `themeConfig.ts`, so it loads wherever the theme does: app, Electron and
 * Ladle). Why Roboto and why self-hosted:
 *   - MUI's metrics, component heights and every layout in this app were tuned
 *     against Roboto. Before this change the theme *named* Roboto but never
 *     loaded it, so users got whatever Helvetica/Arial/Liberation Sans their OS
 *     had, with different widths on every platform.
 *   - Self-hosting keeps it working offline (Electron `file://`, installed PWA)
 *     and avoids a third-party font CDN request.
 *   - Only the weights we use are loaded: 400, 500, 600, 700. Each weight's CSS
 *     splits the font by `unicode-range`, so browsers only fetch the subsets a
 *     page actually renders (Latin for most users).
 * The fallback stack is the platform UI font, so text still looks native if the
 * font files have not arrived yet.
 *
 * TYPE SCALE
 * ----------
 * `TYPE_SCALE` is the only set of font sizes components should use. It lives on
 * `theme.typography.scale`, and because MUI's `sx`/system `fontSize` prop
 * resolves string values against `theme.typography`, components write
 *     sx={{ fontSize: 'scale.sm' }}
 * instead of `fontSize: 12` / `'0.75rem'`. Prefer a Typography `variant` when
 * one fits (the variants below are built from this scale); use the scale for
 * one-off sizes inside a variant, chips, avatars and non-Typography boxes.
 *
 * `ICON_SCALE` does the same for SvgIcon/emoji glyph sizes (`fontSize:
 * 'icon.md'`). Icons have their own scale because icon sizes are not text
 * sizes (a 16px icon sits next to 14px text).
 *
 * A test (`__tests__/theme/typographyTokens.test.tsx`) fails on any
 * `'scale.x'`/`'icon.x'` string in components that isn't a real token, since a
 * typo would otherwise silently emit invalid CSS.
 *
 * RADIUS
 * ------
 * `shape.borderRadius` is the radius *unit* (`RADIUS_UNIT`, 4px). MUI
 * multiplies numeric `sx.borderRadius` values by it, so the steps are:
 *   1 = 4px  (chips, inputs, buttons, small badges)
 *   2 = 8px  (list rows, cards, menus)
 *   3 = 12px (sheets, dialogs, large surfaces)
 * and '50%' for circles. It's pinned at MUI's 4px on purpose: ~80 `sx`
 * values already express radius as multiples of it.
 */

export const FONT_FAMILY = [
  '"Roboto"',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

/** Root font size the rem values below assume (browser default). */
export const HTML_FONT_SIZE = 16;

/** Font sizes, in rem (px at a 16px root in comments). */
export const TYPE_SCALE = {
  '2xs': '0.625rem', // 10 — tiny badges, counters inside pills
  xs: '0.6875rem', //  11 — meta text, bottom-nav labels, tile captions
  sm: '0.75rem', //    12 — caption, secondary lines, timestamps
  md: '0.8125rem', //  13 — compact body (reactions, pickers)
  base: '0.875rem', // 14 — body2, list row names, buttons
  lg: '1rem', //       16 — body1; inputs (≥16px stops iOS focus zoom)
  xl: '1.125rem', //   18 — app-bar titles
  '2xl': '1.25rem', // 20 — h6, section titles, inline emoji
  '3xl': '1.5rem', //  24 — h5, large emoji
  '4xl': '2.125rem', // 34 — h4, avatar initials
  '5xl': '2.5rem', //  40 — profile avatar initials
  '6xl': '3rem', //    48 — h2/h3 display
  '7xl': '4rem', //    64 — h1 display
} as const;

/** Icon (SvgIcon / emoji glyph) sizes, in rem. */
export const ICON_SCALE = {
  '2xs': '0.625rem', // 10 — status dots on avatars
  xs: '0.75rem', //     12 — icons inside small pills
  sm: '0.875rem', //    14 — inline with body2 text
  md: '1rem', //        16 — inline with body1 text, dense buttons
  lg: '1.125rem', //    18
  xl: '1.25rem', //     20 — MUI "small"
  '2xl': '1.5rem', //   24 — MUI default
  '3xl': '2rem', //     32
  '4xl': '2.5rem', //   40
  '5xl': '3rem', //     48 — empty/placeholder states
  '6xl': '4rem', //     64 — large empty/error states
} as const;

export type TypeScale = typeof TYPE_SCALE;
export type IconScale = typeof ICON_SCALE;
export type TypeScaleKey = keyof TypeScale;
export type IconScaleKey = keyof IconScale;

/** `theme.shape.borderRadius`: the radius unit (see header). */
export const RADIUS_UNIT = 4;
