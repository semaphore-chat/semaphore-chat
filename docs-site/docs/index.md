---
hide:
  - navigation
---

# Semaphore Chat

**Self-hosted voice and text chat.**

Semaphore Chat is an open-source communication platform that gives you full control over your data. Built with a modern stack — NestJS, React, PostgreSQL, and LiveKit — it provides real-time messaging, voice and video calls, and community management out of the box.

---

## Features

- **Real-time messaging** — WebSocket-powered text channels with mentions, reactions, threads, file attachments, and read receipts
- **Voice & video calls** — Powered by [LiveKit](https://livekit.io/) with screen sharing and system audio capture on the desktop app. Voice connections persist across page navigation
- **Replay capture** — Continuously buffers screen share sessions so you can retroactively clip the last 1-10 minutes with a visual trim timeline. Share clips to channels, DMs, or save them to a personal clip library with storage quotas. See [Replay Buffer Architecture](architecture/replay-buffer.md)
- **Desktop app** — [Electron client](installation/desktop-app.md) for Windows and Linux with a custom screen source picker showing live thumbnails, configurable resolution and frame rate, system tray integration, and auto-updates
- **Communities** — Create servers with text and voice channels, private channels, direct messages, and group DMs with file attachments
- **Role-based access control** — Granular permissions at the instance and community level, with community bans, timeouts, and moderation logs
- **Mobile-friendly** — Responsive design with swipe navigation, mobile-optimized layouts, PWA support with push notifications
- **Self-hosted** — Run on your own infrastructure with [Docker Compose](installation/docker-compose.md) or [Kubernetes](installation/kubernetes.md). Your data stays yours

---

## Quick links

<div class="grid cards" markdown>

- :material-rocket-launch: **[Installation](installation/docker-compose.md)**

    Get Semaphore Chat running with Docker Compose — from first launch to production.

- :material-cog: **[Configuration](installation/configuration.md)**

    Environment variables reference for backend and frontend.

- :material-ship-wheel: **[Kubernetes](installation/kubernetes.md)**

    Deploy Semaphore Chat to a Kubernetes cluster with the official Helm chart.

- :material-monitor-arrow-down: **[Desktop App](installation/desktop-app.md)**

    Download the Electron desktop client for Windows and Linux.

- :material-account-group: **[Contributing](contributing/index.md)**

    Help improve Semaphore Chat — bug reports, features, and code contributions.

</div>

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | [NestJS](https://nestjs.com/) (TypeScript) |
| Frontend | [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [Material UI](https://mui.com/) |
| Database | [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/) |
| Real-time | [Socket.IO](https://socket.io/) with Redis adapter |
| Voice/Video | [LiveKit](https://livekit.io/) |
| State | [TanStack Query v5](https://tanstack.com/query/latest) |
| Auth | JWT with [Passport.js](https://www.passportjs.org/) |
| Desktop | [Electron](https://www.electronjs.org/) |

---

## License

Semaphore Chat is **dual-licensed** under the [AGPLv3](license.md) and a commercial license. Free for everyone — including commercial use — as long as you comply with AGPL terms. A commercial license is available for proprietary deployments.

Contact: licensing {at} semaphorechat [dot] app
