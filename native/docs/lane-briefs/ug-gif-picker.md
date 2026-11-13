# UG: the GIF picker

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Draw the GIF picker (`GifPicker`: the search field, the featured or found GIFs in a grid of previews, "Load more", and while third-party pictures are off a one-click "Allow" notice instead of the grid) and the composer's GIF button, from their frozen APIs, with stories in every state and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/gifs/` (any file inside)
- `crates/semaphore-ui/src/composer/menu.rs` and `crates/semaphore-ui/src/composer/view.rs`: only the GIF button and the body of `Composer::set_gifs_enabled` (find the emoji button and add the GIF button beside it the same way)
- `rigs/shot/scripts/ug-gif-picker.steps`

Everything else is read-only for you, including every file another lane owns and every kit
component under `crates/semaphore-ui/src/kit/`.

## Where you are

- The repository is the git worktree you were started in. The Rust workspace is `native/`; run
  every command from `native/`. Web-client paths below start with `frontend/` (the React app at
  the repository root), and backend paths with `backend/`: read them, never change them.
- The native client is layered. `semaphore-core` holds all logic and hands the UI plain "views"
  (structs in `crates/semaphore-core/src/model/`) and "commands" (methods on `Core`). Screens live
  in `crates/semaphore-ui` and never decide anything: what to show and whether an action is
  allowed come from the view's fields and flags. `crates/semaphore-app` connects screens to core.
- The UI freeze (commit `92830fd9` on `native/ui-plan`) already declared your components' public
  API: their `new`, setters and `Event` enums. You must keep those signatures and event variants
  exactly; you add private fields, private methods, private helper files inside your own files or
  directories, the rendering, stories and tests. If the frozen API can't express something, stop
  and say so in your report.
- Kit components to build with (`crate::kit`): `Button` (`ButtonVariant`, `ButtonSize`,
  `ButtonTone`), `IconButton`, `Switch`, `Radio`, `Checkbox` (`CheckState`), `Slider`, `Icon`,
  `Avatar`, `Badge`, `Chip`, `LinearProgress`, `Spinner`, `Skeleton`, `Alert` (`Severity`),
  `Snackbar`, `text(Variant, ..)`, `link`, `ListRow`, `Tabs`, `Table`, `TextField`, `SelectField`,
  `text_state`, `select_state`, `spacing`, `Paper`, `Menu`, `MenuItem` (with `.secondary(..)` for a
  disabled item's reason), `Dialog`, `Tip` / `with_tip`. Colours come from the theme
  (`cx.sem()`, `crate::theme::SemTheme`); sizes and gaps from `spacing`. Never style raw widgets
  with hand-picked colours or pixel values the copied screen doesn't use.
- Shared helpers the admin and community pages use (`crate::community_settings::common`): `page`,
  `card`, `row`, `list`, `locked_note`, `locked_button`, `action_icon`, `server_error`,
  `loading_rows`, `empty_line`, `user_line`, `who`, `tone_chip`, `mono`, `field_error`, `Confirm`
  (the web's ConfirmDialog), `phone(window)`. And `crate::community_settings::rules`: `act`,
  `running`, `failure`, `state_of`, `Pending` and `Outcome` (how a form waits for its change to
  finish, using `AdminOp::finished`), `needs(label)` (the "You need the X permission" sentence),
  `date_label`, `size_label`. Use them; don't copy them.
- Fixed time in stories and tests: `crate::panel::PanelClock::fixed(NOW_MS)`,
  `crate::messages::TimeFormat::fixed(NOW_MS)`, `crate::messages::fixture::NOW_MS`.

## Hard rules

1. Never run `cargo` (or `node`, `pnpm`, `npm`) on the host. Run everything from `native/` through
   the build image: `scripts/in-image.sh <command>`. `scripts/verify.sh`, `scripts/gen-api.sh` and
   `scripts/slice-e2e.sh` are already wrapped where noted below; don't wrap a wrapper twice.
2. No `docker compose`. No new dependencies (no `Cargo.toml` changes). No `git stash`. Don't commit,
   don't push: leave your changes in the working tree.
3. Never change a kit component (`crates/semaphore-ui/src/kit/`). If one is missing, stop and
   report what you needed.
4. No logic in the UI: decisions come from core's views and flags (`InstanceAdminCaps`, the rows'
   `actions`, `editable`, `deletable`, `grantable`, `needs_permission`, `mode`...). The UI may check
   the shape of what is typed (empty, too long, not a number) to show an inline error, as the
   copied screen does.
5. Nothing may touch the host desktop: no windows on the host display, no notifications, no
   opening browsers. Rendering happens inside the image (`rigs/shot`, `rigs/slice`).
6. If a command modifies `native/results/phase0/native-shell.json` or
   `native/results/phase0/shots/shell-connected.png`, restore them with
   `git checkout -- native/results/phase0/native-shell.json native/results/phase0/shots/shell-connected.png`.
7. Edit only the files you own. The ownership check at the end must print nothing.

## The state matrix

Every screen gets a story for each state that applies, and the review script renders each story at
1280x800 (dark) and 390x844 (light):

- **loading** (`LoadState::Loading`: skeleton or spinner rows, as the copied screen);
- **empty** (`Ready` with no rows: the empty sentence);
- **failed with retry** (`LoadState::Failed { error }`: the error and a Try again button that
  emits the `Retry` event);
- **permission denied, with the reason visible** (a control the caps don't allow is shown disabled
  with its reason, never hidden: `needs("...")` or the row's `AdminNotAllowed` reason);
- **long content** (50+ rows, 100-character names and emails, which truncate with an ellipsis and
  never push buttons off screen);
- **busy** (a change running on its action: `AdminOp.actions` has it with `busy: true`; its button
  shows a spinner and doesn't repeat);
- **refusal on its action** (the change failed: `AdminActionState.error` / `AdminOp.finished`
  shows the server's message next to that action, not as a page error);
- **phone width** (390 px: one column, nothing clipped, dialogs fit).

Build view values for stories by hand from the model types (look at how
`crates/semaphore-ui/src/community_settings/stories.rs` builds `InvitesView`, `AdminOp`,
`AdminActionState` and `ErrorView` values, and copy that shape).

## What to build

Copies the emoji picker: `crates/semaphore-ui/src/emoji/mod.rs` and `emoji/grid.rs` (81 lines: the
virtual grid and keyboard grid navigation) and how the composer opens it as a popover
(`crates/semaphore-ui/src/composer/palette.rs`). Web: `frontend/src/components/Message/GifPicker.tsx`
(page size 20, search debounce 300 ms, a two-column grid of previews at their aspect ratio, "Powered
by GIPHY" at the foot).

- `set_view(GifResultsView)`: `state`, `query`, `results: Vec<GifView>` (`id`, `title`, `url`,
  `preview_url`, `width`, `height`), `more`, `loading_more`, `enabled` (the server offers GIFs),
  `needs_permission` (third-party pictures are off).
- **The picker never loads an image itself.** It draws each preview through the media source set
  with `set_media(Rc<dyn MediaSource>)` (frozen): `MediaSource::gif(preview_url)` returns a
  `MediaRef`, drawn with `crate::messages::Media` as the emoji picker draws custom emoji
  (`crates/semaphore-ui/src/emoji/mod.rs`). The app decides whether the fetch happens. In stories,
  give it a small `MediaSource` of your own (in your stories file) that answers fixture images
  (look at `crates/semaphore-ui/src/emoji/stories.rs` for how its stories fake one).
- While `needs_permission`: no grid. A notice: "GIFs load from Giphy, which sees your address.",
  a button "Allow" (`gif-allow`, emits `Allow`) and a line "This also loads link-preview images.
  You can turn it off in Settings > Desktop app."
- Search field (`gif-search`), debounced 300 ms, emits `Query(text)`; empty is the featured list.
- A preview click or Enter on the highlighted one emits `Pick(gif)`; Escape or the close button
  emits `Close`. Arrow keys move through the grid as the emoji grid does.
- "Load more" when scrolled near the end, or a button `gif-more` when `more` (emits `LoadMore`).
- Failed: the error and Try again (`Retry`).
- The composer's GIF button (`composer-gif`) beside the emoji button, shown only after
  `Composer::set_gifs_enabled(true)` (store it in a private field), emits `ComposerEvent::OpenGifs`.

## Stories (exact names)

`gif-picker-loading`, `gif-picker-featured`, `gif-picker-search` (query "cat"), `gif-picker-empty`
("No GIFs found"), `gif-picker-failed` (503 "GIF search is not configured on this instance."),
`gif-picker-needs-permission`, `gif-picker-loading-more`, `gif-picker-long` (60 results of mixed
shapes), `gif-picker-highlighted` (keyboard highlight on the 3rd), `gif-picker-phone`,
`composer-gif-button` (the composer with the button), `composer-no-gif-button`.

## Tests required

`query_is_debounced`, `allow_emits_allow_and_no_grid_while_needed`, `pick_emits_the_gif`,
`arrows_move_the_highlight`, `escape_closes`, `load_more_only_when_more`,
`gif_button_only_when_enabled`, `gif_button_emits_open_gifs`.

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/ug-gif-picker.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ug-gif-picker.steps
```

The PNGs land in `native/results/slice/shots/u8/`. **Open every PNG and look at it** (read the
image file), and fix what is wrong before finishing. Check at least:

- spacing, sizes and colours match the copied screen and come from the kit tokens;
- long names and emails truncate with an ellipsis; nothing overlaps;
- at 390 px nothing is clipped or scrolls sideways; dialogs fit the width; buttons wrap rather
  than leave the screen;
- disabled controls show their reason; errors sit next to the action they belong to;
- the page lines up with the screen it copies (titles, card padding, list row heights);
- light and dark both read well (no text on a same-coloured background).

## Finish line

From `native/`, every command must pass, and the last one must print nothing:

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ug-gif-picker.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/gifs/.*|crates/semaphore-ui/src/composer/(menu|view)\.rs|rigs/shot/scripts/ug-gif-picker\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
