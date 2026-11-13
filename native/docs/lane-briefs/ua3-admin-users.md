# UA3: admin users

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Draw the admin users page (`UsersPage`): search and filters, the user list a page at a time, the per-user menu where each action is either allowed or disabled with its reason, and its dialogs (reset password, instance roles, storage quota, confirms), from its frozen API, with stories in every state and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/admin/users/` (any file inside)
- `rigs/shot/scripts/ua3-admin-users.steps`

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

Copies `crates/semaphore-ui/src/community_settings/members.rs` (459 lines: the search field, the
member rows with avatar, name and chips, the per-row menu, loading and empty rows) for the page, and
`crates/semaphore-ui/src/moderation/dialogs.rs` (583 lines: dialogs with a sentence, an input, a
Cancel and a red action, waiting on their change and showing its failure) for the dialogs. The web
page is `frontend/src/pages/admin/AdminUsersPage.tsx` and
`frontend/src/components/admin/ResetPasswordDialog.tsx` (labels, columns, confirm sentences).

### Reads

- `set_caps(InstanceAdminCaps)`.
- `set_view(AdminUsersView)`: `state`, `query` (`AdminUserQuery { search, banned: Option<bool>, owners:
  Option<bool> }`), `rows: Vec<AdminUserRow>`, `more`, `loading_more`, `op`.
  `AdminUserRow`: `user` (`UserView`), `email`, `is_owner`, `banned`, `banned_at_ms`,
  `created_at_ms`, `last_seen_ms`, `storage_used_bytes`, `storage_quota_bytes`, `actions`
  (`AdminUserActions`: `ban`, `unban`, `delete`, `reset_password`, `set_owner`, `edit_roles`,
  `set_quota`, each `Option<AdminNotAllowed>`: `None` allowed, else the reason).
- `set_user(Option<AdminUserView>)` (`state`, `user: Option<AdminUserRow>`, `op`): the open menu or
  dialog's user; its `op` carries the per-user changes (`BanUser`, `UnbanUser`, `DeleteUser`,
  `SetUserPassword`, `SetOwner`, all with target `Some(user_id)`).
- `set_user_roles(Option<AdminUserRolesView>)` (`state`, `user_id`, `held`, `available`, `op`; the
  op carries `AssignInstanceRole` / `UnassignInstanceRole` with target `Some(role_id)`).

Reason sentences for `AdminNotAllowed` (show them as the disabled menu item's `.secondary(..)` line):
Myself "That's you", Owner "That's an instance owner", OnlyOwner "Only an instance owner can grant
or remove the owner role", LastOwner "The last owner can't be demoted", Rank "They hold permissions
you don't have", NoPermission "You don't have permission to do that".

### Layout

- Toolbar: search `TextField` (`admin-users-search`, debounced 300 ms like `panel/search.rs`), a
  Status select (All / Active / Banned: `banned` None / Some(false) / Some(true), id
  `admin-users-status`) and a Role select (All / Owner / User: `owners`, id `admin-users-role`).
  Any change emits `UsersEvent::Query(query)`.
- Rows (`admin-user-<id>`): avatar, display name and `@username`, email, chips "Owner" and
  "Banned", storage "1.2 GB of 50 GB" (`community_settings::rules::size_label`), joined date, and a
  menu button (`admin-user-menu-<id>`) that emits `OpenUser { user_id }` and opens the menu.
- At the foot, when `more`: "Load more" (`admin-users-more`, emits `LoadMore`; a spinner while
  `loading_more`).
- The menu (`Menu`, items with ids `admin-user-ban`, `-unban` (instead of ban when banned),
  `-reset-password`, `-make-owner` / `-remove-owner`, `-roles`, `-quota`, `-delete`): an item whose
  reason is `Some` is disabled with the sentence. Closing it emits `CloseUser`.

### Dialogs and their events

| Dialog | Content | Event |
|---|---|---|
| Ban confirm (`Confirm`) | "Ban <name>? They're signed out and can't sign in until unbanned." | `Ban { user_id }` |
| Unban | no confirm | `Unban { user_id }` |
| Delete confirm | "Delete <name>? This can't be undone." red "Delete" | `Delete { user_id }` |
| Reset password (`admin-reset-password-field`, `-save`) | new password, 8 to 128 characters (inline: "Password must be at least 8 characters" / "at most 128 characters"); "Their sessions end." | `ResetPassword { user_id, password }` |
| Owner confirm | "Make <name> an instance owner? Owners can do everything." / "Remove <name>'s owner role?" | `SetOwner { user_id, owner }` |
| Instance roles (`admin-user-roles-dialog`) | `held` with a remove button each, `available` with an add button each; `state` loading or failed rows | `AssignRole { user_id, role_id }`, `UnassignRole { .. }` |
| Quota (`admin-quota-field`, `-save`) | GiB, a whole number, 0 or more (inline "Enter a whole number of GB") | `SetQuota { user_id, quota_bytes: gb x 1073741824 }` |

A dialog waits on its change (`Pending`, as `moderation/dialogs.rs` does) and closes when it
succeeds; a failure stays in the dialog under its action. `Retry` from the list's failed state.

## Stories (exact names)

`admin-users-loading`, `admin-users-empty` ("No users match these filters"), `admin-users-failed`,
`admin-users-ready` (8 users incl. an owner, a banned user, one near quota),
`admin-users-long` (60 users, 100-character names and emails, `more` true),
`admin-users-loading-more`, `admin-users-filtered` (Banned and Owner chosen),
`admin-users-menu-owner-actor` (every item allowed), `admin-users-menu-limited` (each
`AdminNotAllowed` reason visible on some item), `admin-users-menu-self` (Myself reasons),
`admin-users-ban-busy`, `admin-users-ban-refused` ("Cannot ban an instance owner"),
`admin-users-reset-password` (empty), `admin-users-reset-password-invalid` (7 characters),
`admin-users-reset-password-refused` ("Only an instance owner can reset another owner's password"),
`admin-users-roles-dialog` (2 held, 3 available), `admin-users-roles-loading`,
`admin-users-roles-busy`, `admin-users-quota`, `admin-users-delete-confirm`, `admin-users-phone`.

## Tests required

`filters_emit_the_query`, `search_is_debounced`, `load_more_only_when_more`,
`a_disabled_action_shows_its_reason_and_sends_nothing`, `ban_confirm_sends_ban`,
`unban_sends_unban`, `delete_confirm_sends_delete`, `reset_password_checks_length`,
`reset_password_sends_it`, `owner_toggle_sends_set_owner`, `roles_dialog_assigns_and_unassigns`,
`quota_converts_gb_to_bytes`, `a_dialog_closes_when_its_change_finishes`,
`a_refused_change_stays_in_its_dialog`.

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/ua3-admin-users.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua3-admin-users.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua3-admin-users.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/admin/users/.*|rigs/shot/scripts/ua3-admin-users\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
