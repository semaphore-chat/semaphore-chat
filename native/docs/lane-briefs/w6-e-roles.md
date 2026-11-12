# W6-E: instance roles

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core list, create, edit and delete instance roles and list a role's users, saying which roles this user may change and which actions they may grant; make the fake server keep real instance roles and assignments (which every other W6 fake route's permission check uses); with the HTTP calls and tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/instance_admin/roles.rs`
- `crates/semaphore-core/tests/w6_roles.rs` (new) and `crates/semaphore-core/tests/common/w6_roles.rs`
- `crates/semaphore-net/src/backend/instance_roles.rs`
- `crates/semaphore-net/tests/w6_roles.rs` (new)
- `crates/semaphore-fake-server/src/http/instance_roles.rs`, `crates/semaphore-fake-server/src/w6/roles.rs`
- `crates/semaphore-fake-server/tests/w6_roles.rs` (new)

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

### Query ids and keys

| const | id | key | view |
|---|---|---|---|
| `ROLES` | `rolesControllerGetInstanceRoles` | `keys::op(ROLES)` | `ViewKey::InstanceRoles` |
| `ROLE_USERS` | `rolesControllerGetInstanceRoleUsers` | `keys::scoped(ROLE_USERS, role_id)` | `ViewKey::InstanceRoleUsers { role_id }` |

`RolesValue`: `Roles(Vec<wire::RoleDto>)`, `RoleUsers(Vec<wire::RoleUserDto>)`.

### Operations

| operationId | HTTP | generated client fn | trait method (`backend/instance_roles.rs`) |
|---|---|---|---|
| RolesController_getInstanceRoles | GET /api/roles/instance/all | `roles_controller_get_instance_roles()` | -> `Vec<RoleDto>` |
| RolesController_createInstanceRole | POST /api/roles/instance | `roles_controller_create_instance_role(&body)` | `(body: CreateRoleDto)` -> `RoleDto` |
| RolesController_updateInstanceRole | PUT /api/roles/instance/{roleId} | `roles_controller_update_instance_role(role_id, &body)` | `(role_id, body: UpdateRoleDto)` -> `RoleDto` |
| RolesController_deleteInstanceRole | DELETE /api/roles/instance/{roleId} (204) | `roles_controller_delete_instance_role(role_id)` | `(role_id)` -> `()` |
| RolesController_getInstanceRoleUsers | GET /api/roles/instance/{roleId}/users | `roles_controller_get_instance_role_users(role_id)` | -> `Vec<RoleUserDto>` |

`CreateRoleDto.name` is a constrained newtype (`CreateRoleDtoName`, built with `try_from(String)`;
it fails for an empty string or one over 50 characters): validate before building it and refuse with
`w5a_refuse`, never `unwrap`. `RoleDto.actions` is `Vec<RbacAction>` (a tolerant enum: an unknown
name is `RbacAction::Unknown(name)`); convert with `action.as_str().into_owned()` and back with
`serde_json::from_value(serde_json::Value::String(name))`.

### Core commands (frozen in `roles.rs`)

- `instance_roles() -> InstanceRolesView`: rows `RoleDto` -> `InstanceRoleRow` (`actions` as wire
  names, `editable` = `role_editable(authority.full, &authority.held, &actions)`, `deletable` =
  `editable && name != "Instance Admin"`), sorted by `position` then name. `grantable`: all of
  `INSTANCE_ADMIN_ACTIONS` with full authority, else those of them I hold. `state.instance_authority()`
  may be `None` (my instance roles not read yet): then `editable`/`deletable` are false and
  `grantable` is empty, and calling `self.instance_permissions()` once makes core read them.
- `pub fn role_editable(full_authority, held, role_actions) -> bool`: `full_authority ||` every
  action of `role_actions` is in `held`.
- `create_instance_role(draft) -> Result<String>` (op `CreateInstanceRole` on `ViewKey::InstanceRoles`,
  target None) and `update_instance_role(role_id, draft)` (op `UpdateInstanceRole`, target the role):
  refuse before sending, in this order, with these messages (the backend's,
  `backend/src/roles/dto/create-role.dto.ts` lines 24-35 and `instance-roles.service.ts`):

  | check | message |
  |---|---|
  | name trimmed is empty | "Role name must not be empty" |
  | name longer than 50 characters (count `chars()`) | "Role name must not exceed 50 characters" |
  | no actions | "Role must have at least one permission" |
  | an action not in `INSTANCE_ADMIN_ACTIONS` | "Actions not valid for instance roles: A, B" (in the draft's order) |
  | an action not in `grantable` | "Cannot grant permissions you do not have: A, B" |
  | update only: the role is default and the name changes | "Cannot rename a default role" |
  | update only: the role isn't `editable` | "Cannot grant permissions you do not have: <its actions I lack>" |

  Send the trimmed name. Create: on success append the answer to `ROLES`, return its id. Update:
  replace the role in `ROLES` with the answer. No optimistic update.
- `delete_instance_role(role_id)`: op `DeleteInstanceRole`; refuse when not `deletable` ("Cannot
  delete the default Instance Admin role" for that one, else "Cannot grant permissions you do not
  have: ..."); remove at once and put back at its index on refusal (W5-A's `delete_invite` pattern).
- `instance_role_users(role_id) -> InstanceRoleUsersView`: `RoleUserDto` -> `UserView`
  (`avatar_file_id` None).

Rules table (one test): `role_editable` with full authority; holding all; holding all but one; an
empty role; a role with an unknown action. Validation table (one test): each row of the table above
plus a valid create and update (check the recorded body).

### Fake server (`http/instance_roles.rs`, `w6/roles.rs`)

`w6/roles.rs` already has `holds`, `held` and `instance_roles_json` (the freeze's stand-ins: owner
only, and a default "Member" role with `CREATE_COMMUNITY` for everyone). Make them real:

- State: roles (`RoleDto`) and assignments (role id -> user ids). Seed two default roles from
  `backend/src/roles/default-roles.config.ts`: "Instance Admin" (position 10, the 12 actions of
  `INSTANCE_ADMIN_ACTIONS`, isDefault true) and "Community Creator" (position 20, isDefault true,
  actions: CREATE_COMMUNITY, READ_COMMUNITY, CREATE_CHANNEL, UPDATE_CHANNEL, MANAGE_CHANNEL_PERMISSIONS, MANAGE_WEBHOOKS, DELETE_CHANNEL, READ_CHANNEL, JOIN_CHANNEL, SPEAK, VIDEO, SCREEN_SHARE, CREATE_MEMBER, UPDATE_MEMBER, DELETE_MEMBER, READ_MEMBER, CREATE_MESSAGE, ATTACH_FILES, DELETE_MESSAGE, READ_MESSAGE, CREATE_ROLE, UPDATE_ROLE, DELETE_ROLE, READ_ROLE, CREATE_INVITE, DELETE_INVITE, CREATE_ALIAS_GROUP, UPDATE_ALIAS_GROUP, DELETE_ALIAS_GROUP, READ_ALIAS_GROUP, CREATE_ALIAS_GROUP_MEMBER, DELETE_ALIAS_GROUP_MEMBER, READ_ALIAS_GROUP_MEMBER, UPDATE_ALIAS_GROUP_MEMBER, MANAGE_EMOJIS, CREATE_REACTION, DELETE_REACTION, CAPTURE_REPLAY, KICK_USER, TIMEOUT_USER, UNBAN_USER, PIN_MESSAGE, UNPIN_MESSAGE, DELETE_ANY_MESSAGE, VIEW_BAN_LIST, VIEW_MODERATION_LOGS, MUTE_PARTICIPANT, CREATE_SOUNDBOARD_SOUND, DELETE_SOUNDBOARD_SOUND, READ_SOUNDBOARD_SOUND). Ids: `crate::rbac::role_uuid("instance-admin")` and
  `crate::rbac::role_uuid("community-creator")`. Assignments: none, unless the scenario's
  `instanceRoleAssignments` extra key (`{ "<role name>": ["<user id>", ..] }`) says so.
- `held(inner, user)` = the union of the user's assigned roles' actions, plus `CREATE_COMMUNITY`
  (the fake's default role, kept so earlier tests stay green). `holds` = owner, or `held` contains it.
- `instance_roles_json(inner, user)`: the user's assigned roles as `RoleDto`s, plus the existing
  default "Member" role (keep it first, unchanged).

Routes. Guards via `holds` on the signed-in user (the owner passes), else 403 FORBIDDEN "Forbidden
resource". Full authority = owner, or `held` contains all 12 admin actions.

| route | action | behaviour (backend `backend/src/roles/instance-roles.service.ts` at 3b1e2684) |
|---|---|---|
| GET /api/roles/instance/all | READ_INSTANCE_SETTINGS | the roles, by position |
| POST /api/roles/instance | UPDATE_INSTANCE_SETTINGS | DTO checks first (400 VALIDATION_FAILED with the messages in the validation table); an action outside the 12: 400 BAD_REQUEST "Actions not valid for instance roles: ..." (:261); below full authority an action the caller lacks: 403 "Cannot grant permissions you do not have: ..." (:114); a name already used: 409 CONFLICT `Role with name "<name>" already exists` (:274); else 200 the new role (position: the highest + 10) |
| PUT /api/roles/instance/{roleId} | UPDATE_INSTANCE_SETTINGS | unknown 404 NOT_FOUND "Role with ID <id> not found" (:313); default role renamed 400 BAD_REQUEST "Cannot rename a default role" (:322); invalid actions 400 (:333); below full authority, the role's current actions and the new ones must all be held, else 403 (:114); name taken by another role 409 (:358); 200 the role |
| DELETE /api/roles/instance/{roleId} | UPDATE_INSTANCE_SETTINGS | unknown 404 (:403); "Instance Admin" 400 BAD_REQUEST "Cannot delete the default Instance Admin role" (:411); with assignments 400 BAD_REQUEST "Cannot delete role with <n> assigned user(s). Remove all role assignments first." (:417); below full authority holding less than the role 403 (:114); 204 |
| GET /api/roles/instance/{roleId}/users | READ_USER | unknown role 404; `[{userId, username, displayName}]` |
| POST /api/roles/instance/{roleId}/assign `{userId}` | UPDATE_USER | unknown role 404 "Role not found" (:452); already assigned 409 CONFLICT "User already has this instance role" (:465); below full authority holding less than the role 403 (:114); 204 |
| DELETE /api/roles/instance/{roleId}/users/{userId} | UPDATE_USER | not assigned 404 "User role assignment not found" (:504); 403 as for assign; 204 |
| GET /api/roles/user/{userId}/instance | READ_USER | `instance_roles_json(inner, userId)` |

Map each in `operation_id()` (`RolesController_getInstanceRoles`, `..._createInstanceRole`,
`..._updateInstanceRole`, `..._deleteInstanceRole`, `..._getInstanceRoleUsers`,
`..._assignInstanceRole`, `..._removeInstanceRole`, `..._getUserInstanceRoles`). Axum: a path segment
at the same place must have the same name in every route (`{roleId}`).

## Tests required

Core: `role_editable_table`, `validation_table`, `the_list_maps_and_sorts_roles_and_says_what_is_grantable`
(owner; a non-owner with some actions; my roles unknown), `create_appends_and_update_replaces`,
`delete_goes_at_once_and_comes_back_when_refused`, `the_instance_admin_role_is_not_deletable`,
`a_refused_create_shows_the_servers_message`, `an_answer_after_sign_out_changes_nothing`,
`a_new_connection_reads_the_roles_again`.
Wire: `the_owner_creates_edits_and_deletes_an_instance_role`, `assigning_a_role_gives_its_actions`
(assign "Instance Admin" to `pri`, sign in as `pri`: `instance_permissions().admin.users_read` is true),
`a_plain_user_is_refused`.
Fake server: decodes; each refusal in the table; assignment shows in `GET /roles/user/{id}/instance`
and in `GET /roles/my/instance` for that user.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w6_roles
scripts/in-image.sh cargo test --locked -p semaphore-net --test w6_roles
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w6_roles
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/commands/instance_admin/roles\.rs|crates/semaphore-core/tests/(w6_roles|common/w6_roles)\.rs|crates/semaphore-net/src/backend/instance_roles\.rs|crates/semaphore-net/tests/w6_roles\.rs|crates/semaphore-fake-server/src/(http/instance_roles|w6/roles)\.rs|crates/semaphore-fake-server/tests/w6_roles\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
