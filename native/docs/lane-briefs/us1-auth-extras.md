# US1: connect notice, register modes, joining an invite

A lane brief for a reader who has never seen this repository. It is one lane of the native Rust
desktop client's remaining UI work ("UI freeze and lanes" in `native/docs/parity-plan.md`). Time
matters: do what this brief says, check it, and stop.

## Goal

Finish three signed-out screens from their frozen API: the connect step's "set this server up in a browser" notice, the register form following the server's registration mode, and the invite page's "Join with your account" for someone signed in, with its result; with stories and tests.

## Files you own

You may create or edit only these (paths relative to `native/`):

- `crates/semaphore-ui/src/auth/mod.rs`, `crates/semaphore-ui/src/auth/register.rs`, `crates/semaphore-ui/src/auth/invite.rs`, `crates/semaphore-ui/src/auth/tests.rs`
- `rigs/shot/scripts/us1-auth-extras.steps`

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

These are edits of existing screens: keep their look; add only what is described.

1. **Connect notice** (`auth/mod.rs`, `AuthScreen::set_setup_needed(Option<String>)`, frozen). Store
   it; while `Some(url)`, the connect step (`AuthStep::ServerUrl`) shows an `Alert` (info): "This
   server isn't set up yet. Set it up in a browser first, then sign in here." with a button "Open
   in browser" (`auth-setup-open`) that emits `AuthEvent::OpenInBrowser { url }`, and the sign-in
   form isn't offered for that server. The web's equivalent is its onboarding page
   (`frontend/src/pages/OnboardingPage.tsx`); the owner decided the native app doesn't run setup.
2. **Register modes** (`auth/register.rs` + `AuthScreen::set_register_requirements`, frozen). Read
   `RegisterRequirements { mode, can_register, invite_required }`: `can_register` false (Closed):
   the Register link on sign-in is replaced by "Registration is closed on this server"; the form, if
   open, says so and offers Sign in. `invite_required`: the invite code field is required (label
   "Invite code", inline "An invite code is required"); otherwise it's optional ("Invite code
   (optional)"). `RegisterEvent::Submit` unchanged.
3. **Joining an invite** (`auth/invite.rs`, `InviteScreen::set_join(InviteJoinState)` and
   `InviteJoinState`, frozen). Signed in (`set_signed_in(true)`) with a usable preview: a "Join with
   your account" button (`invite-join`) emitting the existing `InviteEvent::Accept { code }`.
   `Joining`: spinner on the button. `Joined(InviteJoin)`: "You joined" with the `joined`
   communities (`JoinedCommunity`: id, name) and, if any, "Not joined" with each `skipped` one's name
   and its reason (`InviteSkipReason`: AlreadyMember "You're already a member", Banned "You're banned
   from it", Other "Couldn't join"); an empty result says "You're already in every community this
   invite adds". `Failed(message)`: the message under the button. The preview's
   `InvitePreviewView.reason` (an `INVITE_*` code: NOT_FOUND "This invite doesn't exist",
   EXPIRED "This invite has expired", EXHAUSTED "This invite has been used up", DISABLED "This invite
   has been disabled"; any other code: the server's message) shows instead of the generic "can't be
   used" line.

## Stories (exact names)

`auth-connect-needs-setup`, `auth-connect-needs-setup-phone`, `auth-register-closed`,
`auth-register-invite-required`, `auth-register-open`, `auth-signin-registration-closed`,
`invite-signed-in`, `invite-joining`, `invite-joined`, `invite-joined-some-skipped`,
`invite-joined-nothing-new`, `invite-join-failed`, `invite-expired`, `invite-exhausted`,
`invite-not-found`, `invite-disabled`, `invite-long-names` (100-character community names),
`invite-phone`.

## Tests required

`setup_notice_emits_open_in_browser`, `setup_notice_hides_sign_in`, `closed_registration_hides_register`,
`invite_code_required_only_when_required`, `join_button_only_signed_in`, `join_emits_accept`,
`joined_lists_joined_and_skipped_with_reasons`, `invite_reason_sentences` (each code).

UI tests go in a `tests.rs` inside your module (`#[cfg(test)] mod tests;`), using the window rig
`crate::dms::rig::{Rig, rig}` with `#[gpui_kit::test]`: build the component, `rig.click(cx,
"<element id>")`, then `assert_eq!(rig.events(), [...])`. Copy the shape of
`crates/semaphore-ui/src/community_settings/tests.rs` lines 688-720 (`overview`,
`update_sends_only_what_changed`) and 1080-1140 (`invites_rig` and its tests). Give every
clickable element a stable id (`"admin-users-ban"` style) so tests and slice steps can click it.

## Rendering and looking at it (required)

Add one `story <name> 1280 800 dark-blue-balanced` / `wait idle` / `shot <name>-desktop` block and
one `story <name> 390 844 light-blue-balanced` / `wait idle` / `shot <name>-phone` block per story
to `rigs/shot/scripts/us1-auth-extras.steps` (copy the format of `rigs/shot/scripts/w5-community.steps`).
Render them with:

```bash
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/us1-auth-extras.steps
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
scripts/in-image.sh rigs/shot/review.sh rigs/shot/scripts/us1-auth-extras.steps
git status --porcelain --untracked-files=all . | cut -c4- | sed 's#^native/##' | grep -vE '^(crates/semaphore-ui/src/auth/(mod|register|invite|tests)\.rs|rigs/shot/scripts/us1-auth-extras\.steps)$'
```

## Report (your final message)

1. What you built, file by file.
2. The last lines of each finish-line command.
3. For every rendered screenshot: its name and one line on what you saw in it, and what you fixed
   after looking.
4. Anything this brief got wrong, and any decision you had to make.
