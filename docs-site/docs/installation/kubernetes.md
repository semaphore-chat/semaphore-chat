# Kubernetes

Deploy Semaphore Chat to a Kubernetes cluster using the official Helm chart.

## Architecture

```mermaid
graph LR
    Client[Browser] --> Ingress[NGINX Ingress]
    Ingress -->|/| Frontend[Frontend<br/>React + Nginx]
    Ingress -->|/api, /socket.io| Backend[Backend<br/>NestJS]
    Backend --> PostgreSQL[(PostgreSQL)]
    Backend --> Redis[(Redis)]
    Backend --> LiveKit[LiveKit Server]
    Backend --> FileStorage[(File Storage<br/>PVC)]
```

| Component | Replicas | Description |
|-----------|----------|-------------|
| **Backend** | 1 (default), 2+ requires shared file storage | NestJS API server + Socket.IO WebSocket server |
| **Frontend** | 2+ | Static React app served via nginx |
| **PostgreSQL** | 1+ | Database — bundled or external |
| **Redis** | 1 | Cache and Socket.IO adapter — bundled or external |
| **LiveKit** | external | Voice/video media server ([Cloud](https://cloud.livekit.io/) or [self-hosted](https://docs.livekit.io/home/self-hosting/deployment/)) |

## Prerequisites

- **Kubernetes** (v1.24+) — managed (GKE, EKS, AKS) or self-hosted (k3s, kubeadm)
- **Helm** (v3.8+)
- **kubectl** configured for your cluster
- **NGINX Ingress Controller**
- **LiveKit** — [LiveKit Cloud](https://cloud.livekit.io/) or a [self-hosted server](https://docs.livekit.io/home/self-hosting/deployment/)

Optional: **cert-manager** for automatic TLS, **metrics-server** for autoscaling.

## Quick start

### 1. Generate secrets

```bash
export JWT_SECRET=$(openssl rand -base64 32)
export JWT_REFRESH_SECRET=$(openssl rand -base64 32)
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export REDIS_PASSWORD=$(openssl rand -base64 32)
```

### 2. Install the chart

The simplest install uses bundled PostgreSQL and Redis:

```bash
helm install semaphore-chat oci://ghcr.io/semaphore-chat/semaphore-chat/charts/semaphore-chat \
  --set secrets.jwtSecret="$JWT_SECRET" \
  --set secrets.jwtRefreshSecret="$JWT_REFRESH_SECRET" \
  --set postgresql.auth.postgresPassword="$POSTGRES_PASSWORD" \
  --set redis.auth.password="$REDIS_PASSWORD" \
  --set ingress.hosts[0].host=semaphore.yourdomain.com \
  --set livekit.url=wss://your-livekit-server.com \
  --set livekit.apiKey=YOUR_KEY \
  --set livekit.apiSecret=YOUR_SECRET \
  --namespace semaphore-chat \
  --create-namespace
```

### 3. Verify

```bash
kubectl get pods -n semaphore-chat --watch
```

Wait for all pods to show `Running`, then visit your domain.

## Configuration

For anything beyond the quick start, create a values file:

```bash
helm install semaphore-chat oci://ghcr.io/semaphore-chat/semaphore-chat/charts/semaphore-chat \
  --values custom-values.yaml \
  --namespace semaphore-chat \
  --create-namespace
```

### Minimal values file

```yaml title="custom-values.yaml"
# --- Images ---
backend:
  image:
    repository: ghcr.io/semaphore-chat/semaphore-chat-backend
    tag: ""   # empty = the chart's version; pin e.g. "0.5.0" to override

frontend:
  image:
    repository: ghcr.io/semaphore-chat/semaphore-chat-frontend
    tag: ""   # empty = the chart's version; pin e.g. "0.5.0" to override

# --- Secrets ---
secrets:
  jwtSecret: ""      # Set via --set or use existingSecret
  jwtRefreshSecret: ""

# --- LiveKit ---
livekit:
  url: "wss://your-livekit-server.com"
  apiKey: "your-api-key"
  apiSecret: "your-api-secret"

# --- Ingress ---
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: semaphore.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: frontend
        - path: /api
          pathType: Prefix
          service: backend
        - path: /socket.io
          pathType: Prefix
          service: backend
  tls:
    mode: cert-manager
    certManager:
      issuer: letsencrypt-prod

# --- Data stores (bundled by default) ---
postgresql:
  bundled: true

redis:
  bundled: true
```

### Ingress

The chart configures path-based routing through an NGINX ingress with annotations for WebSocket support (long timeouts, sticky sessions, upgrade headers). Three routes are defined:

| Path | Routes to | Purpose |
|------|-----------|---------|
| `/` | Frontend | Static React app |
| `/api` | Backend | REST API |
| `/socket.io` | Backend | WebSocket real-time events |

**TLS modes:**

```yaml
# Automatic with cert-manager (recommended)
tls:
  mode: cert-manager
  certManager:
    issuer: letsencrypt-prod

# Existing TLS secret
tls:
  mode: manual
  secretName: my-tls-secret

# No TLS (dev only)
tls:
  mode: "none"
```

### PostgreSQL

The chart bundles a Bitnami PostgreSQL instance by default. For production, consider running PostgreSQL externally for more control:

=== "Bundled (default)"

    ```yaml
    postgresql:
      bundled: true
      auth:
        postgresPassword: "CHANGE-ME"
      persistence:
        size: 50Gi
    ```

=== "External"

    ```yaml
    postgresql:
      bundled: false
      external:
        uri: "postgresql://user:password@postgres-host:5432/semaphore"
    ```

### Redis

Same pattern — bundled or external:

=== "Bundled (default)"

    ```yaml
    redis:
      bundled: true
      auth:
        password: "CHANGE-ME"
      master:
        persistence:
          size: 10Gi
    ```

=== "External"

    ```yaml
    redis:
      bundled: false
      external:
        host: "redis.example.com"
        port: 6379
        password: "your-redis-password"
    ```

### LiveKit

Semaphore Chat requires a LiveKit server for voice and video. The chart doesn't bundle LiveKit — use [LiveKit Cloud](https://cloud.livekit.io/) or a [self-hosted deployment](https://docs.livekit.io/home/self-hosting/deployment/).

```yaml
livekit:
  url: "wss://your-livekit-server.com"
  apiKey: "your-api-key"
  apiSecret: "your-api-secret"
  webhookSecret: "your-webhook-secret"  # optional
```

Configure your LiveKit server to send webhooks to `https://your-domain.com/api/livekit/webhook` for voice presence tracking.

!!! note "Replay capture with LiveKit Cloud"
    LiveKit Cloud writes egress output to cloud storage (S3/GCS/Azure Blob), which Semaphore Chat can't read from yet. Replay capture is not available with LiveKit Cloud until cloud storage support is added — voice and video calls work normally. See [#227](https://github.com/semaphore-chat/semaphore-chat/issues/227) for progress.

### File storage

User-uploaded files (avatars, attachments) live on a PVC. `fileStorage.enabled` defaults to `true`, and the PVC's `accessMode` is chosen automatically from `fileStorage.accessMode` (default `""` = auto): `ReadWriteOnce` when the backend can only ever run 1 pod (`backend.replicaCount: 1`, the default, with autoscaling disabled or capped at `maxReplicas: 1`), and `ReadWriteMany` once the backend can scale beyond 1 pod (fixed `replicaCount > 1`, or HPA with `maxReplicas > 1`). `ReadWriteOnce` works with any storage class, including the RWO-only provisioners most clusters default to (EBS, GCP PD, Azure Disk, local-path, minikube hostpath) — this is why the default single-replica install works out of the box without any RWX storage.

To run more than one backend replica, point `fileStorage` at a `ReadWriteMany`-capable storage class or NFS export — the chart will auto-select `ReadWriteMany` once it detects more than one potential replica:

```yaml
backend:
  replicaCount: 2

fileStorage:
  enabled: true
  size: 100Gi
  storageClassName: "your-rwx-storage-class"  # e.g., EFS, AzureFile, NFS
```

You can also set `fileStorage.accessMode` explicitly (`"ReadWriteOnce"` or `"ReadWriteMany"`) to override auto-detection.

!!! warning "PVC accessModes are immutable"
    Kubernetes does not allow changing a PVC's `accessModes` after creation. If you're upgrading an existing release, keep `fileStorage.accessMode` set to whatever the PVC was already created with (older chart versions always used `ReadWriteMany`) — don't rely on auto-detection to change it. To actually switch modes, delete and let Helm recreate the PVC (this destroys any files that only lived there).

If you set `fileStorage.enabled: false`, an ephemeral `emptyDir` is used and files are lost on pod restart. The chart refuses to render if you combine this with a backend that can scale beyond 1 replica (`backend.replicaCount` or HPA `maxReplicas` `> 1`), since uploads would 404 on the other pods. Set `fileStorage.allowEphemeral: true` to explicitly accept that risk instead, or — better — enable S3 object storage below, which removes the requirement entirely. Similarly, the chart refuses to render if `fileStorage.accessMode` is explicitly forced to `ReadWriteOnce` while the backend can scale beyond 1 replica, since only one pod could mount the volume.

### S3 object storage

As an alternative to the RWX-capable PVC above, the backend can write uploads directly to S3 (or an S3-compatible provider — MinIO, Cloudflare R2, Backblaze B2, etc.). This is the simplest way to run more than one backend replica: S3 uploads need no shared filesystem, so the RWX/NFS requirement in [File storage](#file-storage) doesn't apply.

```yaml
fileStorage:
  # Set false once no files remain from a previous STORAGE_TYPE=LOCAL
  # deployment — see the mixed-mode note below. Leave true while migrating.
  enabled: false

  s3:
    enabled: true
    bucket: "my-semaphore-uploads"
    region: "us-east-1"
    # endpoint: "https://minio.example.com"  # only for S3-compatible providers
    # forcePathStyle: true                   # most self-hosted providers (e.g. MinIO) need this

    # Preferred: reference a pre-created Secret instead of putting credentials
    # in values (keeps them out of `helm get values` / release history).
    existingSecret: "my-s3-credentials"
    existingSecretAccessKeyIdKey: "S3_ACCESS_KEY_ID"       # key within the secret
    existingSecretSecretAccessKeyKey: "S3_SECRET_ACCESS_KEY"
```

Without `existingSecret`, set `fileStorage.s3.accessKeyId` and `fileStorage.s3.secretAccessKey` inline instead — the chart renders them into a Secret it manages (`<release>-s3-secret`):

```yaml
fileStorage:
  s3:
    enabled: true
    bucket: "my-semaphore-uploads"
    region: "us-east-1"
    accessKeyId: "AKIA..."
    secretAccessKey: "..."
```

`fileStorage.s3.bucket`, `region`, and credentials (via one of the two routes above) are required when `s3.enabled: true` — the chart fails to render with a descriptive error if any are missing, mirroring the backend's own `STORAGE_TYPE=S3` validation.

!!! note "Mixed mode: S3 plus the local PVC"
    `fileStorage.enabled` and `fileStorage.s3.enabled` are independent switches. If both are `true`, the uploads PVC stays mounted alongside S3 — this is "mixed mode," for files that were uploaded while `STORAGE_TYPE=LOCAL` was active before you switched to S3. New uploads go to S3, but pre-existing local files keep being served from the PVC, so the PVC's `accessMode`/RWX requirements (and the render-time guard) still apply to it at more than one backend replica. Once no LOCAL-storage files remain, set `fileStorage.enabled: false` to drop the PVC (and its RWX requirement) entirely — at that point the backend can scale to any replica count with no shared storage of any kind.

### Optional feature environment variables

Optional backend features new in v0.4.0 — Giphy GIF search, SMTP password reset, and background-job tuning — are configured via plain environment variables with no dedicated chart values. Set them with `backend.extraEnv`, added to the chart in this release, which accepts full Kubernetes `EnvVar` objects:

```yaml
backend:
  extraEnv:
    - name: PUBLIC_APP_URL
      value: "https://semaphore.yourdomain.com"
    - name: SMTP_HOST
      value: "smtp.example.com"
    - name: SMTP_FROM
      value: "Semaphore Chat <noreply@yourdomain.com>"
    - name: GIPHY_API_KEY
      valueFrom:
        secretKeyRef:
          name: my-semaphore-secrets
          key: GIPHY_API_KEY
    - name: SMTP_USER
      valueFrom:
        secretKeyRef:
          name: my-semaphore-secrets
          key: SMTP_USER
    - name: SMTP_PASS
      valueFrom:
        secretKeyRef:
          name: my-semaphore-secrets
          key: SMTP_PASS
```

!!! note "Using secrets.existingSecret instead"
    If you use `secrets.existingSecret` (see [Secrets management](#secrets-management)), extra keys added to that same Secret are injected automatically — the backend loads it via `envFrom.secretRef`, so no `extraEnv` entry is needed for values that already live there.

See [Configuration](configuration.md) for the full backend environment variable reference.

### Replay storage (LiveKit egress)

The replay/clip capture feature requires LiveKit egress and the Semaphore Chat backend to share a storage volume for HLS segment access. Both the egress service and backend pods must be able to read and write to the same path. Enable a `ReadWriteMany` PVC:

```yaml
replayStorage:
  enabled: true
  size: 50Gi
  storageClassName: "your-rwx-storage-class"  # must be ReadWriteMany (e.g., EFS, AzureFile, NFS)
```

Configure your LiveKit egress to write segments to the same volume mounted at the backend's `REPLAY_EGRESS_OUTPUT_PATH`.

### Secrets management

By default the chart creates a Kubernetes Secret from the values you provide. For production, use an external secret manager:

```yaml
secrets:
  existingSecret: "my-pre-created-secret"  # Helm won't create its own
```

The secret must contain: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_API_SECRET`, and `REDIS_PASSWORD` (if using Redis auth).

S3 credentials use a separate `fileStorage.s3.existingSecret` (see [S3 object storage](#s3-object-storage)) rather than this one, so you can manage/rotate them independently.

### Resources and autoscaling

!!! note "File storage required for multiple backend replicas"
    Scaling the backend beyond 1 potential replica (fixed `replicaCount`, or HPA `maxReplicas` — not `minReplicas`, since the HPA can scale up to `maxReplicas` at any time) requires EITHER `fileStorage.enabled: true` with a `ReadWriteMany` accessMode and an RWX-capable backend, OR `fileStorage.s3.enabled: true` (with `fileStorage.enabled: false`, once no local files remain) — see [File storage](#file-storage) and [S3 object storage](#s3-object-storage). The chart fails to render otherwise.

```yaml
backend:
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits: { cpu: 1000m, memory: 1Gi }
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70

frontend:
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 256Mi }
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 5
```

## Operations

### Upgrading

```bash
helm upgrade semaphore-chat oci://ghcr.io/semaphore-chat/semaphore-chat/charts/semaphore-chat \
  --reuse-values \
  --set backend.image.tag=v1.1.0 \
  --set frontend.image.tag=v1.1.0 \
  --namespace semaphore-chat
```

### Rollback

```bash
helm history semaphore-chat -n semaphore-chat
helm rollback semaphore-chat -n semaphore-chat        # previous version
helm rollback semaphore-chat 2 -n semaphore-chat      # specific revision
```

### Backup PostgreSQL

```bash
kubectl exec -n semaphore-chat semaphore-chat-postgresql-0 -- \
  pg_dump -U semaphore semaphore | gzip > backup.sql.gz
```

### Restore PostgreSQL

```bash
gunzip -c backup.sql.gz | kubectl exec -i -n semaphore-chat semaphore-chat-postgresql-0 -- \
  psql -U semaphore semaphore
```

### Logs

```bash
kubectl logs -n semaphore-chat -l app.kubernetes.io/component=backend -f
kubectl logs -n semaphore-chat -l app.kubernetes.io/component=frontend -f
```

## Troubleshooting

For WebSocket and LiveKit connectivity issues, see the dedicated [WebSocket Troubleshooting](../operations/websocket-troubleshooting.md) guide.

### Pods stuck in Pending

```bash
kubectl describe pod -n semaphore-chat <pod-name>
```

Common causes: insufficient resources, PVC not bound, image pull errors.

### Database connection errors

```bash
kubectl get pods -n semaphore-chat -l app.kubernetes.io/name=postgresql
kubectl exec -it -n semaphore-chat deploy/semaphore-chat-backend -- sh -c 'psql "$DATABASE_URL"'
```

### Ingress not working

```bash
kubectl describe ingress -n semaphore-chat
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller
```

## Production checklist

- [ ] All default passwords and secrets changed
- [ ] TLS enabled via cert-manager or manual secret
- [ ] Resource limits and autoscaling configured
- [ ] External PostgreSQL with authentication (recommended over bundled)
- [ ] External Redis with authentication
- [ ] `ReadWriteMany` PVC for file storage, or `fileStorage.s3.enabled: true` for S3 object storage
- [ ] LiveKit webhook URL configured
- [ ] Monitoring and alerting in place
- [ ] Backup strategy for PostgreSQL
- [ ] DNS configured for your domain
