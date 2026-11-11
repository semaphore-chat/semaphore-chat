# U11 proofs

Everything here runs in Docker and on `semaphore-test`, against `scripts/lk-stack.sh`.

| What | Command, from `native/` |
|---|---|
| Voice by tone against a real SFU | `crates/semaphore-media-livekit/proof/test-voice.sh` |
| Real device path, real sound server | `crates/semaphore-media-livekit/proof/proof.py real-audio --server pipewire` (or `pulseaudio`) |
| Reconnect by tone and video | `.../proof.py rejoin netkill --outage-s 90`, `--outage-s 20`, `.../proof.py rejoin lkrestart` |
| What each receive policy costs | `.../proof.py bench` (`--cpuset 0-3` to pin the receiver) |
| Real frames in the real renderer | `.../proof.py shots` |
| A real window and event loop | `.../proof.py window [--rgba]` |
| Stories | `scripts/in-image.sh crates/semaphore-media-livekit/proof/stories.sh` |

The rigs need `scripts/in-image.sh cargo build --release -p semaphore-media-livekit --example voice_rig`.
`results/` holds the last run of each.

`examples/voice_rig.rs`'s `FramesSink`, `EngineController` and `to_model` are all the app needs to
connect the engine to `VoiceStage`.
