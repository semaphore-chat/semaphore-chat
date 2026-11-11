# Rules every unit follows

These apply to every spec here. An agent reading a spec has no other context.

- **Docker only.** Never run cargo, pnpm or node on the host. From `native/`, use
  `scripts/in-image.sh <command>`; for the web client, use `scripts/export-web.sh`.
- **Stay in your owned paths.** The spec lists them. If something else must change, stop and report.
- **Don't change frozen API:** `crates/semaphore-core/src/model.rs`, `commands.rs`, `realtime.rs`,
  `CoreEvent`.
- **No `sleep` as a wait.** Wait on a condition, with a bounded loop.
- **No Docker networks.** Don't create or remove any. Don't run `docker compose` directly.
- **No GPL in anything shipped.** `deny.toml` allows licenses by name. Never copy from Zed's GPL crates
  (`livekit_client`, `ui`, `markdown`, `audio`).
- **Nothing UI or C-building may reach `semaphore-core` or `semaphore-wire`.**
- **Don't commit or push.** Leave changes in the working tree.
- **Before stopping, run** `scripts/in-image.sh cargo fmt --all --check`,
  `scripts/in-image.sh cargo clippy --workspace -- -D warnings` and your spec's proof, and paste each
  command with its real output in your report.
- **Stop at the finish line.** Don't add anything the spec doesn't ask for.
