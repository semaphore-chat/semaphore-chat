# W6-A: instance dashboard and settings

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core read the admin dashboard (instance stats, instance storage, LiveKit health and the attention items computed from them) and read and change the instance settings, over the real HTTP client, with the fake server serving the same routes, and prove it with tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/instance_admin/instance.rs`
- `crates/semaphore-core/tests/w6_instance.rs` (new) and `crates/semaphore-core/tests/common/w6_instance.rs`
- `crates/semaphore-net/src/backend/instance_admin.rs`
- `crates/semaphore-net/tests/w6_instance.rs` (new)
- `crates/semaphore-fake-server/src/http/instance_admin.rs`, `crates/semaphore-fake-server/src/w6/instance.rs`
- `crates/semaphore-fake-server/tests/w6_instance.rs` (new)

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

### Query ids (already in `instance.rs` `keys`)

| const | id | feeds view |
|---|---|---|
| `SETTINGS` | `instanceControllerGetSettings` | `ViewKey::InstanceSettings` |
| `STATS` | `instanceControllerGetStats` | `ViewKey::AdminDashboard` |
| `STORAGE` | `storageQuotaControllerGetInstanceStorageStats` | `ViewKey::AdminDashboard` |
| `LIVEKIT` | `livekitControllerValidateConfiguration` | `ViewKey::AdminDashboard` |

Each key is `keys::op(<id>)` (`crate::cache::keys::op`). Add an `InstanceValue` variant per
response (`Settings(wire::InstanceSettingsResponseDto)`, `Stats(wire::InstanceStatsResponseDto)`,
`Storage(wire::InstanceStorageStatsDto)`, `Livekit(wire::LivekitHealthResponseDto)`), stored as
`CacheValue::W6(W6Value::Instance(..))`. Fill `view_for`, `key_for` (`InstanceSettings` ->
`SETTINGS`; `AdminDashboard` -> `STATS`), `w6_instance_query_changed` (return true and call
`self.view_changed(view)` for your ids, false otherwise) and `w6_instance_fetch` (return `None` for
ids that aren't yours).

### Operations

| operationId | HTTP | generated client fn | trait method (in `backend/instance_admin.rs`) | answer |
|---|---|---|---|---|
| InstanceController_getSettings | GET /api/instance/settings | `instance_controller_get_settings()` | same name | `InstanceSettingsResponseDto` |
| InstanceController_updateSettings | PATCH /api/instance/settings | `instance_controller_update_settings(&body)` | `(body: wire::UpdateInstanceSettingsDto)` | `InstanceSettingsResponseDto` |
| InstanceController_getStats | GET /api/instance/stats | `instance_controller_get_stats()` | same | `InstanceStatsResponseDto` |
| StorageQuotaController_getInstanceStorageStats | GET /api/storage/instance | `storage_quota_controller_get_instance_storage_stats()` | same | `InstanceStorageStatsDto` |
| LivekitController_validateConfiguration | GET /api/livekit/health | `livekit_controller_validate_configuration()` | same | `LivekitHealthResponseDto` (`status`, `configured`) |

### Core commands (signatures are frozen in `instance.rs`)

- `pub fn admin_dashboard(&self) -> AdminDashboardView`: `w5a_ensure` all three dashboard keys
  (`STATS`, `STORAGE`, `LIVEKIT`, ages = true). `state` is the `STATS` read's load state
  (`state.query_load_state(&key)`). `stats` from `InstanceStatsResponseDto` (negative numbers clamp
  to 0). `storage`: map every field of `InstanceStorageStatsDto` into `InstanceStorage`
  (`totalStorageUsedBytes`->`total_used_bytes`, `totalFileCount`->`total_files`,
  `totalUserCount`->`total_users`, `averageStoragePerUserBytes`->`average_per_user_bytes`,
  `userStorageDistribution.under25Percent`.. -> `distribution.under_25`.., `storageByType[]` ->
  `by_kind` (`type`->`kind`), `defaultQuotaBytes`, `maxFileSizeBytes`->`max_file_bytes`,
  `usersApproachingQuota`, `usersOverQuota`, `server.*` -> `ServerHealth`, `uptime` seconds as u64).
  `livekit_configured`: `Some(configured)` once read. `attention`: `attention_items(storage,
  storage_error, livekit)` where `storage_error` is true when the `STORAGE` read is
  `LoadState::Failed`.
- `pub fn instance_settings(&self) -> InstanceSettingsView`: `w5a_ensure(SETTINGS)`; fields from the
  DTO (`description` empty or null -> `None`; `registrationMode` OPEN/INVITE_ONLY/CLOSED ->
  `RegistrationMode`, unknown -> `InviteOnly`; bytes i64 -> u64, negative -> 0);
  `op: state.w5a_op(&ViewKey::InstanceSettings)`.
- `pub async fn update_instance_settings(&self, patch: InstanceSettingsPatch) -> Result<(), CoreError>`:
  op `OpKey::new(ViewKey::InstanceSettings, AdminActionKind::UpdateInstanceSettings, None)`.
  Validate before sending, refusing with `w5a_refuse` (message in the backend's words):
  name present and longer than 100 chars -> "name must be shorter than or equal to 100 characters";
  description longer than 500 -> "description must be shorter than or equal to 500 characters";
  `default_quota_bytes` below 1073741824 (1 GiB) -> "defaultStorageQuotaBytes must not be less than 1073741824";
  `max_file_bytes` below 1048576 (1 MiB) or above 1073741824 -> "maxFileSizeBytes must not be less than 1048576"
  / "... must not be greater than 1073741824". An all-`None` patch sends nothing and returns `Ok(())`.
  Body: only the `Some` fields (`UpdateInstanceSettingsDto` fields are optional). An empty
  `description` string is sent as `""` (it clears it). On success, replace the cached settings with
  the answer, and re-probe the server so `ServerInfo` follows: `self.probe_server(url)` with the URL
  of the last probe (`state.auth.server_info`, set by `State::server_probed` in
  `commands/browser_sign_in.rs`); ignore the probe's error. No optimistic update.

### The attention rules (`pub fn attention_items`, hand-written: test it table-driven)

A port of `frontend/src/pages/admin/adminAttention.ts` (`git show 3b1e2684:frontend/src/pages/admin/adminAttention.ts`).
Constants: `DISK_WARNING_PERCENT = 80`, `DISK_ERROR_PERCENT = 90`,
`LIVEKIT_SETUP_DOCS_URL = "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server"`.
Build in this order, then sort errors before warnings, keeping the order otherwise (stable sort):

1. `storage_error` -> `StorageUnavailable`, Warning, title "Couldn't load storage and server status",
   detail "Disk and quota checks are unavailable until it loads.", target `Retry`, action "Try again".
2. storage present and `server.disk_total_bytes > 0` and severity(disk_used_percent) is some ->
   `Disk`, that severity, title "Server disk is {round(percent)}% full" (round half away from zero,
   as JS `Math.round` does for positives), detail "Free up space or grow the disk before uploads start
   failing.", target `Page { page: Storage, storage_min_percent: None }`, action "Storage".
   severity: percent >= 90 -> Error; >= 80 -> Warning; else none.
3. storage present and `users_over_quota > 0` -> `OverQuota`, Warning, title
   "{n} user is over 90% of their storage quota" when n == 1, else "{n} users are over 90% of their
   storage quota" (n with thousands separators "1,234"), detail "They'll soon be unable to upload
   files.", target `Page { page: Storage, storage_min_percent: Some(90) }`, action "Storage".
4. `livekit_configured == Some(false)` -> `Livekit`, Warning, title "Voice and video are off:
   LiveKit isn't configured", detail "Text chat works without it. Set up LiveKit to enable voice
   channels and screen sharing.", target `Url { url: LIVEKIT_SETUP_DOCS_URL }`, action "Setup guide".

Required table (one `#[test]` with a table, in `tests/w6_instance.rs`): disk 79.9 (none), 80.0
(Warning, "80%"), 89.5 (Warning, "90%" title, still Warning), 90.0 (Error), 100 (Error); disk total 0
with 95% (none); over-quota 0 (none), 1 ("1 user is"), 2 ("2 users are"), 1234 ("1,234 users are");
storage error alone; storage error with LiveKit off (both, Warning order kept); disk Error plus
over-quota Warning plus LiveKit (Error first); `livekit_configured` `None` and `Some(true)` (none).

### Fake server (`http/instance_admin.rs`, `w6/instance.rs`)

State: the settings (seed: name from the scenario's `instanceName`, description null,
registrationMode `INVITE_ONLY`, defaultStorageQuotaBytes 53687091200, maxFileSizeBytes 524288000,
id `"instance-settings"`, created/updated at the scenario epoch, `vapidPublicKey` null,
`vapidSubject` null). Guard each route with `crate::w6::allows(&inner, &user, ACTION)` and answer
403 FORBIDDEN "Forbidden resource" when it fails; the user is the bearer token's
(`inner.user_of(token)`).

| route | action | behaviour |
|---|---|---|
| GET /api/instance/settings | READ_INSTANCE_SETTINGS | 200 the settings (`backend/src/instance/instance.controller.ts` `getSettings`) |
| PATCH /api/instance/settings | UPDATE_INSTANCE_SETTINGS | validate as `backend/src/instance/dto/update-instance-settings.dto.ts` (name max 100, description max 500, defaultStorageQuotaBytes min 1073741824 (line 47), maxFileSizeBytes min 1048576 max 1073741824 (lines 58-59)), else 400 VALIDATION_FAILED with the class-validator message; apply only the fields present; (the public settings route, `GET /api/instance/settings/public` in `src/http/session.rs`, isn't yours: leave it as it is); 200 the settings |
| GET /api/instance/stats | READ_INSTANCE_STATS | 200 counts from the scenario: users, communities, channels, messages (all message lists' lengths), activeInvites 1, bannedUsers 0 |
| GET /api/storage/instance | READ_INSTANCE_STATS | 200 a fixed, plausible `InstanceStorageStatsDto` (seed it from the scenario's `instanceStorage` extra key if present, else built-in numbers with disk 50%); a control `instance_storage` (POST /__control/instance_storage with a JSON body) replaces it, so tests can set disk 95% |
| GET /api/livekit/health | none (signed in) | 200 `{"status": "ok", "configured": true}`; control `livekit_configured` with `{"configured": false}` flips it |

Register each route in `routes()` and map it in `operation_id()` to the contract's operationId
(`InstanceController_getSettings`, ...), as `http/community_admin.rs` does.

## Tests required

Core (`crates/semaphore-core/tests/w6_instance.rs`, FakeBackend):
- `the_dashboard_reads_stats_storage_and_livekit_once_and_maps_every_field`
- `a_failed_storage_read_shows_as_an_attention_item_not_a_failed_dashboard`
- `the_dashboard_reads_again_when_shown_after_thirty_seconds` (advance the rig's clock as `tests/w5a.rs` does)
- `attention_items_table` (the table above)
- `settings_map_the_registration_mode_and_bytes` (OPEN, CLOSED, INVITE_ONLY, an unknown mode -> InviteOnly)
- `an_update_sends_only_the_fields_given` (check the recorded call's body)
- `an_update_out_of_bounds_is_refused_before_sending` (each bound above, one row each: no call recorded, `op.actions` shows the message on `UpdateInstanceSettings`)
- `a_refused_update_shows_the_servers_message_and_keeps_the_old_settings`
- `an_update_answer_after_sign_out_changes_nothing` (hold the call, sign out, release)
- `a_new_connection_reads_the_settings_again`

Wire (`crates/semaphore-net/tests/w6_instance.rs`, real HTTP against the fake, copy `semaphore-net/tests/w5a.rs`):
- `the_owner_reads_and_changes_instance_settings` (change name and registration mode; read again)
- `the_dashboard_arrives_over_http`
- `a_user_without_the_action_is_refused` (sign in as `pri`, read settings: `Failed` with FORBIDDEN)

Fake server (`crates/semaphore-fake-server/tests/w6_instance.rs`, copy `tests/w5a.rs`): each route
answers a body that decodes into its wire type; PATCH bounds give 400 VALIDATION_FAILED; a non-owner
gets 403; the two controls work.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w6_instance
scripts/in-image.sh cargo test --locked -p semaphore-net --test w6_instance
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w6_instance
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/commands/instance_admin/instance\.rs|crates/semaphore-core/tests/(w6_instance|common/w6_instance)\.rs|crates/semaphore-net/src/backend/instance_admin\.rs|crates/semaphore-net/tests/w6_instance\.rs|crates/semaphore-fake-server/src/(http/instance_admin|w6/instance)\.rs|crates/semaphore-fake-server/tests/w6_instance\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
