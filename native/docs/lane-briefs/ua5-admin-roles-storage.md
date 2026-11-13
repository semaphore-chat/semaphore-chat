# UA5: instance roles and storage

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Draw the instance roles page (`InstanceRolesPage`: the role list, the editor with grouped actions, a role's users, delete) and the storage page (`StoragePage`: the usage filter, the per-user list a page at a time, quota and recalculation), from their frozen APIs, with stories in every state and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/admin/roles/` (any file inside)
- `crates/semaphore-ui/src/admin/storage/` (any file inside)
- `rigs/shot/scripts/ua5-admin-roles-storage.steps`

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

### `InstanceRolesPage` (`admin/roles/mod.rs`)

Copies `crates/semaphore-ui/src/roles/list.rs` (707 lines: the role cards with their counts and
menus, the disabled-with-reason pattern) and `crates/semaphore-ui/src/roles/editor.rs` (543 lines:
name field and the permission matrix with groups). Web: `frontend/src/pages/admin/AdminRolesPage.tsx`.
Changes: one scope only (instance); the matrix's groups are `semaphore_core::model::instance_action_groups()`
(Instance, Users, Invites; each action shown by a readable label: copy the web's labels from
`frontend/src/constants/rbacActions.ts` for those 12 actions).

- `set_view(InstanceRolesView)`: `state`, `roles: Vec<InstanceRoleRow>` (`id`, `actions` as wire
  names, `name`, `is_default`, `position`, `editable`, `deletable`), `grantable` (the actions I may
  tick), `op`.
- `set_role_users(Option<InstanceRoleUsersView>)`: `state`, `role_id`, `users`, `op`.
- Gating: `caps.roles_read` to see the list (else `locked_note`), `caps.roles_write` to create, edit,
  delete (else disabled with `needs("Update instance settings")`). A role with `editable` false shows
  Edit disabled: "It has permissions you don't have"; `deletable` false shows Delete disabled: "The
  Instance Admin role can't be deleted" for that role, else the same sentence as Edit. An action not
  in `grantable` is shown unticked-and-disabled with that sentence as its tip.
- Events: "New role" (`admin-roles-new`) opens the editor; Save emits `Create(draft)` or
  `Update { role_id, draft }` (`InstanceRoleDraft { name, actions }`); inline checks as core's: empty
  name "Role name must not be empty", over 50 characters "Role name must not exceed 50 characters",
  no action ticked "Role must have at least one permission"; a default role's name is read-only.
  Delete (`admin-role-delete-<id>`) confirms and emits `Delete { role_id }`; "Users"
  (`admin-role-users-<id>`) emits `OpenUsers { role_id }` and shows the list in a dialog.
- Op kinds: `CreateInstanceRole` (target `None`), `UpdateInstanceRole`, `DeleteInstanceRole`
  (target `Some(role_id)`).

### `StoragePage` (`admin/storage/mod.rs`)

A `Table` page (web: `frontend/src/pages/admin/AdminStoragePage.tsx`): a filter select
(`admin-storage-filter`: Everyone 0, Over 75% 75, Over 90% 90; emits `Filter(min_percent)`), rows
with username, used, quota (`rules::size_label`), a `LinearProgress` of `percent_used` (warning
colour from 75, error from 90), files, and two actions: "Quota" (`admin-storage-quota-<id>`, a GiB
dialog as in UA3: emits `SetQuota { user_id, quota_bytes }`) and "Recalculate"
(`admin-storage-recalc-<id>`: emits `Recalculate { user_id }`). "Load more" when `more`. Needs
`caps.storage` (else `locked_note` with `needs("Manage user storage")`). Op kinds `SetUserQuota`,
`RecalculateStorage` (target `Some(user_id)`) on the view's `op`.

## Stories (exact names)

`admin-roles-loading`, `admin-roles-empty`, `admin-roles-failed`, `admin-roles-ready` (Instance
Admin, Community Creator, two custom), `admin-roles-long` (30 roles, long names),
`admin-roles-limited` (some roles not editable, some actions not grantable), `admin-roles-locked`,
`admin-roles-editor-new`, `admin-roles-editor-default` (name read-only), `admin-roles-editor-invalid`,
`admin-roles-editor-busy`, `admin-roles-editor-refused` (`Role with name "Mods" already exists`),
`admin-roles-users`, `admin-roles-users-loading`, `admin-roles-delete-refused` ("Cannot delete role
with 2 assigned user(s). Remove all role assignments first."), `admin-roles-phone`;
`admin-storage-loading`, `admin-storage-empty`, `admin-storage-failed`, `admin-storage-ready`,
`admin-storage-over-90`, `admin-storage-long` (60 rows, `more`), `admin-storage-loading-more`,
`admin-storage-quota-dialog`, `admin-storage-quota-busy`, `admin-storage-recalc-refused`,
`admin-storage-locked`, `admin-storage-phone`.

## Tests required

`roles_editor_sends_the_draft`, `roles_editor_checks_name_and_actions`,
`a_default_role_keeps_its_name`, `ungrantable_actions_stay_off`, `delete_confirm_sends_delete`,
`edit_disabled_when_not_editable`, `users_opens_the_role`, `storage_filter_emits_the_percent`,
`storage_quota_converts_gb`, `storage_recalculate_sends_it`, `storage_load_more_only_when_more`,
`controls_follow_the_caps`.

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/ua5-admin-roles-storage.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua5-admin-roles-storage.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua5-admin-roles-storage.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/admin/(roles|storage)/.*|rigs/shot/scripts/ua5-admin-roles-storage\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
