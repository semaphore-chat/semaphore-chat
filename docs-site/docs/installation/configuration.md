# Configuration

Semaphore Chat is configured through environment variables. The backend reads from `backend/.env` and the frontend from `frontend/.env`.

## Backend environment variables

Copy `backend/env.sample` to `backend/.env` to get started.

### Core

| Variable | Description | Default |
|----------|------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://semaphore:semaphore@postgres:5432/semaphore` |
| `JWT_SECRET` | Secret key for signing access tokens (32+ characters, random) | *(required)* |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens (32+ characters, random, different from `JWT_SECRET`) | *(required)* |
| `REDIS_HOST` | Redis hostname | `redis` |
| `NODE_ENV` | `production` (set by the published backend image), `development` or `test`. Anything but `development`/`test` gets the production checks below | `production` in the image |
| `COOKIE_SECURE` | `Secure` flag on the auth cookies: `auto` (Secure when the request came over HTTPS, as the trusted proxy reports in `X-Forwarded-Proto`), `true` or `false` | `auto` |

!!! note "`DATABASE_URL` options: SSL and connection pool"
    The backend connects through node-postgres (`pg`), which reads the options in the URL differently from the Prisma 6 query engine that earlier releases used:

    - **SSL certificates are verified.** `sslmode=require`, `prefer` and `verify-ca` behave like `verify-full`: the server certificate must chain to a trusted CA and match the hostname. Before, `sslmode=require` encrypted without checking the certificate. If your database uses a self-signed or private-CA certificate, mount the CA certificate into the container and add `sslrootcert=/path/to/ca.pem` to the URL; the certificate must also name the host in the URL. To check the CA but not the hostname, use `uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/path/to/ca.pem`. To encrypt without verifying (the old behaviour, not recommended), use `sslmode=no-verify`.
    - **Pool:** each backend process opens at most 10 connections. The backend no longer reads `connection_limit`, `pool_timeout`, `sslaccept` or `schema` from the URL. Keep the tables in the default `public` schema.

!!! danger "Secrets are checked at startup"
    Unless `NODE_ENV` is `development` or `test`, the backend refuses to start when `JWT_SECRET`, `JWT_REFRESH_SECRET` or `LIVEKIT_API_SECRET` is empty, shorter than 32 characters or a published placeholder (the `env.sample` values, `replace-with-...`, `CHANGE-ME-...`, `your-...`, LiveKit's `devkey` sample pair), or when the two JWT secrets are equal. The log names each variable to fix. Generate each value with:
    ```bash
    openssl rand -base64 64 | tr -d '\n'
    ```

### First-run setup

| Variable | Description | Default |
|----------|------------|---------|
| `REQUIRE_SETUP_TOKEN` | `true`: the setup wizard asks for the setup token printed in the backend log (one line containing `Setup token:`), and the API never returns it. `false`: the wizard gets the token from the API (only for instances nobody else can reach) | `true` |
| `SETUP_TOKEN` | Choose the setup token yourself, for unattended installs (16+ characters). It is never printed | unset (a random token is made and logged) |

The token is printed on every backend start while the instance needs setup, and never once setup is done. See [First Run](first-run.md).

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
| `S3_ENDPOINT` | *(Optional)* Custom endpoint — set for S3-compatible services like MinIO | `http://s3:9000` |
| `S3_FORCE_PATH_STYLE` | *(Optional)* Set `true` for MinIO and most self-hosted S3-compatible services (path-style addressing) | `true` |

!!! note "The backend always streams file bytes, never redirects"
    Uploads and downloads stream through the backend rather than presigning direct-to-S3 URLs, so the existing file access-control guards stay the single source of truth. Presigned URLs are a possible future optimization for read-heavy deployments, not implemented yet.

#### Local development with RustFS

The dev Docker Compose stack includes a RustFS service (S3-compatible, runs locally) behind an opt-in `s3` profile so it doesn't start by default:

```bash
docker compose --profile s3 up -d s3 s3-init
```

Then set in `backend/.env`:

```bash
STORAGE_TYPE=S3
S3_BUCKET=semaphore-dev
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://s3:9000
S3_FORCE_PATH_STYLE=true
```

The `s3-init` sidecar creates the `semaphore-dev` bucket automatically on first start. RustFS's web console (if you enable the console port in `docker-compose.yml`) is available at `http://localhost:9001` with the same credentials.

### LiveKit (voice/video)

These are optional — voice and video features are disabled if not configured.

The LiveKit server must be version **1.7 or later** (see [Connecting your LiveKit server](docker-compose.md#connecting-your-livekit-server)).

| Variable | Description | Example |
|----------|------------|---------|
| `LIVEKIT_URL` | LiveKit server URL returned to the browser for WebRTC connections | `wss://your-livekit-server.com` |
| `LIVEKIT_INTERNAL_URL` | *(Optional)* Internal URL for server-to-server LiveKit API calls. Falls back to `LIVEKIT_URL` if not set. Useful when LiveKit is on a Docker network (e.g., `http://livekit:7880`) while browsers need a different URL. | `http://livekit:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | `APIa1b2c3d4e5f6` |
| `LIVEKIT_API_SECRET` | LiveKit API secret (also used to verify webhook signatures — at least 32 random characters, e.g. `openssl rand -hex 32`) | *(random)* |

Voice/video is optional: set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` together, or none of them.

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

If Semaphore Chat runs behind a reverse proxy (Nginx, Traefik, Caddy, a cloud load balancer, etc.), set `TRUST_PROXY` so that rate-limiting (WebSocket connections included), session IPs and refresh token checks use the real client address instead of the proxy's. (A refresh token presented again moments after it was rotated is only honoured for the client that rotated it, by IP address and user agent. Without `TRUST_PROXY`, every client has the proxy's address and only the user agent tells them apart.)

Set it to the exact number of reverse proxy hops in front of the backend, usually `1`. Never set it higher than the real count, and never to `true`. The backend then takes the client address from the `X-Forwarded-For` header, so its port must only be reachable through the proxy. A client that reaches the backend directly can put any IP in that header. With Docker Compose, publish the backend port on `127.0.0.1` only (`"127.0.0.1:3000:3000"`), or not at all.

| Variable | Description | Default |
|----------|------------|---------|
| `TRUST_PROXY` | Number of trusted proxy hops, a subnet name, or a specific IP | unset (no proxy trusted) |
| `TRUSTED_PROXIES` | **Frontend container.** Addresses/CIDRs (space- or comma-separated) whose `X-Forwarded-For` the frontend's nginx believes, for its rate limits and the client address it passes to the backend. Opt-in: set it (e.g. `127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 ::1/128 fc00::/7`) only when a proxy is in front and clients cannot reach the frontend port directly. Unset behind a proxy, every client shares the proxy's rate-limit bucket; set while the port is directly reachable, clients can spoof their address. The Helm chart sets the private ranges when the ingress is enabled and the frontend Service is `ClusterIP` | unset (trust nobody) |
| `WS_CONNECTION_RATE_LIMIT` | WebSocket connections one client address may open per minute, per backend instance. Raise it if many users share one address (an office NAT) | `10` |

Common values:

| Value | When to use |
|-------|-------------|
| `1` | Single reverse proxy (Nginx, Traefik, k8s ingress) |
| `2` | CDN → reverse proxy → Semaphore Chat |
| `loopback` | Proxy connects over localhost (not with Docker, where the proxy's traffic arrives from the Docker network) |
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
