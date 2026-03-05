# Configuration

Kraken is configured through environment variables. The backend reads from `backend/.env` and the frontend from `frontend/.env`.

## Backend environment variables

Copy `backend/env.sample` to `backend/.env` to get started.

### Core

| Variable | Description | Default |
|----------|------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://kraken:kraken@postgres:5432/kraken` |
| `JWT_SECRET` | Secret key for signing access tokens | *(must change)* |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | *(must change)* |
| `REDIS_HOST` | Redis hostname | `redis` |

!!! danger "Change the JWT secrets"
    The default secrets in `env.sample` are placeholders. Always generate strong random values for production:
    ```bash
    openssl rand -base64 32
    ```

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

### Reverse proxy

If Kraken runs behind a reverse proxy (Nginx, Traefik, Caddy, a cloud load balancer, etc.), set `TRUST_PROXY` so that rate-limiting and session IPs use the real client address instead of the proxy's.

| Variable | Description | Default |
|----------|------------|---------|
| `TRUST_PROXY` | Number of trusted proxy hops, a subnet name, or a specific IP | `1` |

Common values:

| Value | When to use |
|-------|-------------|
| `1` | Single reverse proxy (Nginx, Traefik, k8s ingress) |
| `2` | CDN → reverse proxy → Kraken |
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

## Frontend environment variables

Copy `frontend/.env.sample` to `frontend/.env`. The defaults work for local Docker development.

| Variable | Description | Default |
|----------|------------|---------|
| `VITE_API_URL` | Backend API URL (Vite proxies this in dev; nginx proxies in production) | `/api` |
| `VITE_WS_URL` | WebSocket URL for Socket.IO | `http://localhost:3000` |

### Telemetry (optional)

| Variable | Description |
|----------|------------|
| `VITE_TELEMETRY_ENDPOINT` | OpenObserve instance URL |
| `VITE_TELEMETRY_CLIENT_TOKEN` | OpenObserve client token |
| `VITE_TELEMETRY_ORG_ID` | OpenObserve organization ID |
| `VITE_APP_VERSION` | App version reported to telemetry |

Leave telemetry variables blank to disable.

## Production considerations

- **JWT secrets** — Use long, random strings. Never reuse across environments.
- **PostgreSQL** — Use authentication and restrict network access.
- **Redis** — Enable authentication and restrict network access.
- **HTTPS** — Always use TLS in production. Configure via your reverse proxy or Kubernetes ingress.
- **VAPID keys** — Generate once per instance and keep stable. Changing them invalidates existing push subscriptions.
