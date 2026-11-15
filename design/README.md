# Design tokens

`design/tokens.json` is the single source of truth for the shared design
tokens of both clients: spacing, radii, control sizes, font families, text
styles, shadows, motion, breakpoints and layout. `design/colour.json` holds
the parameters of the palette derivation (see [Colour](#colour)). The web
client and the Rust client read generated files, never these documents
directly, so the two stay in step by construction. For designers, the plain
language guide to these tokens is in [`guide/`](guide/README.md).

The generator is `design/gen/gen_tokens.py` (Python standard library only,
no install step). It reads both source documents, validates them, and writes
every registered output through the `OUTPUTS` mapping:

|Output|Consumer|
|---|---|
|`frontend/src/theme/generated/tokens.ts`|web client (`export const tokens`)|
|`native/crates/semaphore-design/src/lounge.rs`|Rust client (`semaphore_design::lounge`)|
|`design/vectors/colour.json`|the shared palette vectors, the contract for the ports|
|`frontend/src/theme/generated/colourVectors.ts`|web client (`export const colourVectors`, the same vectors)|
|`frontend/src/theme/generated/colourParams.ts`|web client (`colourParams`, `colourRoles`, `colourModes`, `colourIntensities`: the derivation parameters)|
|`native/crates/semaphore-design/src/colour_params.rs`|Rust client (the derivation parameters as `f64` constants)|
|`native/crates/semaphore-design/src/colour_vectors.rs`|Rust client (the shared vectors, test-only)|
|`frontend/src/kit/icons/generated.ts`|web client (`export const iconNodes`, the shape elements; `IconName`, `iconNames`)|
|`native/crates/semaphore-design/src/lounge_icons.rs`|Rust client (`LoungeIcon`: `ALL`, `name`, `asset_path`, `svg`)|
|`native/crates/semaphore-design/assets/lucide/<file>.svg`|Rust client (one asset per icon, `currentColor` replaced by `#000`)|

The icon outputs follow `design/icons/icons.json` (see
[`icons/README.md`](icons/README.md)): `design/gen/gen_icons.py` validates the
set and renders those files, and `gen_tokens.py` merges them with its own. So
the set of outputs depends on the source: removing an icon removes its asset.

## Units

Everything is px, except:

- `motion`: milliseconds.
- `text.*.weight`: font weight, one of 400, 500, 600, 700.
- `shadow.*.alpha`: opacity of black, 0 to 1.

`font` maps a font key to a family name; a `text` style names its font by
that key, and the renderers resolve it to the family string.

## Colour

`design/colour.json` holds the parameters of the palette derivation: the
lightness/chroma anchors for each mode, the accent lightness range, the
intensity multipliers, the status colours (`#rrggbb`), the ink and paper
colours and the contrast targets. A mode anchor is an OKLCH `[L, C]` pair;
`accentL` is a `[lo, hi]` range and `scrim` adds an alpha.

`design/gen/colour_ref.py` is the definition of the algorithm, not a
generated file: it converts to and from OKLCH, cuts chroma until a colour is
in gamut, and searches lightness in fixed 0.002 steps until a contrast target
is met. Every such decision is taken on the rounded 8-bit colour, so the
TypeScript and Rust ports cannot drift by a floating-point rounding
difference.

The generator runs the reference for every base in `VECTOR_BASES`, both
modes (dark, light) and all three intensities (minimal, balanced, vibrant):
96 palettes, each with all 16 roles in `ROLES` order. They are written to
`design/vectors/colour.json` and, as a TypeScript module, to
`frontend/src/theme/generated/colourVectors.ts` (the frontend container
cannot read `design/`). **The vectors are the contract for the ports:** a
port that disagrees with a vector is wrong. Never edit a vector, the
reference or `colour.json` to make a port pass; fix the port, or change the
reference and its parameters and regenerate.

## Regenerate

```bash
python3 design/gen/gen_tokens.py          # rewrite every output
python3 design/gen/gen_tokens.py --check  # verify, print stale/missing, exit 1
```

The outputs depend on the source: an asset below
`native/crates/semaphore-design/assets/lucide/` that no icon produces is
reported as `stale:` by `--check` and deleted by a normal run.

A validation failure prints one line starting with `error:` that names the
dotted path (for example `error: text.body.font: unknown font 'bodyy'`, or
`error: colour.modes.dark.accentL: expected lo < hi, got [0.8, 0.6]`),
exits 1, and writes nothing.

Tests for the generator and its renderers:

```bash
python3 -m unittest discover -s design/gen -p 'test_*.py' -v
```

## CI

`.github/workflows/design-tokens.yml` runs the tests above and
`gen_tokens.py --check` on every pull request and push to `main` that touches
`design/**`, any generated file or the workflow itself. When it fails with
`stale:` or `missing:` for an output, run `python3 design/gen/gen_tokens.py`,
commit the regenerated file together with the change that caused it, and push.

## Never edit generated files by hand

Every generated file except `design/vectors/colour.json` (comments are not
valid JSON) starts with a header naming the source document it comes from
(`design/tokens.json`, `design/colour.json` or `design/icons/icons.json`) and
`design/gen/gen_tokens.py`. The icon assets carry no header, so the staleness
check covers them instead. A wrong generated file means a wrong generator or a
wrong source value: change one of those and re-run the generator. A hand edit
is reported as `stale` by `--check` and is reverted by the next run.
