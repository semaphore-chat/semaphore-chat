# Configuration

Semaphore Chat is configured through environment variables. The backend reads from `backend/.env` and the frontend from `frontend/.env`.

## Backend environment variables

Copy `backend/env.sample` to `backend/.env` to get started.

### Core

| Variable | Description | Default |
|----------|------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://semaphore:semaphore@postgres:5432/semaphore` |
| `JWT_SECRET` | Secret key for signing access tokens | *(must change)* |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | *(must change)* |
| `REDIS_HOST` | Redis hostname | `redis` |

!!! note "`DATABASE_URL` options: SSL and connection pool"
    The backend connects through node-postgres (`pg`), which reads the options in the URL differently from the Prisma 6 query engine that earlier releases used:

    - **SSL certificates are verified.** `sslmode=require`, `prefer` and `verify-ca` behave like `verify-full`: the server certificate must chain to a trusted CA and match the hostname. Before, `sslmode=require` encrypted without checking the certificate. If your database uses a self-signed or private-CA certificate, mount the CA certificate into the container and add `sslrootcert=/path/to/ca.pem` to the URL; the certificate must also name the host in the URL. To check the CA but not the hostname, use `uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/path/to/ca.pem`. To encrypt without verifying (the old behaviour, not recommended), use `sslmode=no-verify`.
    - **Pool:** each backend process opens at most 10 connections. The backend no longer reads `connection_limit`, `pool_timeout`, `sslaccept` or `schema` from the URL. Keep the tables in the default `public` schema.

!!! danger "Change the JWT secrets"
    The default secrets in `env.sample` are placeholders. Always generate strong random values for production:
    ```bash
    openssl rand -base64 32
    ```

### File storage

File uploads (message attachments, avatars, banners, custom emoji, soundboard sounds) can be stored on the local filesystem or in an S3-compatible object store. Storage is resolved **per file record** — switching `STORAGE_TYPE` only affects where *new* uploads land; existing files keep working from wherever they were originally stored, so mixed-storage instances (e.g. after a mid-life migration to S3) work with zero migration.

| Variable | Description | Default |
|----------|------------|---------|
| `STORAGE_TYPE` | `LOCAL` or `S3` | `LOCAL` |
| `FILE_UPLOAD_DEST` | Local staging directory. For `STORAGE_TYPE=LOCAL` this is also the permanent storage location; for `STORAGE_TYPE=S3` it's scratch space only (files are uploaded to the bucket, then removed) | `./uploads` |

The following are only required when `STORAGE_TYPE=S3` (validated at startup):

| Variable | Description | Example |
|----------|------------|---------|
| `S3_BUCKET` | Target bucket name | `semaphore-chat-uploads` |
| `S3_REGION` | AWS region (or an arbitrary value for MinIO) | `us-east-1` |
| `S3_ACCESS_KEY_ID` | Access key | |
| `S3_SECRET_ACCESS_KEY` | Secret key | |
| `S3_ENDPOINT` | *(Optional)* Custom endpoint — set for S3-compatible services like MinIO | `http://minio:9000` |
| `S3_FORCE_PATH_STYLE` | *(Optional)* Set `true` for MinIO and most self-hosted S3-compatible services (path-style addressing) | `true` |

!!! note "The backend always streams file bytes, never redirects"
    Uploads and downloads stream through the backend rather than presigning direct-to-S3 URLs, so the existing file access-control guards stay the single source of truth. Presigned URLs are a possible future optimization for read-heavy deployments, not implemented yet.

#### Local development with MinIO

The dev Docker Compose stack includes a MinIO service (S3-compatible, runs locally) behind an opt-in `s3` profile so it doesn't start by default:

```bash
docker compose --profile s3 up -d minio minio-init
```

Then set in `backend/.env`:

```bash
STORAGE_TYPE=S3
S3_BUCKET=semaphore-dev
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
```

The `minio-init` sidecar creates the `semaphore-dev` bucket automatically on first start. MinIO's web console (if you enable the console port in `docker-compose.yml`) is available at `http://localhost:9001` with the same credentials.

### LiveKit (voice/video)

These are optional — voice and video features are disabled if not configured.

| Variable | Description | Example |
|----------|------------|---------|
| `LIVEKIT_URL` | LiveKit server URL returned to the browser for WebRTC connections | `wss://your-livekit-server.com` |
| `LIVEKIT_INTERNAL_URL` | *(Optional)* Internal URL for server-to-server LiveKit API calls. Falls back to `LIVEKIT_URL` if not set. Useful when LiveKit is on a Docker network (e.g., `http://livekit:7880`) while browsers need a different URL. | `http://livekit:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | `your-api-key` |
| `LIVEKIT_API_SECRET` | LiveKit API secret (also used to verify webhook signatures — must be at least 32 characters) | `your-api-secret` |

### Replay buffer

Configuration for the replay buffer / screen recording feature. Requires LiveKit egress to be set up.

| Variable | Description | Default |
|----------|------------|---------|
| `REPLAY_SEGMENTS_PATH` | Backend storage path for replay metadata | `/app/storage/replay-segments` |
| `REPLAY_EGRESS_OUTPUT_PATH` | LiveKit egress output path (must be accessible by egress pods) | `/out` |
| `REPLAY_SEGMENT_CLEANUP_AGE_MINUTES` | How long to keep replay segments before cleanup | `20` |
| `REPLAY_ORPHAN_SWEEP_ENABLED` | Hourly reconciliation sweep that deletes segment directories no session references anymore (crashed recordings, missed webhooks, failed cleanups). Set `false` to disable | `true` |
| `REPLAY_ORPHAN_SWEEP_GRACE_HOURS` | Minimum directory age before the orphan sweep may delete it | `24` |

### Reverse proxy

If Semaphore Chat runs behind a reverse proxy (Nginx, Traefik, Caddy, a cloud load balancer, etc.), set `TRUST_PROXY` so that rate-limiting and session IPs use the real client address instead of the proxy's.

| Variable | Description | Default |
|----------|------------|---------|
| `TRUST_PROXY` | Number of trusted proxy hops, a subnet name, or a specific IP | `1` |

Common values:

| Value | When to use |
|-------|-------------|
| `1` | Single reverse proxy (Nginx, Traefik, k8s ingress) |
| `2` | CDN → reverse proxy → Semaphore Chat |
| `loopback` | Proxy runs on the same host (localhost) |
| `10.0.0.0/8` | Trust a specific internal subnet |

!!! warning "Never use `true` in production"
    `true` trusts **all** `X-Forwarded-For` headers, which lets any client spoof their IP and bypass rate-limiting. Always use a hop count or subnet.

See the [Express proxy documentation](https://expressjs.com/en/guide/behind-proxies.html) for all supported values.

### Dynamic IP watcher

Configuration for the optional IP watcher sidecar. See [Dynamic IP support](docker-compose.md#dynamic-ip-support) for setup instructions.

| Variable | Description | Default |
|----------|------------|---------|
| `IP_WATCHER_CHECK_INTERVAL` | Seconds between external IP checks | `300` |

### Push notifications (VAPID)

Web Push notifications require VAPID keys. Each instance needs its own unique key pair.

| Variable | Description | Example |
|----------|------------|---------|
| `VAPID_PUBLIC_KEY` | VAPID public key | *(generate with command below)* |
| `VAPID_PRIVATE_KEY` | VAPID private key | *(generate with command below)* |
| `VAPID_SUBJECT` | Contact email for VAPID | `mailto:admin@your-instance.com` |

Generate VAPID keys:

```bash
docker compose run --rm backend npx web-push generate-vapid-keys
```

### Password reset email (SMTP)

Self-service password reset is optional. The feature is auto-disabled — no error at startup, the reset endpoints and UI simply stay off — unless `SMTP_HOST`, `SMTP_FROM`, **and** `PUBLIC_APP_URL` are all set.

| Variable | Description | Default |
|----------|------------|---------|
| `SMTP_HOST` | Hostname of the SMTP server | *(unset — feature disabled)* |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | `true` for implicit TLS (typically port 465). `false` uses STARTTLS. | `false` |
| `SMTP_USER` | *(Optional)* SMTP auth username | |
| `SMTP_PASS` | *(Optional)* SMTP auth password | |
| `SMTP_FROM` | From address for outbound mail, e.g. `"Semaphore Chat <noreply@your-instance.com>"` | *(unset — feature disabled)* |
| `PUBLIC_APP_URL` | Public base URL of the instance, used to build password-reset links in emails, e.g. `https://chat.your-instance.com` | *(unset — feature disabled)* |

!!! note "SMTP_USER and SMTP_PASS"
    These must be set together or not at all — startup validation fails if only one is provided.

!!! warning "SMTP_HOST requires SMTP_FROM"
    Startup validation fails if `SMTP_HOST` is set without `SMTP_FROM`.

!!! note "PUBLIC_APP_URL has a second use"
    It's also used to build absolute incoming-webhook execution URLs. When unset, webhook URLs are returned as relative API paths instead.

### GIF search (Giphy)

| Variable | Description | Default |
|----------|------------|---------|
| `GIPHY_API_KEY` | Giphy API key — get a free one at [developers.giphy.com/dashboard](https://developers.giphy.com/dashboard/) | *(unset — feature disabled)* |

!!! note "Disabled when absent"
    Without `GIPHY_API_KEY`, the GIF picker is hidden in the UI and the `/gifs` endpoints return `503`.

`TENOR_API_KEY` from v0.4.0 is deprecated and ignored — replace it with `GIPHY_API_KEY`.

### Background jobs (BullMQ)

Message-notification fan-out and link previews run on a BullMQ background queue. It reuses the app's existing `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` variables but opens its own Redis connection (BullMQ requires `maxRetriesPerRequest: null`). Processors run in-process in the backend container — no separate worker deployment is needed.

| Variable | Description | Default |
|----------|------------|---------|
| `JOB_WORKER_CONCURRENCY` | Max jobs processed in parallel per queue per process | `4` |
| `CHANNEL_MESSAGE_MEMBER_THRESHOLD` | Max community size for `CHANNEL_MESSAGE` notification fan-out. Public channels in communities above this member count skip fan-out (logged as a warning) to protect the database on self-hosted instances | `5000` |

### Thumbnail backfill

On startup, Semaphore Chat retries thumbnail generation for video files that don't have one yet (e.g. uploaded before thumbnail support existed, or whose generation failed). This is deferred and batched so it can't spike memory at boot: at most one ffmpeg frame-extraction child process runs at a time (capped at 30s), and the database working set per batch is just `THUMBNAIL_BACKFILL_BATCH_SIZE` rows of `{ id, storagePath }`.

| Variable | Description | Default |
|----------|------------|---------|
| `THUMBNAIL_BACKFILL_ENABLED` | Set to `false` to disable the backfill entirely | `true` |
| `THUMBNAIL_BACKFILL_BATCH_SIZE` | Rows fetched per batch (id-cursor pagination) | `25` |
| `THUMBNAIL_BACKFILL_STARTUP_DELAY_MS` | Delay before starting, so it runs after peak startup memory has settled | `60000` |
| `THUMBNAIL_BACKFILL_THROTTLE_MS` | Delay between files, to spread out ffmpeg/DB load | `1000` |

## Frontend environment variables

Copy `frontend/.env.sample` to `frontend/.env`. The defaults work for local Docker development.

| Variable | Description | Default |
|----------|------------|---------|
| `VITE_API_URL` | Backend API URL (Vite proxies this in dev; nginx proxies in production) | `/api` |
| `VITE_WS_URL` | WebSocket URL for Socket.IO | `http://localhost:3000` |

## Production considerations

- **JWT secrets** — Use long, random strings. Never reuse across environments.
- **PostgreSQL** — Use authentication and restrict network access.
- **Redis** — Enable authentication and restrict network access.
- **HTTPS** — Always use TLS in production. Configure via your reverse proxy or Kubernetes ingress.
- **VAPID keys** — Generate once per instance and keep stable. Changing them invalidates existing push subscriptions.
