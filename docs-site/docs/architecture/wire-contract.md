# Wire Contract

REST and Socket.IO share one description of what goes over the wire. Clients can be generated from it, in any language.

---

## Where it lives

| File | What it is |
|---|---|
| `backend/src/**/dto/*.dto.ts` | The source: NestJS DTOs |
| `backend/openapi.json` | Generated. The REST API, plus every socket payload as a named component |
| `backend/socket-events.json` | Generated. Socket event names, each pointing at its component in `openapi.json` |
| `shared/src/generated/` | Generated. The TypeScript wire types the backend and the frontend compile against |

CI fails when a generated file is out of date. To regenerate, see OpenAPI SDK Client Regeneration in `CLAUDE.md`.

A message has one shape, `MessageDto`, on REST and on the socket. `toMessageDto()` in `backend/src/messages/message.mapper.ts` is the only way a message row becomes one: it lists every field, so a new column stays private until it is added there and to the DTO.

To add a socket event, add its payload DTO and an entry in `backend/src/websocket/socket-event-schemas.ts`. The map must cover every event, so a new one that isn't listed doesn't compile.

---

## Rules for readers

Clients in the field stay old for a long time, so a client has to survive a newer server.

1. **Ignore unknown fields.** New fields can appear on any object at any time.
2. **Ignore unknown events.** A new server sends events an old client has never heard of.
3. **Treat an unknown enum value as a fallback, not an error.** Enums grow: a new `SpanType` must not lose the rest of the message. For a span, render its `text` if it has one. Never fail the whole payload.
4. **Treat a missing optional field and `null` the same.** Required fields are always present, and are `null` when they have no value. A field may only be missing if it's optional in the schema, or if the server is older than the schema you generated from.
5. **Removed messages are blank.** A message with `deletedAt` set may have no spans, attachments or reactions, depending on what the reader may see.

---

## Rules for writers

Once released, the contract only grows.

- **Don't** remove or rename a field, change its type, or make a nullable field required to send, without a compatibility plan.
- **Don't** change what an enum value means.
- **Do** add new fields and new enum values, and write the code that sends them so old clients can ignore them.
- **Do** use named types: no inline objects or anonymous unions in a DTO, because generators turn them into unusable names, or nothing at all.
- **Do** say `| null` when a field has no value, and make a field optional only when it is really absent.

`backend/test/message-wire-contract.e2e-spec.ts` and `backend/test/socket-events-contract.e2e-spec.ts` check real responses and payloads against the spec with every object closed, so a field the spec doesn't declare fails the test, while the published spec stays open for rule 1. `frontend/src/__tests__/features/messageWireReplay.test.tsx` replays recorded payloads through the real socket handlers and message renderer; run it against an older client's checkout before changing what a message looks like.

---

## Events the contract tests can't drive

Declared in `socket-events.json`, but not exercised end to end:

| Event | Why |
|---|---|
| `replayBufferStopped`, `replayBufferFailed`, `egressSegmentsReady` | They need a running LiveKit egress. The compiler checks their emit sites against the generated types |

---

## Generating a client

### Rust (progenitor)

Tested with `cargo-progenitor` 0.15.1, with nightly rustfmt. It generates one type per component, including the socket payloads, so a separate generator for events would only create a second `MessageDto`.

Progenitor rejects `multipart/form-data` request bodies, so strip them first, and write `POST /api/file-upload` by hand:

```bash
jq '(.paths[][] | select(.requestBody.content["multipart/form-data"]?)) |= del(.requestBody)' \
  backend/openapi.json > spec.json
RUSTUP_TOOLCHAIN=nightly cargo-progenitor progenitor -i spec.json -o out -n semclient -v 0.1.0
```

!!! warning "Unknown enum values"
    The generated enums are closed: an unknown `SpanType` fails to decode the **whole message**, which breaks rule 3. A Rust client has to handle this itself. Unknown fields are fine.

### Swift and Kotlin (openapi-generator)

Tested for generation only, with 7.17.0 and the `swift6` and `kotlin` generators. Pass `--additional-properties=enumUnknownDefaultCase=true` for rule 3.

!!! warning "Fields missing on an older server"
    Kotlin generates required nullable fields as `val replyTo: ReplyToPreviewDto?` with no default, so a field missing on a server older than the schema would probably fail to decode. Not yet tested.
