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
|`design/vectors/behaviour.json`|the shared behaviour vectors, the contract for the reducer ports|
|`frontend/src/kit/behaviour/generated/vectors.ts`|web client (`export const behaviourVectors`, the same data)|
|`native/crates/semaphore-design/src/behaviour_vectors.rs`|Rust client (the same data as canonical JSON strings, test-only)|

The icon outputs follow `design/icons/icons.json` (see
[`icons/README.md`](icons/README.md)): `design/gen/gen_icons.py` validates the
set and renders those files, and `gen_tokens.py` merges them with its own. So
the set of outputs depends on the source: removing an icon removes its asset.

## Units

Everything is px, except:

- `motion`: milliseconds.
- `text.*.weight`: font weight, one of 400, 500, 600, 700.
- `shadow.*.alpha` and `shadow.*.alphaLight`: opacity of black, 0 to 1.

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

## Behaviour

`design/behaviour/<pattern>.json` holds one interaction pattern each (toast
queue, overlay stack, confirm destructive, list focus, load state), named in
kebab case after its camelCase `pattern`. A file holds `pattern`, `doc`,
`params` (a whole number, a boolean, or `motion.<name>`, which resolves to that
token's milliseconds), `state`, `events` and `effects` (name -> field -> type
description), `rules` (numbered sentences, from 1) and `scenarios`. The
plain-language guide is [`guide/behaviour.md`](guide/behaviour.md).

`design/gen/behaviour_ref.py` is the definition of every pattern, not a
generated file: one pure `step_<pattern>(state, event, params) -> (state,
effects)` each, with `initial_<pattern>(params)`, registered in `PATTERNS`.
Timers are effects (`startTimer{token, ms}`, `cancelTimer{token}`) that come
back as `timerFired{token}` events; a stale token does nothing.
`design/gen/test_behaviour_ref.py` pins it with hand-written expectations, one
test `test_rNN_...` or more per rule.

**Scenarios become vectors.** A scenario is the source of a vector: a `name`,
`covers` (the rule numbers it shows), its `events`, and optionally `params`
(overrides of the defaults) and `initial` (state fields merged over the
initial state). `gen_behaviour.py`, called by `gen_tokens.py`, validates every
file (each scenario event is a declared event with exactly its fields, names
are unique, every rule is covered by a scenario, the declared events are the
ones the reference handles; errors start `behaviour.<pattern>`), runs each
scenario through the reference, checks the states and effects it returns
against the declarations, and writes the full vectors: for each pattern its
default `params`, its `initial` state and its `vectors`, each with `name`,
`params` in full, `initial` and `steps` of `{event, state, effects}`. The
expectations are never typed by hand. **The vectors are the contract for the
ports:** a port that disagrees with one is wrong.

**Canonical form.** Behaviour data holds only objects, lists, strings, whole
numbers, booleans and null; the validator rejects fractions and strings with
control characters (U+0000 to U+001F). Its canonical JSON form, which the Rust
output uses and a port's tests produce to compare:

- object keys sorted by code point (all keys are ASCII camelCase names);
- no whitespace anywhere outside strings;
- whole numbers in plain decimal: `-` for a negative, no leading zeros, no
  exponent, no fraction;
- strings in double quotes, with only `"` and `\` escaped (as `\"` and
  `\\`); every other character as itself, in UTF-8;
- `null`, `true`, `false`; list order kept.

In Python this is `json.dumps(value, sort_keys=True, separators=(",", ":"),
ensure_ascii=False)` (`gen_behaviour.canonical`). The JSON and TypeScript
outputs keep the structure in a fixed order (`name`, `params`, `initial`,
`steps`; `event`, `state`, `effects`) with the data inside in sorted key
order; compare them with deep equality. The Rust output has no JSON dependency:
each params, initial state, event, state and effect list is a `&str` in the
canonical form. A Rust port serialises its own state and effects canonically
and compares strings; to build its input events and params from the strings,
its tests need a small reader for this restricted form, written test-side.

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

`design/gen/list_exceptions.py` is separate from the token generator. It scans
the clients' source for `design-exception:` comments and writes
`design/guide/exceptions.md` (`--check` verifies it, as above).

Tests for the generator and its renderers:

```bash
python3 -m unittest discover -s design/gen -p 'test_*.py' -v
```

## CI

`.github/workflows/design-tokens.yml` runs the tests above,
`gen_tokens.py --check` and `list_exceptions.py --check` on every pull request and push to `main` that touches
`design/**`, any generated file or the workflow itself. When it fails with
`stale:` or `missing:` for an output, run `python3 design/gen/gen_tokens.py`,
commit the regenerated file together with the change that caused it, and push.

## Never edit generated files by hand

Every generated file except `design/vectors/colour.json` and
`design/vectors/behaviour.json` (comments are not valid JSON) starts with a header naming the source document it comes from
(`design/tokens.json`, `design/colour.json`, `design/icons/icons.json` or
`design/behaviour/*.json`) and
`design/gen/gen_tokens.py`. The icon assets carry no header, so the staleness
check covers them instead. A wrong generated file means a wrong generator or a
wrong source value: change one of those and re-run the generator. A hand edit
is reported as `stale` by `--check` and is reverted by the next run.
