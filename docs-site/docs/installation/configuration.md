# Configuration

Kraken is configured through environment variables. The backend reads from `backend/.env` and the frontend from `frontend/.env`.

## Backend environment variables

Copy `backend/env.sample` to `backend/.env` to get started.

### Core

| Variable | Description | Default |
|----------|------------|---------|
| `MONGODB_URL` | MongoDB connection string (must include `replicaSet=rs0`) | `mongodb://mongo:27017/kraken?replicaSet=rs0&retryWrites=true&w=majority&directConnection=true` |
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
- **MongoDB** — Use a replica set with authentication enabled. Restrict network access.
- **Redis** — Enable authentication and restrict network access.
- **HTTPS** — Always use TLS in production. Configure via your reverse proxy or Kubernetes ingress.
- **VAPID keys** — Generate once per instance and keep stable. Changing them invalidates existing push subscriptions.
