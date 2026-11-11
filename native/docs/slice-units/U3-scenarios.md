# U3: scenarios from the web client's story fixtures

Read `_rules.md` here first. Work in `native/`.

## Goal

Export the web client's deterministic Ladle scenarios to JSON, valid against the API contract, and turn
them into core's view models, so native stories show the same data as the web stories they're compared
with.

## Owned paths

`tools/web-export/scenarios.test.ts`, `fixtures/scenarios/`, `scripts/gen-scenarios.sh`,
`scripts/validate-scenarios.py`, `crates/semaphore-core/src/scenario.rs`, and the `fixtures` feature
in `crates/semaphore-core/Cargo.toml`. Keep `[dependencies]` last in that file: `scripts/test-policy.sh`
appends to it.

## How exporters run

`scripts/export-web.sh <name>` runs `tools/web-export/<name>.test.ts` as a Vitest file in the frontend
container, at the commit in `contract/PIN`, with imports relative to
`frontend/src/__tests__/native-export/`. It writes to `native-export-out/<name>/`, which arrives in
`tools/web-export/out/<name>/`. `tools/web-export/smoke.test.ts` is a working example that already
imports `buildScenario`. **Don't edit anything in `frontend/`.**

## Export

Source, at the pinned commit (`git show "$(sed -n 's/^commit=//p' contract/PIN):<path>"`):
`frontend/src/stories/fixtures/{builder,scenarios,modifiers,types,rng}.ts` and `showcase.ts`. `rng.ts`
fixes its epoch, so output is already deterministic.

Export these, each to `fixtures/scenarios/<name>.json` with sorted keys and 2-space indent:

| File | From |
|---|---|
| `big-community` | `bigCommunityScenario` |
| `empty-user` | `emptyUserScenario` |
| `showcase` | The scenario `showcase.ts` exports. If it needs a DOM that won't load, skip it and say so |
| `long-history` | `buildScenario({ seed: 'long-history', messagesInGeneral: 2000 })` |

The `Scenario` type in `types.ts` is the shape.

## Validate

`scripts/validate-scenarios.py` (python3 with `jsonschema`, both in the image) checks every message,
channel, user, membership and voice-presence entry against its schema in `contract/openapi.json`: `MessageDto`,
`ChannelDto`, `UserEntity`, `MembershipResponseDto`, `VoicePresenceUserDto`. Resolve `$ref`s and set
`additionalProperties: false` on every object, as `backend/test/message-wire-contract.e2e-spec.ts` does
at the pinned commit, so a field the contract doesn't declare fails.

The test factories may not match the wire. Fix mismatches **in the exporter**, by normalizing, and
list every normalization in your report, because each is a place the web's stories drift from the real
server. If a field is missing and has no sensible default, stop and report it. Don't invent data
silently, and don't weaken the validator.

## `crates/semaphore-core/src/scenario.rs`

Implement `from_json(json: &str) -> Result<ScenarioViews, CoreError>`. `ScenarioViews` and the view models
in `model.rs` are frozen. Parse with `serde_json::Value` or private serde structs. You may add `chrono`
with no default features under the `fixtures` feature, for timestamps.

| View model | From |
|---|---|
| `me` | `me` |
| `communities` | `communities`, with counts summed from `unreadByContextId` by channel |
| `channels` | Each community's `channels` in order. `voice_users` from `voicePresenceByChannel`. Counts from `unreadByContextId` |
| `messages` | `messagesByChannel` (`Conversation::Channel`), `messagesByDmGroup` (`DirectMessage`), `threadRepliesByParent` (`Thread`), each oldest first by `sentAt`. Sort the conversations too, so output is deterministic |
| `MessageRow.seq` | Index in that sorted list, from 0 |
| `MessageRow.display`, `segs` | `crate::text::layout_spans`, mapping each span to `SpanInput`. Unknown types pass through as text |
| `MessageRow.author` | Look up `authorId` in `me` and `users`. An unknown author gets the id as username, with no failure |
| `removed` | `deletedAt` is set. Then blank `display`, no attachments or reactions |
| `attachments` | `kind` from `fileType`; `width` and `height` are `None`, because the contract has none |
| `reactions` | `count` from `userIds.len()`, `me` if it contains `me.id` |
| `send_state`, `revision` | `Sent`, `0` |
| `voice` | `VoiceView::default()` |

## Tests

In `scenario.rs`, under `#[cfg(test)]`, reading `fixtures/scenarios/*.json`:

1. All exported scenarios parse.
2. `big-community`: community, channel and message counts equal the JSON's.
3. Messages are in `sentAt` order and `seq` strictly increases.
4. Each `TextSeg.end` falls on a char boundary, ends strictly increase, and the last equals `display.len()`.
5. A message edited to contain an unknown span type still produces a row with its text.
6. `empty-user` gives empty lists, with no error.

## `scripts/gen-scenarios.sh`

Runs the exporter, writes `fixtures/scenarios/`, and validates. `--check` fails if the output differs
from what's committed.

## Proof

```bash
scripts/gen-scenarios.sh
scripts/gen-scenarios.sh --check
scripts/in-image.sh python3 scripts/validate-scenarios.py
scripts/in-image.sh cargo test --locked -p semaphore-core --features fixtures
scripts/verify.sh
```

## Finish line

All exit 0. Report the file sizes, every normalization, and anything `layout_spans` couldn't represent
(don't change `text/mod.rs`: another unit owns it). Once they pass, stop. Don't render anything, don't
touch `semaphore-ui`, and don't add anything beyond this.
