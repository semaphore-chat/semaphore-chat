# U4: fake backend

Read `_rules.md` here first. Work in `native/`. U1 and U3 must have landed.

## Goal

A deterministic in-process backend that speaks the real protocols over real loopback sockets, so
the native client can run end to end with no Postgres, Redis or LiveKit, and tests and screenshots can
script events and faults.

## Owned paths

`crates/semaphore-fake-server/` only, and its dependency lines in `Cargo.toml`, `Cargo.lock`, `deny.toml`.
The app must never link this crate.

## Inputs

- `contract/openapi.json`, `contract/socket-events.json`, `contract/wire-contract.md`.
- `semaphore-wire`: use its types for requests and responses.
- `fixtures/scenarios/*.json`: the data, shaped like the web's `Scenario` type.
- Protocol reference at the pinned commit (`git show "$(sed -n 's/^commit=//p' contract/PIN):<path>"`):
  `backend/test/websocket.e2e-spec.ts`, `backend/test/message-nonce.e2e-spec.ts`,
  `backend/src/websocket/send-ack.spec.ts`, `frontend/src/stories/fixtures/handlers.ts` (how the web's
  fake answers).

## REST routes

Use `axum`. Answer from the scenario, and keep state in memory. Exactly these `operationId`s:

- **Session:** `AuthController_login` (any password except `wrong`, which gets 401 `UNAUTHENTICATED`),
  `AuthController_refresh`, `AuthController_logout`, `UserController_getProfile`.
- **Navigation:** `CommunityController_findAllMine`, `ChannelsController_findAllForCommunity`,
  `ChannelPermissionsController_getMyCommunityChannelPermissions`, `ReadReceiptsController_getUnreadCounts`.
- **Messages:** `MessagesController_findAllForChannel`, `MessagesController_findAroundForChannel`,
  `MessagesController_findAllForGroup` (all paginated by `continuationToken`, newest page first, as
  `PaginatedMessagesResponseDto`), `MessagesController_create`, `MessagesController_createDirectMessage`,
  `MessagesController_addReaction`, `MessagesController_removeReaction`, `ReadReceiptsController_markAsRead`.
- **Composer:** `MembershipController_searchCommunityMembers`, `ChannelsController_getMentionableChannels`,
  `CustomEmojiController_listCommunityEmojis`.
- **Voice:** `LivekitController_getConnectionInfo`, `LivekitController_generateToken` (a fixed fake token),
  `VoicePresenceController_getChannelPresence`, `_joinPresence`, `_refreshPresence`, `_leavePresence`,
  `_updateDeafenState`.
- **Files:** `FileController_getFile`, `FileController_getFileThumbnail`: a small valid PNG from a
  deterministic function of the file id, with `image` or a hand-rolled encoder.

Everything else returns a 501 `ErrorResponseDto` naming the route, so a missing one is obvious. Errors
always use `ErrorResponseDto`, with `errorCode` and `retryable`. Require a bearer token except on login.

## Socket

WebSocket only, at `/socket.io/?EIO=4&transport=websocket`. Engine.IO v4 and Socket.IO v5 text frames:
open `0{"sid","pingInterval","pingTimeout","upgrades":[]}`, connect `40`/`44`, event `42[...]`,
ack `43<id>[...]`, disconnect `41`, ping `2` and pong `3`. No namespaces, no binary. Write the small
server side here. Core's client-side parser isn't on this branch yet, so test with a raw
`tokio-tungstenite` client.

- **Handshake:** `auth.token` must be a valid `Bearer ...`; otherwise `44{"message":"AUTH_FAILED"}`. Record `auth.protocol`.
- `subscribeAll`, `presenceOnline`, `typingStart`, `typingStop`, `markAsRead`, `addReaction`, `removeReaction`:
  accepted and recorded.
- `reauthenticate`: acks `ReauthenticateResultDto`.
- `sendMessage`, `sendDirectMessage`, `sendThreadReply`:
  - **`protocol >= 2`:** ack `SendAckDto { ok: true, messageId }`, or `{ ok: false, error: SendAckErrorDto }`.
    Otherwise: ack the plain id.
  - **Same `clientNonce` from the same author:** return the same message, with no second one and no second broadcast.
  - Broadcast `newMessage` with `clientNonce` to every socket, in the shape of the event's payload in
    `socket-events.json`.
- REST sends fan out the same way.

## Determinism

All time comes from a settable clock in the server, starting at the scenario's epoch. Ids for new messages
come from a counter. `FakeServer::idle()` resolves when no request is in flight and no frame is queued.

## Control API

```rust
let server = FakeServer::start(ScenarioSource::Named("big-community")).await?;
server.base_url();                 // http://127.0.0.1:<ephemeral>
server.emit("newMessage", json).await;   // to all sockets
server.drop_connections().await;   // abrupt close, as a network failure would be
server.refuse_connections(true);
server.delay_acks(Duration).await; // hold acks, while still broadcasting
server.drop_acks(true);            // never ack; the broadcast still goes
server.fail_next_send(code, retryable, retry_after_ms);
server.fail_route(operation_id, status, code);
server.requests();                 // every request and socket event seen, in order
server.advance_clock(Duration);
server.idle().await;
```

Also a `fake-server` binary, `--scenario <name> [--port N]`, with the same controls at
`POST /__control/<name>`, for scripts.

## Tests

Over real sockets:

1. **Contract:** every implemented route's response validates against `openapi.json` with
   `additionalProperties: false` on every object, using the `jsonschema` crate as a dev-dependency.
   Likewise every `emit` payload and ack. This is the test that stops the fake drifting.
2. **Socket session:** handshake, refused handshake, ping and pong, event, ack.
3. **Ack v2:** protocol 2 gets `SendAckDto`, and no protocol gets the plain id.
4. **Nonce:** the same nonce twice gives one message and one broadcast.
5. **Each fault:** drop, refuse, delay, drop acks, fail next send, fail route.
6. **Pagination** reaches every message in `long-history` exactly once, in order.
7. **Determinism:** the same calls twice give identical responses.

Waits in tests go through `idle()` or a bounded poll, never a fixed sleep.

## Proof

```bash
scripts/in-image.sh cargo test --locked -p semaphore-fake-server
scripts/in-image.sh cargo tree --locked -p semaphore-app -i semaphore-fake-server   # must print "nothing to print"
scripts/in-image.sh python3 scripts/check-core-boundary.py
scripts/verify.sh
```

## Finish line

The tests pass, `semaphore-app` doesn't reach this crate, and `verify.sh` exits 0. Report the routes,
anything in the contract that was awkward to serve, and every place you diverged from the real backend.
Once they pass, stop. Don't touch `semaphore-net` or `semaphore-core`, don't write a Rust client, and don't
add anything beyond this.
