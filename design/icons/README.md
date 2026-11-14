# Icons

`design/icons/icons.json` is the icon set shared by both clients. It names the
pinned upstream release and maps each icon name to the file it comes from:

```json
{
  "lucide": "1.71.0",
  "icons": { "Mic": "mic" }
}
```

`design/icons/lucide/<file>.svg` holds one upstream file per entry, copied
byte for byte; `design/icons/LICENSE` is the upstream licence. The web client
and the Rust client read generated files, never these documents directly:
`design/gen/gen_icons.py` validates the set and renders it through
`design/gen/gen_tokens.py` (see the output table in the
[design README](../README.md)).

|Field|Meaning|
|---|---|
|`lucide`|upstream `lucide-static` version, pinned|
|`icons`|icon name → file name in `lucide/`, without `.svg`|

A name is PascalCase in the style of the icons it is used for (`UserPlus`);
the file name is the upstream kebab-case name (`user-plus`). Both are unique,
every name has a file and every file in `lucide/` has a name. The generator
also validates each SVG: `viewBox="0 0 24 24"`, no fill, stroke
`currentColor` at width 2, round caps and joins, and only simple shape
children.

## Source

The icons are [Lucide](https://lucide.dev), taken from the `lucide-static`
package at version `1.71.0`, which is the version in `icons.json`. Every file
in `lucide/` is that release's `icons/<file>.svg` unchanged, including the
`@license` comment at the top; `LICENSE` is that release's `LICENSE` (ISC,
with the MIT notice for the parts inherited from Feather). Do not edit an SVG
to fit a design: choose another icon, or change the icon set deliberately.

## Add an icon

1. Fetch the release named in `icons.json` (a version bump is a separate PR,
   see below) and copy the icon's file, unchanged, to
   `design/icons/lucide/<file>.svg`.
2. Add one line to `icons.json`: the name, and the file name without `.svg`,
   in a position that keeps the document grouped as it is.
3. Run the generator and commit the regenerated outputs with the source
   change:

   ```bash
   python3 design/gen/gen_tokens.py
   python3 design/gen/gen_tokens.py --check
   ```

`--check` fails with `error: icons.…` or `error: icons/<file>.svg: …` when the
set is inconsistent, and with `stale:`/`missing:` when a generated file does
not match the source.

## Bump the version

A Lucide version bump is its own pull request: update `lucide` in
`icons.json`, replace every file in `lucide/` (and `LICENSE`) from the new
release, run the generator, and review the regenerated files as a diff of the
icon set. Do not mix it with a UI change that uses the new icons, so a
changed glyph is never hidden inside an unrelated diff. If the new release
renames an icon, update its entry rather than keeping both files.
