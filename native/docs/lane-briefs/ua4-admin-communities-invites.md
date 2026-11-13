# UA4: admin communities and instance invites

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Draw the admin communities page (`CommunitiesPage`: every community with its counts, search, paging, a detail and force delete) and the instance invites page (`InstanceInvitesPage`: the list, creating one for some communities, copying its link, deleting), from their frozen APIs, with stories in every state and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/admin/communities/` (any file inside)
- `crates/semaphore-ui/src/admin/invites/` (any file inside)
- `rigs/shot/scripts/ua4-admin-communities-invites.steps`

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

### `CommunitiesPage` (`admin/communities/mod.rs`)

Copies the list half of `crates/semaphore-ui/src/community_settings/members.rs` (search field,
rows, loading and empty rows). Web: `frontend/src/pages/admin/AdminCommunitiesPage.tsx`.

- `set_caps`: reading needs `communities_read` (without it the page shows a `locked_note` with
  `needs("Read all communities")`); the delete needs `communities_delete` (else the button is
  disabled with `needs("Delete communities")`).
- `set_view(AdminCommunitiesView)`: `state`, `search`, `rows: Vec<AdminCommunityRow>` (`id`, `name`,
  `description`, `avatar_file_id`, `member_count`, `channel_count`, `created_at_ms`), `more`,
  `loading_more`, `op`.
- `set_detail(Option<AdminCommunityView>)`: `state`, `community`, `message_count`, `op` (carries
  `ForceDeleteCommunity` with target `Some(community_id)`).
- Search field (`admin-communities-search`, debounced 300 ms) emits `Search(text)`; "Load more"
  (`admin-communities-more`) emits `LoadMore`; a row (`admin-community-<id>`) emits `Open { community_id }`
  and shows the detail card (members, channels, messages, created); "Delete" (`admin-community-delete`)
  opens a `Confirm` that asks to type the community's name (as `community_settings/overview.rs`'s
  delete does with `rules::confirms_name`) and emits `ForceDelete { community_id }`; it waits on its
  change and shows its failure there.

### `InstanceInvitesPage` (`admin/invites/mod.rs`)

Copies `crates/semaphore-ui/src/community_settings/invites.rs` (the whole file, 474 lines: the list
with code, copy-link, uses, expiry, status chips; the create dialog with use limit and expiry presets;
the delete confirm). Web: `frontend/src/pages/AdminInvitePage.tsx`. Changes:

- Rows are `InstanceInviteRow` (`code`, `created_by`, `uses`, `max_uses`, `valid_until_ms`,
  `created_at_ms`, `disabled`, `communities: Vec<InviteCommunity { id, name }>`): also show who made
  it and the communities it adds people to (chips; more than 3: "+N").
- The create dialog adds a community multi-select (`Checkbox` list from `set_communities`, at least
  one required: "Pick at least one community"); `Create(InstanceInviteDraft { community_ids,
  max_uses, valid_until_ms })` (reuse `rules::parse_max_uses` and `ExpiryPreset`).
- Copy link emits `CopyLink { url }` with `rules::invite_url(link_base, code)` and shows "Copied" as
  the copied screen does.
- Gating: listing needs `invites_read`, creating `invites_create`, deleting `invites_delete`; each
  missing one shows its control disabled with `needs("...")`.
- Op kinds: `CreateInstanceInvite` (target `None`), `DeleteInstanceInvite` (target `Some(code)`).

## Stories (exact names)

`admin-communities-loading`, `admin-communities-empty`, `admin-communities-failed`,
`admin-communities-ready`, `admin-communities-long` (60 rows, long names, `more`),
`admin-communities-loading-more`, `admin-communities-detail`, `admin-communities-delete-confirm`,
`admin-communities-delete-busy`, `admin-communities-delete-refused`, `admin-communities-read-only`
(no delete permission), `admin-communities-locked` (no read permission), `admin-communities-phone`;
`admin-invites-loading`, `admin-invites-empty`, `admin-invites-failed`, `admin-invites-ready`
(active, expired, used up, disabled), `admin-invites-long` (40 invites, 6 communities each),
`admin-invites-create`, `admin-invites-create-invalid` (no community, max uses 0),
`admin-invites-create-busy`, `admin-invites-create-refused`, `admin-invites-copied`,
`admin-invites-delete-refused`, `admin-invites-limited` (read only), `admin-invites-phone`.

## Tests required

`search_emits_after_the_debounce`, `load_more_only_when_more`, `open_emits_the_row`,
`force_delete_needs_the_typed_name`, `force_delete_disabled_without_the_permission`,
`create_needs_a_community`, `create_sends_the_draft`, `copy_link_uses_the_base`,
`delete_confirm_sends_delete`, `controls_follow_the_caps`.

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/ua4-admin-communities-invites.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua4-admin-communities-invites.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/ua4-admin-communities-invites.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/admin/(communities|invites)/.*|rigs/shot/scripts/ua4-admin-communities-invites\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
