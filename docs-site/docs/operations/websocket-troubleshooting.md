# WebSocket & LiveKit Troubleshooting

Troubleshooting guide for Socket.IO WebSocket and LiveKit connectivity issues in Kubernetes deployments.

## Architecture

Semaphore Chat uses two types of real-time connections:

1. **Socket.IO WebSockets** -- chat messages, presence, real-time updates
2. **LiveKit WebRTC** -- voice/video calls and screen sharing

```
Client Browser
    | WebSocket connection (with cookie affinity)
Ingress (NGINX)
    | Routes to same pod via cookie
Backend Pod A or Pod B
    | Publishes messages to Redis
Redis Pub/Sub
    | Broadcasts to all backend pods
All Backend Pods -> Emit to their connected clients
```

**Key**: Ingress cookie affinity keeps client connected to the same pod. Service-level affinity must be `None` so Redis can coordinate across pods.

---

## Common Issues

### Messages Not Delivered

**Symptoms**: Messages sent but not received, only visible to sender, intermittent delivery.

**Likely causes**: Service-level `sessionAffinity: ClientIP` blocking Redis coordination, Redis adapter disconnected, missing ingress sticky sessions.

### WebSocket Connection Fails

**Symptoms**: Connection failed/timeout, stays as HTTP polling, 400/403/502 errors.

**Likely causes**: Missing WebSocket upgrade annotations, auth issues, backend pods not ready.

### LiveKit DataChannel Errors

**Symptoms**: `Unknown DataChannel error on lossy/reliable`, `NotReadableError`.

**Likely causes**: Same ingress issues as WebSocket, LiveKit server connectivity, firewall blocking UDP/WebRTC, missing browser permissions.

### Connection Drops Immediately

**Symptoms**: Connects then disconnects within seconds, "ping timeout" errors, repeated connect/disconnect cycles.

**Likely causes**: Ingress timeout too short, service affinity issues, health checks interfering.

---

## Diagnostics

### Check Backend Pods

```bash
kubectl logs -n semaphore-chat -l app.kubernetes.io/component=backend --tail=50 | \
  grep -i "socket\|redis\|gateway"
```

Expected:
```
[RedisIoAdapter] Redis Socket.IO adapter configured successfully for multi-pod coordination
[MessagesGateway] MessagesGateway initialized
[PresenceGateway] PresenceGateway initialized
```

### Check Redis

```bash
kubectl get pods -n semaphore-chat -l app.kubernetes.io/name=redis
kubectl exec -it -n semaphore-chat deploy/semaphore-chat-backend -- sh -c 'nc -zv $REDIS_HOST $REDIS_PORT'
```

### Check Ingress

```bash
kubectl get ingress -n semaphore-chat -o yaml
```

Required annotations:

```yaml
nginx.ingress.kubernetes.io/websocket-services: "semaphore-chat-backend"
nginx.ingress.kubernetes.io/affinity: "cookie"
nginx.ingress.kubernetes.io/session-cookie-name: "semaphore-chat-affinity"
nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
nginx.ingress.kubernetes.io/affinity-mode: "persistent"
nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

### Check Service Affinity

```bash
kubectl get service -n semaphore-chat semaphore-chat-backend -o jsonpath='{.spec.sessionAffinity}'
```

!!! warning "Critical"
    Must return `None`, **not** `ClientIP`. Service-level ClientIP affinity breaks Redis coordination across pods.

### Test WebSocket Upgrade

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://your-domain.com/socket.io/?EIO=4&transport=websocket
```

Expected: `HTTP/1.1 101 Switching Protocols`

---

## Solutions

### Fix Service Session Affinity

```bash
kubectl get service -n semaphore-chat semaphore-chat-backend -o yaml | grep sessionAffinity
# If "ClientIP", upgrade Helm chart:
helm upgrade semaphore-chat ./helm/semaphore-chat -n semaphore-chat --reuse-values
kubectl rollout restart deployment/semaphore-chat-backend -n semaphore-chat
```

### Add Missing Ingress Annotations

Update `values.yaml` with the annotations listed above, then:

```bash
helm upgrade semaphore-chat ./helm/semaphore-chat -n semaphore-chat --reuse-values
```

### Fix Redis Connection

```bash
kubectl get secret -n semaphore-chat semaphore-chat-redis -o jsonpath='{.data.redis-password}' | base64 -d
# Verify password matches backend ConfigMap, restart if needed:
kubectl rollout restart deployment/semaphore-chat-backend -n semaphore-chat
```

### Fix LiveKit Browser Permissions

1. Verify HTTPS is enabled (required for WebRTC)
2. Check browser permissions for microphone/camera
3. Close other apps using the device
4. Try a different browser

### Voice Works for Some Users but Not Others

**Symptoms**: A user joins a voice channel and hears nothing, and nobody hears them; calls connect and then drop, and reconnecting fails; it works from home but not from the office or campus network.

**Likely cause**: The user's network blocks direct WebRTC (UDP 7882, TCP 7881) and allows only 80/443. Enable LiveKit's built-in TURN server so media falls back to TLS on 443 — and, if a reverse proxy already owns 443, route TURN by SNI. See [TURN behind a reverse proxy](../installation/livekit-turn.md).

---

## Verification

1. **Browser DevTools** -> Network -> Filter "WS" -> look for `101 Switching Protocols`
2. **Open two windows** with different users, send a message, verify delivery
3. **With multiple replicas**: Send message from user on Pod A, verify user on Pod B receives it
4. **Check cookies**: Application tab -> look for `semaphore-chat-affinity` cookie

---

## Pre-Deployment Checklist

- [ ] Ingress has all required WebSocket annotations
- [ ] Service has `sessionAffinity: None`
- [ ] Redis is deployed and accessible
- [ ] Backend pods log "Redis Socket.IO adapter configured successfully"
- [ ] HTTPS/TLS is enabled (required for WebRTC)
- [ ] Tested with 2+ backend replicas
- [ ] Tested message delivery between users on different pods
- [ ] Tested voice/video calls with LiveKit
- [ ] TURN configured and its relay UDP range reachable, if users may be behind firewalls that only allow 80/443
