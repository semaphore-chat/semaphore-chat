# Design tokens

`design/tokens.json` is the single source of truth for the shared design
tokens of both clients: spacing, radii, control sizes, font families, text
styles, shadows, motion, breakpoints and layout. The web client and the Rust
client read generated files, never this document directly, so the two stay
in step by construction.

The generator is `design/gen/gen_tokens.py` (Python standard library only,
no install step). It reads `tokens.json`, validates it, and writes every
registered output through the `OUTPUTS` mapping:

|Output|Consumer|
|---|---|
|`frontend/src/theme/generated/tokens.ts`|web client (`export const tokens`)|
|`native/crates/semaphore-design/src/lounge.rs`|Rust client (`semaphore_design::lounge`)|

## Units

- Everything is px, except:
- `motion`: milliseconds.
- `text.*.weight`: font weight, one of 400, 500, 600, 700.
- `shadow.*.alpha`: opacity of black, 0 to 1.

`font` maps a font key to a family name; a `text` style names its font by
that key, and the renderers resolve it to the family string.

## Regenerate

```bash
python3 design/gen/gen_tokens.py          # rewrite every output
python3 design/gen/gen_tokens.py --check  # verify, print stale/missing, exit 1
```

Validation failures print a `TokenError` naming the dotted path (for
example `text.body.font: unknown font 'bodyy'`) and nothing is written.

Tests for the generator and its renderers:

```bash
python3 -m unittest discover -s design/gen -p 'test_*.py' -v
```

## CI

`.github/workflows/design-tokens.yml` runs the tests above and
`gen_tokens.py --check` on every pull request and push to `main` that touches
`design/**`, either generated file or the workflow itself. When it fails with
`stale:` or `missing:` for an output, run `python3 design/gen/gen_tokens.py`,
commit the regenerated file together with the change that caused it, and push.

## Never edit generated files by hand

Every generated file starts with a header naming `design/tokens.json` and
`design/gen/gen_tokens.py`. A wrong generated file means a wrong generator
or a wrong source value: change one of those and re-run the generator. A
hand edit is reported as `stale` by `--check` and is reverted by the next
run.
