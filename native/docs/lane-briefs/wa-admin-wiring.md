# WA: the admin area in the app

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Wire the instance admin area into the app: `Route::Admin { page }` shows `AdminShell` with the page, every page fed from its core view and its events run as core commands, the account menu's "Admin" entry for anyone holding an admin permission, the phone drill-in; and prove it end to end with `rigs/slice/scripts/w6.steps`.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-app/src/root/admin.rs`
- `rigs/slice/src/w6.rs` (the rig's `w6` conditions)
- `rigs/slice/scripts/w6.steps` (new)

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

## What to build (in `root/admin.rs`)

The screens are UA1-UA5's (`semaphore_ui::admin::*`); build against their frozen API even if a
screen still draws its placeholder.

- `admin_account_action`: when `core.instance_permissions().admin.show_admin`, return
  `Some(Button::new("account-admin", "Admin"))` whose click closes the account menu
  (`self.account_open = false`) and navigates to `Route::Admin { page: AdminPage::Dashboard }`.
- `admin_navigated(route)`: on `Route::Admin { page }`, build (once) an `AdminShell` and the page
  entity for `page`, `set_caps(core.instance_permissions().admin)`, `set_page(page)`,
  `set_content(Some(page_view.into()))`, and feed the page once; leaving the admin routes drops
  them all. `admin_content(route)`: the shell entity for `Route::Admin`, else `None`.
- `admin_on_core(event)`: on `ViewChanged`, re-feed what that view feeds (write `fn feeds(view:
  &ViewKey, open: &OpenState) -> Vec<Feed>` like `community.rs` and unit-test it):

| Page | Screen | View key -> setter | Event -> command |
|---|---|---|---|
| any | `AdminShell` | `InstancePermissions` -> `set_caps(core.instance_permissions().admin)` (and the page's `set_caps`) | `Open(page)` -> `shell_navigate(Route::Admin { page })`; `Back` -> `shell_navigate(Route::Home)` (phone: back to the list) |
| Dashboard | `DashboardPage` | `AdminDashboard` -> `set_view(core.admin_dashboard())` | `Open { page, storage_min_percent }` -> navigate (Storage opens with that filter); `OpenUrl(url)` -> `crate::open_url`; `Retry` -> `core.retry_failed()` |
| Settings | `InstanceSettingsPage` | `InstanceSettings` -> `set_view(core.instance_settings())` | `Save(patch)` -> `core.update_instance_settings(patch)` |
| Users | `UsersPage` | `AdminUsers { query }` -> `set_view(core.admin_users(query))` (keep the current query in your state; `Query(q)` changes it and re-reads); `AdminUser { user_id }` -> `set_user(Some(core.admin_user(id)))`; `AdminUserRoles { user_id }` -> `set_user_roles(Some(core.admin_user_roles(id)))` | `LoadMore` -> `load_more_admin_users(query)`; `OpenUser`/`CloseUser` set the open user; `Ban`/`Unban`/`Delete`/`ResetPassword`/`SetOwner`/`AssignRole`/`UnassignRole`/`SetQuota` -> `ban_user`, `unban_user`, `delete_user`, `reset_user_password`, `set_user_owner`, `assign_instance_role`, `unassign_instance_role`, `set_user_quota`; `Retry` |
| Communities | `CommunitiesPage` | `AdminCommunities { search }` -> `set_view(core.admin_communities(search))`; `AdminCommunity { community_id }` -> `set_detail(..)` | `Search(s)`, `LoadMore` -> `load_more_admin_communities(s)`, `Open`, `ForceDelete` -> `force_delete_community(id)`, `Retry` |
| Invites | `InstanceInvitesPage` | `AdminInvites` -> `set_view(core.admin_invites())`; `Communities` -> `set_communities(core.communities())`; link base = the server URL (as `community.rs` sets it for the invites tab); clock and time as `community.rs` sets them | `Create(draft)` -> `create_instance_invite(draft)`; `Delete { code }` -> `delete_instance_invite(code)`; `CopyLink { url }` -> the clipboard (`cx.write_to_clipboard(ClipboardItem::new_string(url))`, as the community invites tab's copy does); `Retry` |
| Roles | `InstanceRolesPage` | `InstanceRoles` -> `set_view(core.instance_roles())`; `InstanceRoleUsers { role_id }` -> `set_role_users(Some(..))` | `Create(d)`, `Update { role_id, draft }`, `Delete { role_id }`, `OpenUsers { role_id }` -> `create_instance_role`, `update_instance_role`, `delete_instance_role`, open + feed; `Retry` |
| Storage | `StoragePage` | `AdminStorage { min_percent }` -> `set_view(core.admin_storage(p))` | `Filter(p)` re-reads; `LoadMore` -> `load_more_storage(p)`; `SetQuota` -> `set_user_quota`; `Recalculate` -> `recalculate_storage`; `Retry` |

Every command's result: on `Err`, log it (core already put the failure on the view's op, which the
screen shows); never show a second error.

## `rigs/slice/scripts/w6.steps` (new): what each step proves

Header comment: what the run covers, as `w5.steps` has. Against the showcase scenario, signed in as
`alexk` (the instance OWNER):

1. The account menu has "Admin" (`wait core element account-admin`); clicking it routes to
   `admin/dashboard` (use the route name `wait core route` prints) and the dashboard shows. Shot.
2. `server instance_storage "{...disk 95%...}"` (see `crates/semaphore-fake-server/src/w6/instance.rs`
   for its body), reopen the dashboard: the disk attention item is red. Shot.
3. Settings: rename the instance, set Registration Mode to Closed, Save; the field shows the new
   name after the re-read. Shot.
4. Users: search "pri", ban Priya (her row shows Banned), unban; reset her password; set her quota
   to 10 GB; give her the "Instance Admin" role. Shots after each.
5. Communities: open one, force-delete it with its typed name; it leaves the list and the rail.
6. Invites: create one for a community; copy its link (`expect clipboard`). Roles: create "Helpers"
   with Read users, edit it, delete it. Storage: filter Over 90%.
7. Sign in as `pri` (`server sign_in_as`, then sign out and in as in `w5.steps`): she sees "Admin"
   with every page (she holds Instance Admin now). Sign in as `diego` (no admin role): no "Admin"
   entry (`wait core no-element account-admin`).

Hold the scenario clock where dates show (as `w5.steps` does), so both runs match.

## Tests required

Unit tests in `root/admin.rs` for `feeds` (each view key feeds exactly the setter above, and only
for the open page) and for the account action (shown only with `show_admin`).

## Finish line

From `native/`, every command must pass, and the last one must print nothing:

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh scripts/slice-e2e.sh results/slice rigs/slice/scripts/w6.steps
scripts/in-image.sh scripts/slice-e2e.sh
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-app/src/root/admin\.rs|rigs/slice/src/w6\.rs|rigs/slice/scripts/w6\.steps)$'
```

`scripts/slice-e2e.sh` with no arguments runs every steps file twice and must end with 0 differing
shots: your change must not move any existing shot.

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every slice shot: its name and one line on what you saw in it, and what you fixed after
   looking. And the slice summary line (0 differing shots).
4. Anything this brief got wrong, and any decision you had to make.
