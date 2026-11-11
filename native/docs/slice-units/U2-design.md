# U2: design tokens and icons from the web client

Read `_rules.md` here first. Work in `native/`.

## Goal

Export the web client's resolved themes and icons, and generate a crate the native UI reads them from,
so that a theme change on the web can reach native by one command.

## Owned paths

`tools/web-export/theme.test.ts`, `tools/web-export/icons.test.tsx`, `tools/gen-design/`,
`crates/semaphore-design/`, `scripts/gen-design.sh`.

## How exporters run

`scripts/export-web.sh <name>` runs `tools/web-export/<name>.test.ts` or `.tsx` as a Vitest file in the
frontend container, at the commit in `contract/PIN`, with its imports relative to
`frontend/src/__tests__/native-export/`. It writes to `native-export-out/<name>/`, which arrives in
`tools/web-export/out/<name>/`. `tools/web-export/smoke.test.ts` is a working example. **Don't edit
anything in `frontend/`.**

## Theme export

Source: `frontend/src/theme/themeConfig.ts` (`generateTheme(mode, accent, intensity)`),
`theme/constants.ts` and `theme/tokens.ts`. Read them at the pinned commit with
`git show "$(sed -n 's/^commit=//p' contract/PIN):frontend/src/theme/themeConfig.ts"`.

`theme.test.ts` runs `generateTheme` for every mode × accent × intensity: 2 × 12 × 3 = 72 themes.
Take the lists from `constants.ts` rather than retyping them, and fail if the product isn't 72.

For each theme, write the JSON-serializable part of `theme.palette`, all of it, keyed
`<mode>-<accent>-<intensity>`, with `TYPE_SCALE`, `ICON_SCALE`, `FONT_FAMILY`, `HTML_FONT_SIZE`,
`RADIUS_UNIT` and the theme's `spacing(1)` once at the top level. Drop functions. Don't try to port
the 22 MUI `components` overrides: those go by hand in another unit.

## Icon export

`icons.test.tsx` finds every MUI icon that `frontend/src` imports, in both forms:
`import X from '@mui/icons-material/X'` and `import { X, Y as Z } from '@mui/icons-material'`.
(46 files use the second form, so a grep for one form undercounts badly.) Walk the source at run time.
Exclude `frontend/src/__tests__` and `frontend/src/stories`. Render each with
`renderToStaticMarkup` and write `icons/<snake_case>.svg`, with its original PascalCase name in a
manifest. Strip `fill="currentColor"` from the root element, so the SVG is a plain shape GPUI can tint.
If an icon has `opacity` or several fills (two-tone), list it in your report; don't drop it.

## `crates/semaphore-design`

Pure Rust, no dependencies at all, no GPUI. `tools/gen-design` is a small Python script or Rust binary
excluded from the workspace; it turns the exports into `src/generated.rs`. Commit that file, the
SVGs, and the exported JSON as `data/tokens.json`.

```rust
pub struct Rgba(pub u32); // 0xRRGGBBAA, Copy
pub enum Mode { Light, Dark }
pub enum Accent { /* the 12 from constants.ts */ }
pub enum Intensity { Minimal, Balanced, Vibrant }
pub struct Tokens { /* every palette colour, flattened: primary_main, background_default, ... */ }
pub fn tokens(mode: Mode, accent: Accent, intensity: Intensity) -> &'static Tokens;
pub mod type_scale; // named sizes from TYPE_SCALE, in px
pub enum Icon { /* one per icon, PascalCase as the web names it */ }
impl Icon {
    pub const ALL: &'static [Icon];
    pub fn asset_path(self) -> &'static str;   // "icons/check_circle.svg"
    pub fn svg(self) -> &'static [u8];         // include_bytes!
}
```

Colour parsing must handle every form MUI emits: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`.
Anything else fails the generator with the offending value: it never guesses. An alpha such as `0.08`
rounds to the nearest of 256 steps; colour channels are kept exactly.

Include `assets/icons/LICENSE` with the MIT text from `@mui/icons-material`.

## `scripts/gen-design.sh`

Runs both exporters and the generator. `--check` fails if the result differs from what's committed,
and it must produce identical output twice.

## Tests, in `crates/semaphore-design`

1. All 72 combinations return distinct `Tokens`, except where the web's own output is identical;
   compare against `data/tokens.json`.
2. Spot-check each of `tokens(Dark, Teal, Balanced)` and `tokens(Light, Blue, Vibrant)` against
   `data/tokens.json`: `primary_main` and `background_default`.
3. Every `Icon::ALL` entry has non-empty SVG beginning `<svg`.
4. `Icon::ALL.len()` equals the manifest's count.

## Proof

```bash
scripts/gen-design.sh
scripts/gen-design.sh --check
scripts/in-image.sh cargo test --locked -p semaphore-design
scripts/in-image.sh cargo tree --locked -p semaphore-design --depth 1
scripts/verify.sh
```

## Finish line

All exit 0, and the `cargo tree` shows no dependencies. Report the theme count, the icon count, the
two-tone list and anything the colour parser had to handle specially. Once they pass, stop. Don't map
tokens onto gpui-kit's theme, don't touch `semaphore-ui`, and don't add anything beyond this.
