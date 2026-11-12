# W6-C: per-user storage

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core list users' storage use (filtered by a minimum percentage, a page at a time), change a user's quota and recalculate a user's use, with the HTTP calls, fake-server routes and tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/instance_admin/storage.rs`
- `crates/semaphore-core/tests/w6_storage.rs` (new) and `crates/semaphore-core/tests/common/w6_storage.rs`
- `crates/semaphore-net/src/backend/admin_storage.rs`
- `crates/semaphore-net/tests/w6_storage.rs` (new)
- `crates/semaphore-fake-server/src/http/admin_storage.rs`, `crates/semaphore-fake-server/src/w6/storage.rs`
- `crates/semaphore-fake-server/tests/w6_storage.rs` (new)

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

### Query id and key

`STORAGE_USERS` = `storageQuotaControllerGetUsersStorageList`; key
`keys::scoped(STORAGE_USERS, &min_percent.to_string())`; view `ViewKey::AdminStorage { min_percent }`.
`StorageValue::Users { rows: Vec<wire::UserStorageStatsDto>, total: i64 }`. `StorageState` holds the
keys loading a next page.

### Operations

| operationId | HTTP | generated client fn | trait method (`backend/admin_storage.rs`) |
|---|---|---|---|
| StorageQuotaController_getUsersStorageList | GET /api/storage/users?skip&take&minPercentUsed | `storage_quota_controller_get_users_storage_list(min_percent_used, skip, take)` | `(min_percent_used: Option<i64>, skip: Option<i64>, take: Option<i64>)` -> `UserStorageListResponseDto { users, total }` |
| StorageQuotaController_getUserStorageStats | GET /api/storage/users/{userId} | `storage_quota_controller_get_user_storage_stats(user_id)` | `(user_id)` -> `UserStorageStatsDto` (implement it in net and the fake; no core command uses it yet) |
| StorageQuotaController_updateUserQuota | PATCH /api/storage/users/{userId}/quota `{quotaBytes}` | `storage_quota_controller_update_user_quota(user_id, &body)` | `(user_id, body: UpdateUserQuotaDto)` -> `UserStorageStatsDto` |
| StorageQuotaController_recalculateUserStorage | POST /api/storage/users/{userId}/recalculate | `storage_quota_controller_recalculate_user_storage(user_id)` | `(user_id)` -> `UserStorageStatsDto` |

### Core commands (frozen in `storage.rs`)

- `admin_storage(min_percent) -> AdminStorageView`: `w5a_ensure(key, now, true)`, first page
  `skip` 0, `take` 50, `minPercentUsed` `Some(min_percent)` only when `min_percent > 0`. Rows:
  `UserStorageStatsDto` -> `StorageRow` (negative numbers -> 0). `total` (>= 0), `more` = rows < total,
  `loading_more`, `op` = `w5a_op(&ViewKey::AdminStorage { min_percent })`.
- `load_more_storage(min_percent)`: as W5-B's `more_moderation_log` (`commands/moderation.rs`): no-op
  when not cached, `rows >= total`, or already loading; fetch `skip = rows.len()`, `take` 50; append rows
  whose `userId` isn't present; take the new `total`; session-epoch check before writing.
- `set_user_quota(user_id, quota_bytes)`: op `OpKey::new(ViewKey::AdminStorage { min_percent: 0 },
  AdminActionKind::SetUserQuota, Some(user_id))`. Refuse before sending when `quota_bytes` exceeds
  `i64::MAX` ("the quota is too large"). On success replace that user's row (by `userId`) in every
  cached storage list with the answer.
- `recalculate_storage(user_id)`: op `RecalculateStorage` on the same view, same replacement.
  (Both ops sit on `min_percent: 0`'s view so a dialog finds them whatever filter the list shows;
  say so in the doc comment.)

Paging table (one test): total 0; exactly one page (50 of 50: `more` false); 51 rows over two pages;
a repeated user on the second page kept once; `load_more` twice at once makes one call; different
`min_percent` values are separate lists; a failed page leaves the rows.

### Fake server

Rows from the scenario's users (me and `inner.scenario.users`): `usedBytes` 0 unless the scenario's
`storageUsage` extra key (an object `{ "<user id>": <bytes> }`) says otherwise; `quotaBytes`
53687091200 unless changed; `percentUsed` = used / quota * 100 rounded to 2 decimals (0 when quota is
0), `fileCount` 0. Guard: MANAGE_USER_STORAGE via `crate::w6::allows`, else 403 FORBIDDEN
"Forbidden resource".

| route | behaviour (backend `backend/src/storage-quota/`) |
|---|---|
| GET /api/storage/users | `skip` default 0, `take` default 20 (controller's `DefaultValuePipe`), `minPercentUsed` default 0 (0 = no filter); filter `percentUsed >= minPercentUsed`, sort `percentUsed` descending (then userId ascending for ties), `total` = the filtered count, page `slice(skip, skip + take)` (`storage-quota.service.ts` around line 460-490) |
| GET /api/storage/users/{userId} | malformed UUID 400 BAD_REQUEST; unknown user 404 NOT_FOUND "User not found"; the row |
| PATCH /api/storage/users/{userId}/quota | body `quotaBytes` a number >= 0 (`UpdateUserQuotaDto`, `@Min(0)`), else 400 VALIDATION_FAILED "quotaBytes must not be less than 0"; unknown 404; store; 200 the row |
| POST /api/storage/users/{userId}/recalculate | unknown 404; 200 the row (recalculating changes nothing in the fake) |

## Tests required

Core: `paging_table`, `the_list_maps_every_field`, `the_filter_reaches_the_request`,
`a_quota_change_replaces_the_row_in_every_list`, `a_refused_quota_change_shows_the_message`,
`recalculate_replaces_the_row`, `an_answer_after_sign_out_changes_nothing`,
`a_new_connection_reads_the_list_again`.
Wire: `the_owner_pages_through_storage_and_sets_a_quota`, `a_plain_user_is_refused`.
Fake server: decodes, defaults, filter and sort, each refusal.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w6_storage
scripts/in-image.sh cargo test --locked -p semaphore-net --test w6_storage
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w6_storage
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/commands/instance_admin/storage\.rs|crates/semaphore-core/tests/(w6_storage|common/w6_storage)\.rs|crates/semaphore-net/src/backend/admin_storage\.rs|crates/semaphore-net/tests/w6_storage\.rs|crates/semaphore-fake-server/src/(http/admin_storage|w6/storage)\.rs|crates/semaphore-fake-server/tests/w6_storage\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
