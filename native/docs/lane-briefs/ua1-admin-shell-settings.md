# UA1: admin shell and instance settings

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Draw the admin area's frame (`AdminShell`: the list of admin pages and the open page beside it, a drill-in on a phone) and the instance settings page (`InstanceSettingsPage`), from their frozen APIs, with stories in every state and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/admin/mod.rs` (only to add `mod tests;` lines or a private helper module for your two pages)
- `crates/semaphore-ui/src/admin/layout/` (any file inside)
- `crates/semaphore-ui/src/admin/settings/` (any file inside)
- `rigs/shot/scripts/ua1-admin-shell-settings.steps`

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

### `AdminShell` (`admin/layout/mod.rs`)

Copies `crates/semaphore-ui/src/community_settings/shell.rs` (the whole file, 301 lines: the tab
list on the left, the open tab on the right, and on a phone a list that drills into a tab with a
back arrow). Change: the entries are the seven admin pages, in this order and with these labels and
icons from `semaphore_design::Icon` as the web's `components/admin/AdminLayout.tsx` lines 39-46 has
them (Dashboard, Users, Communities, Invites, Roles, Storage, Settings; no Debug: the owner decided
not to build it). Title "Admin".

| Field read | Use |
|---|---|
| `caps: InstanceAdminCaps` (`set_caps`) | which pages are enabled: Dashboard `dashboard`, Users `users_read`, Communities `communities_read`, Invites `invites_read`, Roles `roles_read`, Storage `storage`, Settings `settings_read`. A page not allowed shows disabled with `needs("<permission>")` under it (permissions: Read instance stats, Read users, Read all communities, Read instance invites, Read instance settings, Manage user storage, Read instance settings). |
| `page: AdminPage` (`set_page`) | the selected entry |
| `content: Option<AnyView>` (`set_content`) | the page drawn beside the list; `None`: `loading_rows` |

| Event | When |
|---|---|
| `AdminShellEvent::Open(page)` | an enabled entry is clicked (ids `admin-page-dashboard`, `admin-page-users`, ...) |
| `AdminShellEvent::Back` | the phone's back arrow (`admin-back`) and "Back to the app" at the list's foot (`admin-exit`) |

On a phone (`community_settings::common::phone(window)`), show only the list until a page is
selected, then only the page with a back arrow, exactly as `shell.rs` does for community tabs.

### `InstanceSettingsPage` (`admin/settings/mod.rs`)

Copies `crates/semaphore-ui/src/community_settings/overview.rs` (the form: fields, inline errors,
Save that waits on its change with `Pending`, the server's message on refusal). The web page is
`frontend/src/pages/admin/AdminSettingsPage.tsx` (read it for labels and helper texts).

Fields, from `InstanceSettingsView` (`set_view`): `state`, `name`, `description`, `registration`
(`RegistrationMode::{Open, InviteOnly, Closed}`), `default_quota_bytes`, `max_file_bytes`, `op`.

| Control | Shows | Inline check (same message as core's) |
|---|---|---|
| "Instance Name" `TextField` (`admin-settings-name`) | `name` | more than 100 characters: "name must be shorter than or equal to 100 characters" |
| "Description" `TextField` multi-line (`admin-settings-description`) | `description` or empty | more than 500: "description must be shorter than or equal to 500 characters" |
| "Registration Mode" `SelectField` (`admin-settings-registration`) | Open / Invite only / Closed, with the web's helper sentence for each | — |
| "Default Storage Quota (GB)" `TextField` (`admin-settings-quota`) | `default_quota_bytes / 1073741824`, rounded to a whole number | not a whole number, or below 1: "defaultStorageQuotaBytes must not be less than 1073741824" |
| "Max File Size (MB)" `TextField` (`admin-settings-max-file`) | `max_file_bytes / 1048576` | below 1 or above 1024: "maxFileSizeBytes must not be less than 1048576" / "maxFileSizeBytes must not be greater than 1073741824" |
| "Save" (`admin-settings-save`) | enabled only when something changed and every check passes and `caps.settings_write` | — |

`InstanceSettingsEvent::Save(patch)`: only the fields that changed are `Some` (quota and file size
converted back to bytes: GB x 1073741824, MB x 1048576). While
`running(&view.op, &act(AdminActionKind::UpdateInstanceSettings, None))`, Save shows a spinner and
is disabled; a failure (`failure(..)`) shows under Save via `server_error`. Without
`caps.settings_write`, every field is disabled and a `locked_note` says `needs("Update instance
settings")`. `Retry` from the failed state's Try again.

## Stories (exact names)

| Story | State |
|---|---|
| `admin-shell-owner` | all pages enabled, Dashboard selected, a placeholder content view |
| `admin-shell-limited` | only Invites allowed: the other six disabled with their reasons, Invites selected |
| `admin-shell-loading` | content `None` |
| `admin-shell-phone-list` | phone width, no page chosen yet (render it at 390 only, but the script still renders both sizes) |
| `admin-shell-phone-page` | phone width, Users open with the back arrow |
| `admin-settings-loading` | `LoadState::Loading` |
| `admin-settings-ready` | a filled form, nothing changed |
| `admin-settings-failed` | `Failed` with "Couldn't load the instance settings" and Try again |
| `admin-settings-read-only` | `settings_write` false: fields disabled, the reason shown |
| `admin-settings-invalid` | name of 101 characters, quota 0, max file 2000: three inline errors, Save off |
| `admin-settings-busy` | an `UpdateInstanceSettings` running |
| `admin-settings-refused` | its failure "maxFileSizeBytes must not be greater than 1073741824" |
| `admin-settings-long` | a 100-character name and a 500-character description |

## Tests required

`shell_enables_pages_by_caps`, `shell_open_emits_the_page`, `shell_back_on_phone`,
`settings_save_sends_only_changed_fields`, `settings_converts_gb_and_mb_to_bytes`,
`settings_invalid_sends_nothing` (each row of the checks table), `settings_read_only_offers_no_save`,
`settings_save_waits_for_its_change` (a `Pending` that finishes through `AdminOp::finished` closes the
busy state).

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/ua1-admin-shell-settings.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua1-admin-shell-settings.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua1-admin-shell-settings.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/admin/(mod\.rs|layout/.*|settings/.*)|rigs/shot/scripts/ua1-admin-shell-settings\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
