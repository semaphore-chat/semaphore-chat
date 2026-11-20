# The native theme

The native client's theme is the design system's (`design/guide/tokens-and-colour.md`). A theme is
a base colour, a mode and an intensity (`semaphore_ui::theme::ThemeInput`).
`semaphore_design::derive_palette` turns them into the 16 colour roles. It is a port of
`design/gen/colour_ref.py` and is tested against the shared vectors in `design/vectors/colour.json`,
as the web's `derivePalette` is.

`semaphore_ui::theme::Sem` is the GPUI global that holds the theme in use. `theme::apply` replaces
it and redraws every window, so a change in Appearance shows at once, with no restart.

- `sem.roles` is the derived `Palette`, packed `0xRRGGBBAA`.
- `sem.role` is the same 16 roles as GPUI colours. Converted code reads these, and the tokens in
  `semaphore_design::lounge`.
- Everything else on `Sem` is the old MUI-shaped name the unconverted screens were written
  against. Each one is now a role, or a state tint over one, as the web's `createLoungeTheme` maps
  MUI's palette onto the roles. They are flat: no gradients. Intensity reaches the screen only
  through the derived roles. They are removed with the last unconverted screen (epic #848, B19).

## Where the theme comes from

| When | Theme |
|---|---|
| First start, signed out | the design default: `#8e75ff`, dark, minimal |
| Later starts, before the server answers | the last one shown (`settings.json` `theme`, `ThemeInput::name`) |
| Signed in | the server's appearance settings: `baseColor`, `themeMode`, `intensity`; with `matchSystem` on, the operating system's light or dark setting instead of `themeMode` (followed live) |

`ThemeInput::name` is `<mode>-<intensity>-<rrggbb>`, for example `dark-minimal-8e75ff`. `parse`
also reads the old `<mode>-<accent>-<intensity>` names (`dark-teal-minimal`), with that accent's
primary as the base, as the server migrated accents to base colours. Old `settings.json` files and
screenshot steps keep working.

## Old name to role

`hover`, `pressed`, `hoverOnFill` and `pressedOnFill` are `design/tokens.json` `state.*`. "Tint" is
the colour at that alpha, drawn over whatever is underneath. "Mix" is opaque, as the web kit's
`mix`.

| Old name (`Sem` field) | Role |
|---|---|
| `background_default`, `body` | `ground` |
| `paper`, `drawer`, `app_bar`, `palette.background_paper` | `surface` |
| `chip_bg`, `snackbar_bg`, `tooltip_bg`, `action_disabled_bg` | `fill` |
| `divider`, `paper_border`, `card_border`, `outlined_border`, `input_border`, `progress_track`, `snackbar_border` | `hairline` |
| `text_primary`, `app_bar_text`, `chip_text`, `snackbar_text` | `text` |
| `text_secondary`, `action_active` | `textSecondary` |
| `text_disabled`, `action_disabled`, `palette.grey_400/500/600` | `textDim` |
| `primary`, `contained`, `control_on`, `progress_bar`, `outlined_hover_border`, `info`, `palette.secondary_main`, `palette.info_main` | `accent` |
| `primary_contrast`, `palette.secondary_contrast_text`, `palette.info_contrast_text` | `onAccent` |
| `link`, `link_hover`, `outlined_text`, `tab_selected`, `palette.primary_light` | `accentText` |
| `input_border_focused` | `focus` |
| `success`, `positive`, `palette.success_main` | `positive` |
| `warning`, `palette.warning_main` | `warning` |
| `error`, `negative`, `palette.error_main` | `danger` |
| `palette.error_contrast_text` | `onDanger` |
| `palette.warning_contrast_text`, `palette.success_contrast_text` | `ground` in dark, `surface` in light (`createLoungeTheme`'s `onStatus`) |
| gpui-kit `overlay` | `scrim` |
| `contained_hover` | mix of `text` into `accent` at `hoverOnFill` (the kit's primary button hover) |
| `chip_hover` | mix of `text` into `fill` at `hoverOnFill` |
| `list_hover`, `action_hover`, `outlined_hover_bg`, `overlay_light` | tint of `text` at `hover` |
| `action_selected`, `icon_button_hover`, `overlay_medium` | tint of `text` at `pressed` |
| `overlay_heavy` | tint of `text` at `hoverOnFill` |
| `list_selected` | tint of `accent` at `hoverOnFill` |
| `list_selected_hover` | tint of `accent` at `pressedOnFill` |
| `list_selected_border` | `border.selected` (2 px) |
| `chip_border` | none |
| `body_band` | 0 (no gradient band) |
| `palette.common_white` | `#ffffff` (MUI's constant) |

`theme/tests.rs` checks every row and that text stays readable on each one, for a sweep of
bases in both modes and all three intensities.

## Fonts and icons

The fonts are the web kit's: Figtree 400, 400 italic, 500 and 600, and Bricolage Grotesque 600 and
700. Each is bundled with the Unicode subsets the web bundles, and text in other scripts falls back
to the system's fonts (`crates/semaphore-ui/assets/fonts/README`).

`UiAssets` serves both icon sets. One is the design system's Lucide set (`semaphore_design::LoungeIcon`,
under `lounge/`, from `design/icons/icons.json`), which converted code uses. The other is the old
MUI set (`semaphore_design::Icon`, under `mui/`), which stays until its screens are converted.

## Reviewing a theme change

`native/scripts/ui-review.sh` renders every story on the base and the head. The `theme-roles` story
shows the derived roles, with their hex values, for four bases in both modes and all intensities.
Those values must equal `design/vectors/colour.json` and the web's `derivePalette` for the same
input. Anything in a story that stays the same colour when the base changes (say, teal on a red
base) is a hard-coded colour, not a theme colour.
