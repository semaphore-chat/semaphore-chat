# W6-D: every community and the instance invites

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core list and page every community on the instance with its counts, show one, force-delete one, and list, create and delete instance invites, with the HTTP calls, fake-server routes for the community calls, and tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/instance_admin/content.rs`
- `crates/semaphore-core/tests/w6_content.rs` (new) and `crates/semaphore-core/tests/common/w6_content.rs`
- `crates/semaphore-net/src/backend/admin_content.rs`
- `crates/semaphore-net/tests/w6_content.rs` (new)
- `crates/semaphore-fake-server/src/http/admin_content.rs`, `crates/semaphore-fake-server/src/w6/content.rs`
- `crates/semaphore-fake-server/tests/w6_content.rs` (new)

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
| `COMMUNITIES` | `communityControllerFindAllWithStats` | `keys::scoped(COMMUNITIES, search)` (search trimmed) | `ViewKey::AdminCommunities { search }` |
| `COMMUNITY` | `communityControllerFindOneWithStats` | `keys::scoped(COMMUNITY, id)` | `ViewKey::AdminCommunity { community_id }` |
| `INVITES` | `inviteControllerGetInvites.admin` | `keys::op(INVITES)` | `ViewKey::AdminInvites` |

`INVITES` is deliberately not W5-A's key (`inviteControllerGetInvites`, the per-community list):
the fetch for it calls the same operation, but the cache entry is yours, so neither lane changes
the other's. `ContentValue`: `Communities { rows: Vec<wire::CommunityStatsDto>, next: Option<String> }`,
`Community(wire::CommunityStatsDetailDto)`, `Invites(Vec<wire::InviteResponseDto>)`.

### Operations

| operationId | HTTP | generated client fn | trait method |
|---|---|---|---|
| CommunityController_findAllWithStats | GET /api/community/admin/list?limit&continuationToken&search | `community_controller_find_all_with_stats(continuation_token, limit, search)` | `AdminContentBackend` `(continuation_token: Option<String>, limit: Option<i64>, search: Option<String>)` -> `CommunityStatsListResponseDto { communities, continuationToken }` |
| CommunityController_findOneWithStats | GET /api/community/admin/{id} | `community_controller_find_one_with_stats(id)` | `(id)` -> `CommunityStatsDetailDto` (adds `messageCount`) |
| CommunityController_forceRemove | DELETE /api/community/admin/{id} (204) | `community_controller_force_remove(id)` | `(id)` -> `()` |
| InviteController_getInvites | GET /api/invite | already implemented: `CommunityAdminBackend::invite_controller_get_invites` | -> `Vec<InviteResponseDto>` |
| InviteController_createInvite | POST /api/invite | already implemented: `invite_controller_create_invite(body)` | `CreateInviteDto { communityIds, maxUses, validUntil }` |
| InviteController_deleteInvite | DELETE /api/invite/{code} (204) | already implemented: `invite_controller_delete_invite(code)` | |

The three invite calls already have their `HttpBackend` methods (W5-A's) and their fake routes
(`src/http/community_admin.rs`, W5-A's): you add no net or fake code for invites, only core. Your
net file implements the three community calls.

### Core commands (frozen in `content.rs`)

- `admin_communities(search) -> AdminCommunitiesView`: first page `limit` 50, `search` omitted when
  empty; rows `CommunityStatsDto` -> `AdminCommunityRow` (`avatar` -> `avatar_file_id`, counts
  negative -> 0); `more` = `next.is_some()`.
- `load_more_admin_communities(search)`: as W6-B's users paging: no-op when not cached, no `next`, or
  loading; append rows whose id is new; take the answer's `continuationToken`; session-epoch check.
- `admin_community(community_id) -> AdminCommunityView` (`message_count` from the detail).
- `force_delete_community(community_id)`: op `OpKey::new(ViewKey::AdminCommunity { community_id },
  AdminActionKind::ForceDeleteCommunity, Some(id))`. Copy W5-A's `delete_community`
  (`commands/community_admin.rs`): insert the id into `state.w5a.deleting` before sending (so core
  doesn't announce the server's `communityDeleted` for a delete it made itself), on success call
  `state.w5a_drop_community(&id, None)` and remove the row from every cached `COMMUNITIES` list and
  drop its `COMMUNITY` value; on refusal remove it from `deleting` again. No optimistic removal.
- `admin_invites() -> AdminInvitesView`: rows `InviteResponseDto` -> `InstanceInviteRow`
  (`createdBy` -> `UserView` with `avatar_file_id` None; `uses` and `maxUses` clamp to `0..=u32::MAX`;
  `validUntil`/`createdAt` as ms; `defaultCommunities[]` -> `InviteCommunity { id: communityId, name }`
  where the name is the community's from the cached communities (`keys::op(keys::COMMUNITIES)`, the
  rail's list), else the id). Newest first, as the server sends.
- `create_instance_invite(draft) -> Result<String, CoreError>`: op `CreateInstanceInvite` on
  `ViewKey::AdminInvites`, target `None`. Refuse before sending: no communities ("Pick at least one
  community"), a community id that isn't a UUID ("the community isn't valid"), `max_uses` 0 ("Uses
  must be at least 1"), `valid_until_ms` not after now ("The expiry must be in the future").
  `max_uses` -> `NonZeroU64`, `valid_until_ms` -> `chrono::DateTime<Utc>`. On success insert the answer
  at the top of your `INVITES` list (unless its code is there); return the code.
- `delete_instance_invite(code)`: op `DeleteInstanceInvite` target `Some(code)`; remove at once,
  put back at its old index on refusal if it isn't there again (W5-A's `delete_invite` does this).

Draft table (one test): each refusal above, and a valid draft with and without limits (check the
recorded body).

### Fake server (`http/admin_content.rs`, `w6/content.rs`)

Communities: every community the fake knows (the scenario's and created ones) except deleted ones;
read them with `crate::admin::community(&inner, id)` for each id in the scenario's `communities` plus
`inner.accounts`'s created communities (`Accounts::communities`; read `src/admin.rs` and
`src/accounts.rs` for how W5-A gathers them). `memberCount` = `crate::admin::members(&inner, id).len()`,
`channelCount` = its channels, `messageCount` = the messages in its channels. Guards via
`crate::w6::allows`: READ_ALL_COMMUNITIES for the reads, DELETE_COMMUNITY for the delete, else 403
FORBIDDEN "Forbidden resource".

| route | behaviour (backend `backend/src/community/community.controller.ts` and `community.service.ts`) |
|---|---|
| GET /api/community/admin/list | `limit` default 50 (`DefaultValuePipe(50)`), `search` case-insensitive in the name, order createdAt desc then id asc, `continuationToken` = the last id of the previous page, answer `continuationToken` only when more remain |
| GET /api/community/admin/{id} | malformed UUID 400 BAD_REQUEST; unknown 404 NOT_FOUND "Community not found" (service :391 region); the detail |
| DELETE /api/community/admin/{id} | unknown 404 "Community not found"; send `communityDeleted {communityId}` to its members before deleting (the backend does since #719: `community.service.ts` `forceRemove` emits `COMMUNITY_DELETED`), then delete exactly as W5-A's `delete_community` handler in `src/http/community_admin.rs` does (copy those state changes; don't call into or edit that file); 204 |

## Tests required

Core: `paging_table` (as in W6-B's: no next; two pages; a repeated id; concurrent `load_more`; a
failed page), `the_list_and_detail_map_every_field`, `force_delete_drops_the_community_without_announcing_it`
(the later `communityDeleted` event sends no `CoreEvent::CommunityRemoved`),
`a_refused_force_delete_keeps_everything`, `draft_table`, `delete_invite_goes_at_once_and_comes_back_when_refused`,
`the_admin_invites_list_is_apart_from_the_community_invites_list` (W5-A's `community_invites` and
yours read separate keys: two calls), `an_answer_after_sign_out_changes_nothing`,
`a_new_connection_reads_the_lists_again`.
Wire: `the_owner_lists_and_pages_communities`, `the_owner_force_deletes_a_community_and_its_members_hear_it`
(a second client signed in as a member gets `CoreEvent::CommunityRemoved`), `the_owner_creates_and_deletes_an_instance_invite`,
`a_plain_user_is_refused`.
Fake server: decodes, paging, the 404s, the deletion event.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w6_content
scripts/in-image.sh cargo test --locked -p semaphore-net --test w6_content
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w6_content
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/commands/instance_admin/content\.rs|crates/semaphore-core/tests/(w6_content|common/w6_content)\.rs|crates/semaphore-net/src/backend/admin_content\.rs|crates/semaphore-net/tests/w6_content\.rs|crates/semaphore-fake-server/src/(http/admin_content|w6/content)\.rs|crates/semaphore-fake-server/tests/w6_content\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
