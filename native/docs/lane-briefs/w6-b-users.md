# W6-B: users administration

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core list, page and filter the instance's users, show one user and their instance roles, and change a user (owner role, ban, unban, password, delete, instance role assignment), with each row saying which actions are allowed and why not; with the HTTP calls, the fake server's routes and tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/instance_admin/users.rs`
- `crates/semaphore-core/tests/w6_users.rs` (new) and `crates/semaphore-core/tests/common/w6_users.rs`
- `crates/semaphore-net/src/backend/admin_users.rs`
- `crates/semaphore-net/tests/w6_users.rs` (new)
- `crates/semaphore-fake-server/src/http/admin_users.rs`, `crates/semaphore-fake-server/src/w6/users.rs`
- `crates/semaphore-fake-server/tests/w6_users.rs` (new)

## Where you are

- Repository: the git worktree you were started in (branch `native/w6-core` or a branch made from
  it). The Rust workspace is `native/`. Every path below is relative to `native/` unless it starts
  with `backend/` or `frontend/` (those are the TypeScript server and web client, at the repo root).
- The backend this lane mirrors is the one the API contract was pinned from: commit `3b1e2684`.
  This worktree's `backend/` directory may be older, so read backend files with
  `git show 3b1e2684:backend/src/<path>` (line numbers below are at that commit).
- Crates you touch: `semaphore-core` (all app logic; no UI, no OS, no C), `semaphore-net` (the real
  HTTP client implementing core's `Backend` traits), `semaphore-fake-server` (an axum server that
  imitates the real backend for tests), and their `tests/` directories.
- Generated code you call, never edit: `crates/semaphore-wire/src/generated.rs` (wire types, under
  `semaphore_wire::types` and `semaphore_wire::enums`) and `crates/semaphore-api/src/generated.rs`
  (the REST client; each operation is `client.<snake_case_operation_id>(..)`).

## Hard rules

1. Never run `cargo`, `node`, `pnpm` or `npm` on the host. Run everything from `native/` through the
   build image: `scripts/in-image.sh <command>`, e.g. `scripts/in-image.sh cargo test -p semaphore-core --test w6_instance`.
2. No `docker compose`. No new dependencies (no `Cargo.toml` changes). No `git stash`. Don't commit,
   don't push: leave your changes in the working tree.
3. If a command modifies `native/results/phase0/native-shell.json`, restore it with
   `git checkout -- native/results/phase0/native-shell.json`.
4. Edit only the files listed under "Files you own". The file-ownership check at the end must print
   nothing. If you believe you need another file, stop and say so in your report instead.
5. Core stays UI-free and must still compile for Android and iOS (no new crates, no OS calls).
6. Every async command writes its result through the session check: start with `w5a_begin` (which
   records the session epoch) and finish with `w5a_settle` (which drops the answer if the user
   signed out meanwhile). Never write state after an `.await` without that check.
7. Every change has its own op kind on its view (`OpKey::new(view, AdminActionKind::X, target)`),
   so two different changes on one view never hide each other's state.
8. A change shown before the server answers (an optimistic update) is undone on refusal, putting
   back only the fields it wrote, and only if nothing else changed them since.
9. Keep behaviour exactly as described here. Where this brief says "copy the backend", copy the
   backend's status code, `ErrorCode` and message text.
10. Stop when the finish-line commands pass. Don't add features, refactors or docs beyond this brief.

## How the pieces fit (read these first, in this order)

- `crates/semaphore-core/src/commands/instance_admin/mod.rs`: the W6 hub (frozen; don't edit). It
  calls your lane file's `view_for`, `key_for`, `w6_<lane>_query_changed`, `w6_<lane>_event`,
  `w6_<lane>_fetch` and reads `keys::RECONNECT`. It also gives you `State::instance_authority()`
  (who I am on the instance: `owner`, `full`, `held` actions) and `State::instance_admin_caps()`.
  (W7-A's hub is its own file, `commands/gifs.rs`.)
- `crates/semaphore-core/src/commands/community_admin.rs`: wave 5's equivalent of your lane file,
  the pattern to copy. Look at: `admin_keys` (query ids), `W5aValue` (cached values), `view_for` /
  `key_for`, the typed accessor macro (`w5a_invites` / `w5a_invites_edit`), `w5a_ensure` (read a
  view's query, again after 30 s: reuse it), `w5a_reread` (read again after my own change: reuse
  it), `w5a_query_changed`, `w5a_fetch_value`, and the op machinery `w5a_begin`, `w5a_settle`,
  `w5a_refuse`, `w5a_op` (all reusable from your file: they're keyed by `ViewKey`).
- `crates/semaphore-core/src/commands/community_assets.rs`: `community_invites`, `create_invite`,
  `delete_invite` are the closest complete examples of a view read, a create and an optimistic
  delete with rollback.
- `crates/semaphore-core/src/commands/moderation.rs` `more_moderation_log`: an example of loading a
  next page with a "loading more" flag.
- Your model types are already in `crates/semaphore-core/src/model/instance_admin.rs` (or
  `model/gifs.rs`) and must not change. `AdminOp`, `AdminActionKind` are in `model/admin.rs`.
- Your backend trait is already declared in `crates/semaphore-core/src/backend/<file>.rs` with
  "unsupported" defaults; you don't change its signatures. You implement it in
  `crates/semaphore-net/src/backend/<file>.rs`: copy `crates/semaphore-net/src/backend/community_admin.rs`
  (each method is one `rpc!(self, c => c.<operation>(..))`).
- Core tests: `crates/semaphore-core/tests/w5a.rs` with its fake in `tests/common/w5a.rs`. The
  `FakeBackend` (in `tests/common/mod.rs`, which you don't edit) has a generic script, `fake.w4`
  (`tests/common/w2.rs` `W2Fakes`): `answer(op, json)` sets what a call answers (decoded into the
  wire type), `fail_next(op, BackendError)` fails the next call, `hold(op)` holds the next call until
  the returned sender fires (to test a sign-out or a second change mid-flight), and `calls()` lists
  every call as `"op arg1 arg2"`. Your file `tests/common/<lane>.rs` already has
  `impl <Trait> for FakeBackend {}`: implement each method as `self.w4.run("<op>", &[&args..]).await`
  (and `unit(..)` style, as in `common/w5a.rs`, for calls that answer nothing). Prefix your op names
  with your lane (`w6a_settings`, `w6b_users`, ...) so they can't clash. Put your JSON builders
  (`admin_user_json(..)` etc.) in the same file. The rig a test starts from is built the way
  `tests/w5a.rs` does it: `Rig::new()` then `.signed_in().await`, `rig.core` (the `Core`),
  `rig.backend` (the `FakeBackend`), `rig.core.run_until_idle().await` to let queued reads finish.
  To be the instance owner, copy `owner_with` from `tests/w5b.rs` (it answers `"profile"` with
  `"role": "OWNER"` on `rig.backend.w3` before signing in). To hold instance roles as a non-owner,
  answer `rig.backend.w3.answer("instance_roles", json!({"userId": ME, "resourceId": null,
  "resourceType": "INSTANCE", "roles": [{"id": "r1", "name": "Admin", "position": 1,
  "isDefault": false, "createdAt": "2026-11-01T00:00:00Z", "actions": [..wire names..]}]}))` and
  call `rig.core.instance_permissions()` once so core reads them (see `tests/w3.rs` around line 940).
- Wire tests (core on the real HTTP client and socket against the fake server):
  `crates/semaphore-net/tests/w5a.rs` (`server()`, `signed_in(..)`, `until(..)`).
- Fake server: routes in `crates/semaphore-fake-server/src/http/community_admin.rs`, state in
  `src/admin.rs`, permission helpers in `src/rbac.rs` (`refuse`, `respond`, `guard_refusal`,
  `is_owner`), JSON and errors via `inner.error(status, code, message, false)` and
  `json_response`. Your route file has an empty `routes()` and `operation_id()`; your state module
  has an empty struct and `control()`; both are already registered. Instance permission checks:
  `crate::w6::allows(&inner, &user_id, "ACTION_NAME")` (the owner always passes; others need the
  action in their instance roles). Fake-server route tests: `crates/semaphore-fake-server/tests/w5a.rs`
  (decode every answer into its generated wire type: that is the contract check).
- Scenario data: the fake server starts from `fixtures/scenarios/showcase.json`. There, the signed-in
  user `me` (`alexk`) is the instance OWNER and the other users are `USER`. Tests sign in as another
  user with `FakeServer::sign_in_as(username, user_id)`. A fake-server "control" (a test-only switch
  your state module answers in `control()`) is `POST <base>/__control/<name>` with a JSON body. Extra scenario keys you may read are in
  `inner.scenario.extra` (a map of JSON values); you may not edit the fixtures.
- Status codes the backend uses: a DTO that fails validation is 400 `VALIDATION_FAILED`; a
  `BadRequestException` is 400 `BAD_REQUEST`; a malformed UUID path parameter is 400 `BAD_REQUEST`;
  a missing RBAC action is 403 `FORBIDDEN` "Forbidden resource"; `ForbiddenException` is 403
  `FORBIDDEN`; `NotFoundException` 404 `NOT_FOUND`; `ConflictException` 409 `CONFLICT`;
  `ServiceUnavailableException` 503 `UNAVAILABLE`.

## Real-time

No socket event covers this lane's data. A view is read when shown, again when shown and older than
30 s (`w5a_ensure(&key, now, true)`), again right after this user's own change (`w5a_reread`), and
again on a new connection (list the query ids in `keys::RECONNECT`; the hub already chains them).

## What to build

### Query ids (in `users.rs` `keys`) and keys

| const | id | key | view |
|---|---|---|---|
| `USERS` | `userControllerFindAllUsersAdmin` | `QueryKey::new(&[USERS, search, banned, owners])`, where `banned`/`owners` are `"-"` for `None`, `"true"`, `"false"` | `ViewKey::AdminUsers { query }` |
| `USER` | `userControllerGetUserByIdAdmin` | `keys::scoped(USER, user_id)` | `ViewKey::AdminUser { user_id }` |
| `USER_ROLES` | `rolesControllerGetUserInstanceRoles` | `keys::scoped(USER_ROLES, user_id)` | `ViewKey::AdminUserRoles { user_id }` |

`UsersValue` variants: `Users { rows: Vec<wire::AdminUserEntity>, next: Option<String> }`,
`User(wire::AdminUserEntity)`, `UserRoles(wire::UserRolesResponseDto)`. Your `UsersState` holds
which lists are loading their next page (`HashSet<QueryKey>`).

### Operations

| operationId | HTTP | generated client fn | trait method (`backend/admin_users.rs`) |
|---|---|---|---|
| UserController_findAllUsersAdmin | GET /api/users/admin/list?limit&continuationToken&banned&role&search | `user_controller_find_all_users_admin(banned, continuation_token, limit, role, search)` | `(banned: Option<BooleanString>, continuation_token: Option<String>, limit: Option<NonZeroU64>, role: Option<InstanceRole>, search: Option<String>)` |
| UserController_getUserByIdAdmin | GET /api/users/admin/{id} | `user_controller_get_user_by_id_admin(id)` | `(id: String)` |
| RolesController_getUserInstanceRoles | GET /api/roles/user/{userId}/instance | `roles_controller_get_user_instance_roles(user_id)` | `(user_id: String)` |
| UserController_updateUserRole | PATCH /api/users/admin/{id}/role `{role}` | `user_controller_update_user_role(id, &body)` | `(id, body: UpdateUserRoleDto)` |
| UserController_setBanStatus | PATCH /api/users/admin/{id}/ban `{banned}` | `user_controller_set_ban_status(id, &body)` | `(id, body: SetUserBanStatusDto)` |
| UserController_setUserPassword | PATCH /api/users/admin/{id}/password `{password}` | `user_controller_set_user_password(id, &body)` | `(id, body: SetUserPasswordDto)` |
| UserController_deleteUser | DELETE /api/users/admin/{id} | `user_controller_delete_user(id)` | `(id)` -> `SuccessResponseDto` |
| RolesController_assignInstanceRole | POST /api/roles/instance/{roleId}/assign `{userId}` (204) | `roles_controller_assign_instance_role(role_id, &body)` | `(role_id, body: AssignInstanceRoleDto)` |
| RolesController_removeInstanceRole | DELETE /api/roles/instance/{roleId}/users/{userId} (204) | `roles_controller_remove_instance_role(role_id, user_id)` | `(role_id, user_id)` |

(`BooleanString`, `InstanceRole` are in `semaphore_wire::enums`; `NonZeroU64` is `std::num::NonZeroU64`.)
The fake routes for the last three (and `GET /roles/user/{userId}/instance`) are W6-E's, not yours:
implement them in core and `semaphore-net`, test them in core with FakeBackend only.

### Core commands (frozen signatures in `users.rs`)

- `admin_users(query) -> AdminUsersView`: `w5a_ensure(key, now, true)`; first page with `limit` 50,
  `banned` from `query.banned` (`BooleanString::True`/`False`), `role` from `query.owners`
  (`Some(true)` -> `InstanceRole::Owner`, `Some(false)` -> `InstanceRole::User`), `search` omitted
  when empty. Rows map `AdminUserEntity` -> `AdminUserRow` (`user` = `UserView { id, username,
  display_name, avatar_file_id: avatar_url }`, `email`, `is_owner` = role is OWNER, `banned`,
  `banned_at_ms`, `created_at_ms`, `last_seen_ms`, storage bytes (negative -> 0), `actions` =
  `user_actions(actor, target)` with the target's actions from a cached `USER_ROLES` value if any).
  `more` = `next.is_some()`, `loading_more` from your state, `op` = `w5a_op(&ViewKey::AdminUsers{query})`.
- `load_more_admin_users(query)`: nothing to do (Ok) when there is no cached list, no `next`, or a
  load is already running. Otherwise mark loading, fetch with `continuation_token = next`, then
  (only if the session epoch is unchanged) append the rows whose id isn't already in the list, set
  `next` from the answer, clear loading, `view_changed`. A failure clears loading and returns the error.
- `admin_user(user_id) -> AdminUserView`, `admin_user_roles(user_id) -> AdminUserRolesView`: reads.
  `held` = the user's instance roles (`id`, `name`); leave `available` empty: it needs W6-E's roles
  list, which another lane builds at the same time (the app wiring fills it later). Reading
  `admin_user_roles` also ensures `admin_user`.
- Changes. A change doesn't know which list it was started from, so its op is on
  `ViewKey::AdminUser { user_id }` for `SetOwner`, `BanUser`, `UnbanUser`,
  `SetUserPassword`, `DeleteUser` (target: `Some(user_id)`), and `ViewKey::AdminUserRoles { user_id }`
  for `AssignInstanceRole` / `UnassignInstanceRole` (target: `Some(role_id)`). Before sending, refuse
  with `w5a_refuse` when `user_actions` says no (message: the `AdminNotAllowed` as text, see below).
  On success: replace the user in the `USER` value and in every cached `USERS` list
  (`state.cache` entries whose key op is `USERS`) from the answer; for delete, remove it from every
  list and drop the `USER` value. For assign/unassign, `w5a_reread` the `USER_ROLES` key. For
  `set_user_owner` on myself, also `w5a_reread(keys::op(keys::INSTANCE_ROLES))` and the profile
  (`keys::op(keys::PROFILE)`). Ban and unban show at once (optimistic `banned` flip on the user's
  rows) and put the old `banned` back on refusal if it's still the value written.
  `reset_user_password` refuses before sending when the password is shorter than 8 or longer than
  128 characters ("Password must be at least 8 characters" / "Password must be at most 128 characters").

### Row permissions (`pub fn user_actions(actor, target) -> AdminUserActions`: test it table-driven)

`actor.caps` is `InstanceAdminCaps`, `actor.held` my instance actions; `me = actor.id == target.id`;
`rank` = `!actor.caps.full_authority && !me && target.actions` is `Some(list)` containing any action
not in `actor.held` (unknown target actions, `None`, never block: the server decides). Check in this
order, first match wins; `None` means allowed:

| action | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| ban | `!caps.users_ban` -> NoPermission | `me` -> Myself | `target.is_owner` -> Owner | `rank` -> Rank |
| unban | `!caps.users_ban` -> NoPermission | `me` -> Myself | `target.is_owner` -> Owner | `rank` -> Rank |
| delete | `!caps.users_delete` -> NoPermission | `me` -> Myself | `target.is_owner` -> Owner | `rank` -> Rank |
| reset_password | `!caps.users_update` -> NoPermission | `target.is_owner && !me && !caps.is_owner` -> Owner | `rank` -> Rank | |
| set_owner | `!caps.users_update` -> NoPermission | `!caps.is_owner` -> OnlyOwner | | |
| edit_roles | `!caps.users_update` -> NoPermission | | | |
| set_quota | `!caps.storage` -> NoPermission | | | |

`LastOwner` is never computed client-side (the server says it). Text for a refusal before sending:
Myself "That's you", Owner "That's an instance owner", OnlyOwner "Only an instance owner can grant
or remove the owner role", Rank "They hold permissions you don't have", NoPermission "You don't have
permission to do that".

Required table rows (one test): owner actor on a USER (all None); owner actor on themselves (ban,
unban, delete Myself; reset_password, set_owner None); full-authority non-owner on an owner (ban,
delete Owner; reset_password Owner; set_owner OnlyOwner); a non-full actor holding READ_USER,
UPDATE_USER, BAN_USER on a target whose actions are `Some([READ_USER])` (allowed) and
`Some([READ_USER, DELETE_USER])` (Rank) and `None` (allowed); an actor with no caps (all
NoPermission); a full actor on a target holding more than they do (not Rank).

Paging table (one test): first page with `next` None (`more` false); two pages appended in order;
a second page repeating an id (kept once); `load_more` while loading (one call only); a different
query is its own list (two keys, two calls); a failed page leaves rows and `more` unchanged.

### Fake server (`http/admin_users.rs`, `w6/users.rs`)

Users: the scenario's (`inner.scenario.me` and `inner.scenario.users`) plus registered ones, each read
through `inner.user_entity(id)` (in `src/accounts.rs`, an `impl Inner` method; profile edits and
registrations live in `inner.accounts`'s `users` map). As `AdminUserEntity`: `email`
`"<username>@example.invalid"`, `verified` true, `createdAt` the scenario epoch, `banned`/`bannedAt`/
`bannedById` from your state, `storageQuotaBytes` 53687091200, `storageUsedBytes` 0. Your state keeps
banned users, deleted users and changed roles. Guards: `crate::w6::allows(&inner, &actor, ACTION)`,
else 403 FORBIDDEN "Forbidden resource". Rank: below full authority (`crate::w6::roles::held` holds
all 12 admin actions, or the actor is the owner) the actor must hold every action the target holds,
else 403 "Cannot manage a user who holds permissions you do not have"
(`backend/src/roles/instance-roles.service.ts:137`).

| route | action | behaviour (backend `backend/src/user/user.service.ts` unless said) |
|---|---|---|
| GET /api/users/admin/list | READ_USER | `limit` 1..100 (else 400 VALIDATION_FAILED), default 50; filters `banned` "true"/"false", `role` OWNER/USER, `search` case-insensitive in username, displayName or email; order createdAt desc then id asc; `continuationToken` = the last row's id of the previous page: the next page starts after it (unknown id: empty page); `continuationToken` in the answer only when more remain; deleted users never listed |
| GET /api/users/admin/{id} | READ_USER | malformed UUID 400 BAD_REQUEST; unknown 404 NOT_FOUND "User not found" (controller :179) |
| PATCH /api/users/admin/{id}/role | UPDATE_USER | unknown 404 "User not found" (:496); unchanged ownership: 200 the user; else only an owner actor (403 "Only an instance owner can grant or remove the owner role", :506); demoting the last owner 403 "Cannot demote the last owner. Promote another user first." (:520); store the new role by writing the changed `UserEntity` into `inner.accounts`'s `users` map so the rest of the fake sees it; 200 the user |
| PATCH /api/users/admin/{id}/ban | BAN_USER | 404 (:555); self 403 "Cannot ban yourself" (:560); owner 403 "Cannot ban an instance owner" (:565); rank; ban: set banned, bannedAt now, bannedById actor, revoke the user's live sessions (`Accounts::live_sessions_of` + `Accounts::revoke`) and send their sockets `sessionTerminated {"reason": "ACCOUNT_BANNED"}` (`inner.emit_to_tokens`); unban clears the three fields; 200 the user |
| PATCH /api/users/admin/{id}/password | UPDATE_USER | password 8..128 else 400 VALIDATION_FAILED "Password must be at least 8 characters" / "... at most 128 characters"; 404 (:652); owner target by a non-owner other than themselves 403 "Only an instance owner can reset another owner's password" (:663); rank (not for themselves); revoke all their sessions, sockets get `sessionTerminated {"reason": "PASSWORD_CHANGED"}`; 200 the user |
| DELETE /api/users/admin/{id} | DELETE_USER | 404 (:693); self 403 "Cannot delete your own account through admin panel" (:698); owner 403 "Cannot delete an instance owner" (:705); rank; mark deleted, revoke sessions, sockets get `sessionTerminated {"reason": "ACCOUNT_DELETED"}`; 200 `{"success": true}` |

Lock order: take `inner.accounts` before your own `w6_users` lock, never the other way, and never hold
yours together with `data`, `admin` or `rbac`.

## Tests required

Core (`tests/w6_users.rs`): `user_actions_table`, `paging_table`, `the_list_maps_every_field`,
`the_filters_reach_the_request` (banned, owners, search: check the recorded call),
`ban_shows_at_once_and_goes_back_when_refused`, `a_refusal_before_sending_records_no_call` (each
`AdminNotAllowed`), `set_owner_on_myself_rereads_my_permissions`, `delete_removes_the_user_from_every_list`,
`a_short_password_is_refused_before_sending`, `assign_and_unassign_reread_the_users_roles`,
`an_answer_after_sign_out_changes_nothing`, `a_new_connection_reads_the_list_again`.

Wire (`semaphore-net/tests/w6_users.rs`): `the_owner_lists_searches_and_pages_users` (limit by
calling `load_more` until `more` is false), `the_owner_bans_and_unbans_a_user` (the banned user's
second client is signed out), `the_owner_resets_a_password`, `the_owner_deletes_a_user`,
`a_plain_user_is_refused`.

Fake server (`semaphore-fake-server/tests/w6_users.rs`): every route's answer decodes as its wire type;
each refusal in the table above with its status, code and message; paging with `limit` 2 over the
showcase users visits every user once.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w6_users
scripts/in-image.sh cargo test --locked -p semaphore-net --test w6_users
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w6_users
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/commands/instance_admin/users\.rs|crates/semaphore-core/tests/(w6_users|common/w6_users)\.rs|crates/semaphore-net/src/backend/admin_users\.rs|crates/semaphore-net/tests/w6_users\.rs|crates/semaphore-fake-server/src/(http/admin_users|w6/users)\.rs|crates/semaphore-fake-server/tests/w6_users\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
