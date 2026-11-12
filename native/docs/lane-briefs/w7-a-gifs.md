# W7-A: GIFs in core

Lane brief, written for a reader who has never seen this repository. Wave 6/7 of the native Rust
desktop client (see `docs/parity-plan.md`, "W6/W7 freeze"). Time matters: do what this brief says
and nothing more.

## Goal

Make core read GIF search and featured GIFs from the server a page at a time, tell when a message is one GIF URL (so the app can draw it as a GIF), with the HTTP calls, fake-server routes serving local fixture GIFs, and tests.

## Files you own

You may edit or create only these (paths relative to `native/`):

- `crates/semaphore-core/src/commands/gifs.rs`
- `crates/semaphore-core/src/text/gif.rs`
- in `crates/semaphore-core/src/store.rs` and `crates/semaphore-core/src/scenario.rs`: only the line `gif: None,` in each (replace it with the call described below)
- `crates/semaphore-core/tests/w7_gifs.rs` (new) and `crates/semaphore-core/tests/common/w7_gifs.rs`
- `crates/semaphore-net/src/backend/gifs.rs`
- `crates/semaphore-net/tests/w7_gifs.rs` (new)
- `crates/semaphore-fake-server/src/http/gifs.rs`, `crates/semaphore-fake-server/src/gifs.rs`
- `crates/semaphore-fake-server/tests/w7_gifs.rs` (new)

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

- `crates/semaphore-core/src/commands/instance_admin/mod.rs`: the W6 hub. Yours is simpler:
  `crates/semaphore-core/src/commands/gifs.rs` is both your hub and your lane file (the shared files
  call its `view_for`, `key_for`, `w7_query_changed`, `w7_event`, `w7_fetch`). The W6 hub, for
  comparison, calls each lane file's `view_for`, `key_for`, `w6_<lane>_query_changed`, `w6_<lane>_event`,
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

## Privacy (read this)

GIF images live on the GIF service's servers (Giphy), which see the address of whoever loads them.
Core never loads an image: it hands out URLs, and the desktop app decides (behind the user's "Load
images from other sites" setting, not your lane). Your code must not fetch any `url` or `previewUrl`.

## What to build

### Query ids and keys

`FEATURED` = `gifsControllerFeatured`, key `keys::op(FEATURED)`, for an empty (after trimming) query;
`SEARCH` = `gifsControllerSearch`, key `keys::scoped(SEARCH, trimmed_query)`. View
`ViewKey::Gifs { query: trimmed_query }` for both (empty string for featured).
`GifsValue::Page { results: Vec<wire::GifResultDto>, next: Option<String> }`. `GifsState` holds the
keys loading their next page.

### Operations

| operationId | HTTP | generated client fn | trait method (`backend/gifs.rs`) |
|---|---|---|---|
| GifsController_featured | GET /api/gifs/featured?limit&pos | `gifs_controller_featured(limit, pos)` | `(limit: Option<NonZeroU64>, pos: Option<String>)` -> `GifSearchResponseDto { results, next }` |
| GifsController_search | GET /api/gifs/search?q&limit&pos | `gifs_controller_search(limit, pos, q)` | `(limit, pos, q: String)` |

### Core commands (frozen in `commands/gifs.rs`)

- `gifs(query) -> GifResultsView`: `enabled` = the probed server's `gif_search`
  (`state.auth.server_info`, set by `State::server_probed` in `commands/browser_sign_in.rs`; false when
  unknown). When not enabled: no fetch, `state` `Ready`, no results. Otherwise read the key
  (`state.ensure_query(key)`; GIF lists don't age: no 30 s rule), first page `limit` 20, `pos` None.
  Results `GifResultDto` -> `GifView` (width/height negative -> 0, clamp to `u32`). `more` =
  `next.is_some()`. A query longer than 50 characters is sent cut to its first 50 characters (the
  server cuts it too: `backend/src/gifs/providers/giphy.provider.ts:15,71`), but the key and view keep
  the trimmed query as given.
- `load_more_gifs(query)`: no-op when not cached, no `next`, or loading; fetch with `pos = next`;
  append results whose id is new; take the new `next`; session-epoch check before writing.
- A 503 (`UNAVAILABLE`: "GIF search is not configured on this instance. Set GIPHY_API_KEY in .env"
  or "Failed to reach the GIF service", `giphy.provider.ts:90,113,118`) is a failed read like any
  other (`LoadState::Failed` with the server's message).

### `lone_gif_url` (in `text/gif.rs`, hand-written: test it table-driven)

A port of `getLoneGifUrl` (`git show 3b1e2684:frontend/src/components/Message/messageUtils.ts`,
lines 51-99). Returns `Some(GifEmbed { url: <the trimmed text>, host: <lowercased host> })` when all
hold, else `None`; never panics; no new crates (parse by hand):

1. The text trimmed is not empty and contains no whitespace.
2. `http://` or `https://` occurs exactly once, case-insensitively, and the text starts with it.
3. It parses as a URL: after the scheme, the host runs up to the first `/`, `?` or `#`; it is not
   empty (an optional `:port` is allowed and isn't part of the host).
4. The host (lowercased) matches `^media\d*\.giphy\.com$` or `^media\d*\.tenor\.com$`, or the path
   (from the first `/` after the host up to `?` or `#`) ends with `.gif`, case-insensitively.

Required table (copied from the web's tests, `frontend/src/__tests__/utils/messageUtils.test.ts`
lines 60-160 at 3b1e2684), each with its expected result:

| text | result |
|---|---|
| `https://media.giphy.com/media/abc123/giphy.gif` | the URL |
| `https://media4.giphy.com/media/abc123/giphy.gif` | the URL |
| `https://media.tenor.com/abc123/cat.gif` | the URL |
| `https://media3.tenor.com/abc123/cat.gif` | the URL |
| `https://example.com/images/cat.gif` | the URL |
| `https://example.com/images/cat.GIF` | the URL |
| `https://example.com/images/cat.gif?width=200&quality=80` | the URL |
| `check this out https://media.giphy.com/media/abc/giphy.gif` | None |
| `https://media.giphy.com/media/abc/giphy.gif look at this` | None |
| `https://media.giphy.com/media/abc/giphy.gif https://media.tenor.com/xyz/cat.gif` | None |
| `https://example.com/page.html` | None |
| `https://notgiphy.com/media/abc/giphy.gif` | the URL (path rule) |
| `https://notgiphy.com/media/abc/giphy.png` | None |
| `` (empty) | None |
| `not a url at all` | None |
| `   \n\t  ` | None |
| `  https://media.giphy.com/media/abc/giphy.gif  ` | the URL without the spaces |

Add these rows of your own: `https://media.giphy.com/media/abc/giphy.gifhttps://x.gif` (None, two
schemes), `ftp://example.com/cat.gif` (None), `https://` (None), `HTTPS://MEDIA.GIPHY.COM/x` (the URL,
host `media.giphy.com`), `https://example.com/cat.gif#frag` (the URL), `https://example.com:8443/a.gif`
(the URL, host `example.com`), `https://media.giphy.com.evil.example/x` (None: no `.gif` path, host
doesn't match), a 10 kB string of `a` (None, fast).

### Filling `MessageRow::gif`

In `store.rs` (the row built from a server message) and `scenario.rs` (rows built from scenario
JSON), replace the freeze's `gif: None,` with: `gif: if removed { None } else {
crate::text::gif::lone_gif_url(&display) }` using the row's display text variable as it is named
there, and `None` for a removed message. Read the code around those lines to find the names; change
nothing else in those files. A row with attachments still gets `gif` (the web does the same).

### Fake server (`http/gifs.rs`, `src/gifs.rs`)

Fixture GIFs from the scenario's `gifs` extra key if present (a list of `GifResultDto` objects), else
30 built-in ones: ids `gif-1`..`gif-30`, titles "Fixture GIF n", `url`
`<base>/__fixtures/gif-n.gif`, `previewUrl` `<base>/__fixtures/gif-n-preview.gif`, width 200, height
150 (`<base>` is the fake server's own address: never a third-party host). Both routes require a
signed-in user (401 UNAUTHENTICATED otherwise, as the other routes do). `limit` 1..50, default 20
(`backend/src/gifs/dto/gif-query.dto.ts` lines 5-13), else 400 VALIDATION_FAILED
"limit must not be less than 1" / "limit must not be greater than 50". `pos` is an opaque offset
string ("20"); an unparsable `pos` means 0. Featured: the fixtures in order. Search: those whose title
contains `q` (case-insensitive; `q` cut to 50 characters). `next` is the next offset when more remain,
absent otherwise. A control `gifs_unavailable` (`{"on": true}`) makes both routes answer 503
UNAVAILABLE "GIF search is not configured on this instance. Set GIPHY_API_KEY in .env".

## Tests required

Core (`tests/w7_gifs.rs`): `lone_gif_url_table` (may live as unit tests in `text/gif.rs` instead),
`featured_and_search_are_separate_lists`, `paging_table` (no next; two pages; a repeated id; concurrent
`load_more`; a failed page), `nothing_is_read_when_the_server_offers_no_gifs`, `a_long_query_is_cut_to_fifty`,
`an_unavailable_service_fails_the_read_with_its_message`, `an_answer_after_sign_out_changes_nothing`,
`a_message_that_is_one_gif_url_carries_it` (a received message's row has `gif`; one with text
around the URL doesn't; a removed one doesn't).
Wire: `featured_search_and_paging_over_http`. The fake's public settings answer
`"gifSearchEnabled": false` by default; turn it on first with the existing control
(`POST <base>/__control/public_settings` with `{"gifSearchEnabled": true}`, handled in
`src/http/mod.rs`), then probe the server (`core.probe_server(base)`) so `gif_search` is known.
Fake server: decodes; limits; paging; search; the control.

## Finish line

Run from `native/`. Every command must pass; the last one must print nothing.

```bash
scripts/in-image.sh cargo fmt --all --check
scripts/in-image.sh cargo test --locked -p semaphore-core --test w7_gifs
scripts/in-image.sh cargo test --locked -p semaphore-net --test w7_gifs
scripts/in-image.sh cargo test --locked -p semaphore-fake-server --test w7_gifs
scripts/in-image.sh cargo test --locked --workspace
scripts/in-image.sh cargo clippy --locked --workspace --all-targets -- -D warnings
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-linux-android
scripts/in-image.sh cargo check --locked -p semaphore-core --target aarch64-apple-ios
scripts/in-image.sh python3 scripts/check-core-boundary.py
git status --porcelain --untracked-files=all -- . | sed 's/^...//' | sed 's#^native/##' \
  | grep -vE '^(crates/semaphore-core/src/(commands/gifs|text/gif|store|scenario)\.rs|crates/semaphore-core/tests/(w7_gifs|common/w7_gifs)\.rs|crates/semaphore-net/src/backend/gifs\.rs|crates/semaphore-net/tests/w7_gifs\.rs|crates/semaphore-fake-server/src/(http/gifs|gifs)\.rs|crates/semaphore-fake-server/tests/w7_gifs\.rs)$'
```

Then stop and report: what you built, the commands' last lines, anything this brief got wrong, and
any decision you had to make.
