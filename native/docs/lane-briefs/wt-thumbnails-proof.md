# WT: image thumbnails, proved

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Prove the image thumbnail path that is already built: message rows sized from the attachment's `width`/`height`, the list fetching `GET /file/{id}/thumbnail` when `has_thumbnail`, and the viewer fetching the full file; with stories of mixed shapes and a slice steps file. No product code changes unless a check fails (then stop and report what failed).

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/messages/stories.rs` (adding stories only; UM, which owns `messages/`, has landed before you)
- `rigs/shot/scripts/wt-thumbnails.steps`
- `rigs/slice/scripts/w7-thumbs.steps` (new)

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

## How the app is wired (read these first)

- `crates/semaphore-app/src/root.rs`: `AppRoot`, the window's root. It calls each area's hub file
  once per hook: `<area>_on_core(event)` for every `CoreEvent` (a `CoreEvent::ViewChanged { view }`
  says a core view changed: read it again and push it into the screen), `<area>_navigated(route)`
  when the route changes, `<area>_content(route)` for the main content, `<area>_overlays()` for
  dialogs and menus. Don't edit `root.rs`: your hub file already has those functions, called.
- `crates/semaphore-app/src/root/community.rs` (W5's community settings in the app) is the
  pattern to copy: one state struct holding the screen entities while the route is open (built on
  navigation, dropped on leaving), `feeds(view, open)` deciding which `ViewChanged` re-reads which
  setter (a pure function you can unit-test), a `Ticket` (weak handle) held by every async
  continuation so a late answer for a dropped screen is ignored, and each screen event turned into a
  core command run on the app's executor (`self.services` / `exec.fire(async move { .. })`, see how
  `community.rs` runs `update_community`). Read its module comment (lines 1-30) and copy it.
- Navigation: `self.shell_navigate(route, cx)` (`root/account.rs:292`). Opening a URL in the
  browser: `crate::open_url(&url, cx)` (`lib.rs:140`); in the slice rig it is recorded, and the step
  `expect opened-url <text>` checks it.
- A screen entity is made with `cx.new(|cx| Screen::new(window, cx))`; subscribe to its events with
  `cx.subscribe_in(&entity, window, |root, _, event, window, cx| ..)` as `community.rs` does.
- Core: `self.core()` gives `Option<Arc<Core>>`. Read views with the methods named below; each read
  fetches when needed and core sends `ViewChanged` when the answer lands.

## The slice rig (end-to-end)

`rigs/slice` drives the real app headlessly against the fake server, twice, and compares the
screenshots. A steps file is plain text, one step per line (copy `rigs/slice/scripts/w5.steps`:
its header comment, `app 1600 1400`, `window activate`, `wait idle`, `click <element-id>`,
`type "<text>"`, `press enter`, `wait core route <route>`, `wait core element <id>`,
`wait core label "<text>"`, `wait core w5 enabled|disabled|reason|label <id> ..` for an element's
state, `server <control> "<json>"` for a fake-server switch, `shot <name>` for a screenshot,
`expect opened-url <text>`). Lane-specific conditions go in your rig hub file (listed in your
files), parsed after `wait core <prefix> ..`. Run one file with
`scripts/in-image.sh scripts/slice-e2e.sh results/slice rigs/slice/scripts/<file>.steps` and
all of them with `scripts/in-image.sh scripts/slice-e2e.sh`; open the shots in
`results/slice/e2e/<file>/run-1/` and look at each.

## What is already there

- `crates/semaphore-ui/src/messages/row.rs` around line 685 sizes an image box from
  `AttachmentView::{width, height}` (max height 400, unknown size 320x200).
- `crates/semaphore-app/src/files.rs` lines 422-432: `attachment()` fetches `/thumbnail` when
  `has_thumbnail`, else the file; `full_image` (line 404) is what the image viewer shows.
- The fake server serves `GET /api/file/{id}/thumbnail` (`crates/semaphore-fake-server/src/http/files.rs`
  lines 21 and 118).

## Stories to add (exact names), in `messages/stories.rs`

Copy how the existing image-row stories build an `AttachmentView` (search the file for
`AttachmentKind::Image`). `message-images-mixed` (a portrait 600x1200, a panorama 3000x500, a square
800x800 and one with no size, all `has_thumbnail: true`), `message-images-no-thumbnail` (the same,
`has_thumbnail: false`), `message-images-tiny` (40x30: drawn at its size, not stretched),
`message-images-phone` (the mixed set at 390).

Add the review blocks to `rigs/shot/scripts/wt-thumbnails.steps` and render it with
`scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/wt-thumbnails.steps`; open every PNG and
check each box keeps its image's shape and nothing is cropped or letterboxed beyond the max height.

## `rigs/slice/scripts/w7-thumbs.steps` (new): what each step proves

1. Upload a portrait and a panorama PNG to a channel (copy the upload steps of `text.steps` and their
   fixture files); their boxes keep their shapes. Shot.
2. `expect requests` that the list fetched each image's `/thumbnail` (the fake server's request names
   are in `crates/semaphore-fake-server/src/http/files.rs` `operation_id`).
3. Open one in the viewer: it fetched the full `/file/{id}`. Shot.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/wt-thumbnails.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/wt-thumbnails.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/wt-thumbnails.steps
scripts/in-image.sh scripts/slice-e2e.sh results/slice rigs/slice/scripts/w7-thumbs.steps
scripts/in-image.sh scripts/slice-e2e.sh
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/messages/stories\.rs|rigs/shot/scripts/wt-thumbnails\.steps|rigs/slice/scripts/w7-thumbs\.steps)$'
```

`scripts/slice-e2e.sh` with no arguments runs every steps file twice and must end with 0 differing
shots: your change must not move any existing shot.

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every slice shot: its name and one line on what you saw in it, and what you fixed after
   looking. And the slice summary line (0 differing shots).
4. Anything this brief got wrong, and any decision you had to make.
