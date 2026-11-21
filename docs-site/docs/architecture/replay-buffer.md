# Replay Buffer

Continuous screen recording during screen share sessions, allowing users to retroactively capture highlights — similar to NVIDIA ShadowPlay or OBS Replay Buffer.

## How it works

1. User enables replay buffer while screen sharing
2. LiveKit records the last 10 minutes as HLS segments (10-second chunks) via Track Composite Egress
3. User clicks "Capture Replay" to save the last 1, 2, 5, or 10 minutes
4. Backend concatenates segments with FFmpeg (stream copy, no re-encoding) into a single MP4

```mermaid
graph TD
    Browser["Browser<br/>(Screen Share)"] -->|WebRTC| LiveKit["LiveKit Server"]
    LiveKit -->|"HLS Segments<br/>(10s chunks)"| Storage["Shared Storage<br/>/replay-buffer/"]
    Storage -->|Read segments| Backend["Semaphore Chat Backend"]
    Backend -->|"FFmpeg concat<br/>(stream copy)"| Replays["Saved Replays<br/>/replays/"]
    Backend -->|File record| PostgreSQL[(PostgreSQL)]
```

## Key details

- **Egress type**: Track Composite Egress (GStreamer, ~1 CPU / ~1 GB RAM per recording — no Chrome instance needed)
- **Codec**: H.264 video, AAC-LC audio (44.1 kHz stereo; egress's segmented HLS output encodes AAC even when the encoding preset names Opus)
- **Storage**: sizes follow from the target video bitrate for the source resolution (plus 128 kbps audio). At 1080p (10,368 kbps video): ~945 MB per active 12-min buffer, ~790 MB per saved 10-min clip. At 1440p (18,432 kbps): ~1.67 GB per buffer, ~1.39 GB per clip
- **Cleanup**: Cron job every 5 min deletes segments older than 12 min; hourly cron stops orphaned egress sessions
- **Access control**: `ENABLE_REPLAY_BUFFER` permission + per-community concurrent limit (default 5) + per-user storage quota (default 5 GB)
- **Shared storage required**: LiveKit egress and the backend must read/write the same path — see the storage setup in [Docker Compose](../installation/docker-compose.md#replay-capture-livekit-egress) or [Kubernetes](../installation/kubernetes.md#replay-storage-livekit-egress)
