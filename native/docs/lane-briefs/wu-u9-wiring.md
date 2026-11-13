# WU: the remaining routes and small flows in the app

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Wire the U9 screens and routes into the app: the connect screen's "set it up in a browser" notice, the register form's requirements, joining an invite with an existing account, the notifications page, the `/friends`, `/profile`, `/community/create` and channel-search routes, search paging, a DM group's "Add people" and "Leave", and the web's keyboard shortcuts with the Mod+/ sheet; and prove them end to end with `rigs/slice/scripts/w9.steps`.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-app/src/root/u9.rs`
- `crates/semaphore-app/src/conversation/side.rs` (the search panel's paging only)
- `rigs/slice/src/w9.rs` (the rig's `w9` conditions)
- `rigs/slice/scripts/w9.steps` (new)

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

## What to build

The screens are US1's, US2's and UK's (frozen APIs); the existing screens (friends panel, profile,
create community) are already built. In `root/u9.rs`:

| Item | Wiring |
|---|---|
| Connect notice | in `u9_on_core` on `ViewChanged { view: Session }` (and right after a probe), when the probed `ServerInfo` (`self.server_info`, set by `root.rs` after `core.probe_server`) has `needs_setup`, call `auth.set_setup_needed(Some(info.url))`, else `None`. `u9_open_in_browser(url)` -> `crate::open_url(&url, cx)`. |
| Register requirements | whenever the auth screen shows, `auth.set_register_requirements(core.register_requirements())` |
| Invite join | `u9_accept_invite(code)` (the freeze calls it from `root/onboarding.rs`'s `InviteEvent::Accept`): when signed in (`core.session()` is `SignedIn`), call `set_join(InviteJoinState::Joining)` on `screen`, run `core.accept_invite(code)`, then `Joined(join)` or `Failed(error.to_string())`, and return `true`; signed out return `false` (the existing register path runs). The hook is handed the invite screen entity (`screen`); `set_signed_in` is already done by `onboarding.rs` |
| `/notifications` | `u9_content(Route::Notifications)`: a `NotificationsPage` fed from `core.notifications()` on `ViewChanged { view: ViewKey::Notifications }`; each `NotificationsPageEvent::Notification(event)` goes to `self.run_notification_event(&event, window, cx)` (`root/inbox.rs`, the centre's handler) |
| `/friends` | `u9_navigated(Route::Friends)`: the friends panel is part of the DM sidebar (`root/inbox.rs`, `DmSidebarEvent::Friends`): navigate to `Route::DirectMessages` and switch its sidebar to Friends if `semaphore_ui::dms::DmSidebar` offers a public way; if it doesn't, stop and report |
| `/profile` | `u9_navigated(Route::OwnProfile)`: `shell_navigate(Route::Profile { user_id: <me> })` |
| `/community/create` | `u9_navigated(Route::CreateCommunity)`: `self.open_create_community(window, cx)` (`root/account.rs:1058`, `pub(super)`) over Home (`shell_navigate(Route::Home)` first) |
| Channel search route | `u9_navigated(Route::ChannelSearch { community_id, channel_id })`: navigate to the channel and open its search panel (the pane's existing "open search") |
| Search paging (`conversation/side.rs`) | replace the one-shot `core.search_messages(..)` with `core.search_results(scope, query)` read on `ViewChanged { view: ViewKey::Search { .. } }` and pushed as `SearchResults::Ready`, plus `panel.set_more(view.more, view.loading_more)`; `SearchPanelEvent::More` -> `core.load_more_search(scope, query)`. The panel must look the same as before for results that fit one page. |
| DM group | `u9_dm_header_updated(header, dm_group_id)` (the freeze calls it from `root/inbox.rs` whenever the open DM's header gets its state): `header.set_group_actions(<is it a group>)` from `core.dm(dm_group_id)` (use the row's own group flag if it has one, else more than two members). `u9_dm_header(AddPeople)` -> open the user picker (`semaphore_ui::dms::picker`, as the create-DM dialog does) and `core.add_dm_members(dm_id, ids)`; `Leave` -> `core.leave_dm(dm_id)` then `shell_navigate(Route::DirectMessages)` |
| Shortcuts | bind the web's global shortcuts in `u9_overlays` / key handling exactly as UK's `shortcut_groups()` lists them (Alt+Up/Down previous/next channel, Alt+Shift+Up/Down previous/next unread, Mod+/ the sheet, and the rest of that list); Mod+/ shows `ShortcutSheet` as an overlay; its `Close` hides it |

## `rigs/slice/scripts/w9.steps` (new): what each step proves

1. `server onboarding "{\"needsSetup\": true}"` before connecting: the connect screen shows the
   notice; "Open in browser" -> `expect opened-url` the server URL. Shot. Then turn it off.
2. `server public_settings "{\"registrationMode\": \"CLOSED\"}"`: Register isn't offered; `INVITE_ONLY`:
   the code is required; `OPEN`: optional. Shots.
3. Sign in as `alexk`; `server seed_invite` an invite to a community he isn't in; open
   `link "semaphore://invite/<code>"`; "Join with your account"; the result lists the community.
   An expired code shows "This invite has expired".
4. `link "semaphore://..."` or the routes: `/notifications` page shows and "Mark all read" clears it;
   `/friends` shows the friends panel; `/profile` shows his profile.
5. Search a channel for a word with more than 25 hits (`server post_as` them first): "More results"
   loads the next page.
6. A group DM: "Add people" adds Kwame (the header shows him); "Leave group" goes back to the DM list.
7. Ctrl+/ opens the shortcut sheet; Escape closes it; Alt+Down moves to the next channel.

## Tests required

Unit tests in `root/u9.rs` for the pure parts you write (which route opens what, the `members > 2`
rule). The slice run proves the rest.

## Finish line

From `native/`, every command must pass, and the last one must print nothing:

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh scripts/slice-e2e.sh results/slice rigs/slice/scripts/w9.steps
scripts/in-image.sh scripts/slice-e2e.sh
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-app/src/(root/u9|conversation/side)\.rs|rigs/slice/src/w9\.rs|rigs/slice/scripts/w9\.steps)$'
```

`scripts/slice-e2e.sh` with no arguments runs every steps file twice and must end with 0 differing
shots: your change must not move any existing shot.

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every slice shot: its name and one line on what you saw in it, and what you fixed after
   looking. And the slice summary line (0 differing shots).
4. Anything this brief got wrong, and any decision you had to make.
