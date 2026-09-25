# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Prisma 7** — The backend moves from Prisma 6.19 to 7.9.1 (pinned exactly: the `prisma@7.10.0` CLI was published without npm provenance). The database client now connects through node-postgres (`@prisma/adapter-pg`) instead of Prisma's Rust query engine, and the migrate CLI reads the database URL from `backend/prisma.config.ts`.

### Upgrade notes

- **Database SSL:** `sslmode=require` (also `prefer` and `verify-ca`) in `DATABASE_URL` now verifies the server certificate, like `verify-full`. Before, it encrypted without checking the certificate. Instances that connect to a database with a self-signed or private-CA certificate must add `sslrootcert=/path/to/ca.pem` (with the CA certificate mounted into the container; the certificate must also match the hostname, or use `uselibpqcompat=true&sslmode=verify-ca&sslrootcert=...`) or, to keep the old unverified behaviour, use `sslmode=no-verify`. Otherwise the backend fails to connect at startup. `prisma migrate deploy` still uses its own driver, so the migration step can succeed while the app fails. Instances without SSL in `DATABASE_URL` (the Docker Compose and bundled Helm PostgreSQL defaults) are unaffected. See [Configuration](https://docs.semaphorechat.app/installation/configuration/).
- **Connection pool:** each backend process now opens at most 10 database connections (node-postgres' default; before it was Prisma's `2 × CPUs + 1`). The backend no longer reads the `connection_limit`, `pool_timeout`, `sslaccept` and `schema` URL parameters.
- **Custom images:** an image built from a customised `backend/Dockerfile.prod` must also copy `backend/prisma.config.ts` into the runtime stage. Without it, `migrate deploy` (the entrypoint and the Helm migration job) fails with `The datasource.url property is required in your Prisma config file`.

## [0.4.3] - 2026-08-19

### Fixed

- **Windows Desktop App Crash on Launch** — Every Windows build of v0.4.0–v0.4.2 crashed at startup with `Invalid package config ...app.asar\electron\dist\package.json` (no window, orphaned background processes). The `build-electron` script wrote `electron/dist/package.json` with a shell `echo` under single quotes; on the Windows CI runner the script shell is cmd.exe, which treats single quotes as literal characters, so the shipped file was not valid JSON and Electron's module resolver threw before any app code ran. The file (and the `.cjs` renames) are now written by Node itself (`fs.writeFileSync`/`renameSync` + `JSON.stringify`), which is shell-independent, and `build:all` now fails the build if the emitted artifacts are missing or unparseable. **Note for Windows users on 0.4.0–0.4.2**: the app crashes before the auto-updater can run, so this one update must be installed manually — download and run the 0.4.3 installer (it closes the broken instances itself). Auto-update works again from then on. Windows users still on 0.3.x auto-update normally; Linux builds were never affected.

## [0.4.2] - 2026-08-18

### Changed

- **Inline GIF Embeds** — Messages consisting solely of a GIF URL (what the GIF picker sends) now render the animated GIF inline, Discord-style — no raw URL text, no generic link-preview card. Applies retroactively to existing GIF messages (including legacy Tenor ones); broken media URLs fall back to the old link rendering.

### Fixed

- **Linux .deb Auto-Update** — Desktop auto-update on .deb installs failed with `Command pkexec exited with code 127`: electron-updater 6.8.3 (current upstream included) wraps the install command in literal single quotes inside `bash -c`, so bash resolves the whole string as one nonexistent command name. Patched via `pnpm patch` to drop the bogus quoting on the pkexec/sudo path. **Note for existing .deb installs**: the updater that runs is the one already installed, so 0.4.x .deb users must install the next release manually once (`sudo dpkg -i <deb>`); auto-update works again from then on. AppImage users are unaffected.

## [0.4.1] - 2026-08-18

### Changed

- **GIF Search Provider: Giphy** — Switched the GIF search backend from Tenor to Giphy behind a new swappable provider interface; the API contract is unchanged. The picker now shows the required "Powered by GIPHY" attribution.

### Fixed

- **Replay Orphan Segment Sweep** — Replay egress segment directories no longer accumulate forever when their session row is gone (crashed recordings, missed egress webhooks, failed cleanup attempts, DB resets). An hourly reconciliation cron now deletes segment directories older than a grace period that no active session references. New env vars: `REPLAY_ORPHAN_SWEEP_ENABLED` (default `true`), `REPLAY_ORPHAN_SWEEP_GRACE_HOURS` (default `24`). Observed in production as ~5GB of orphaned recordings accumulating over 9 months.

### Upgrade notes

- `GIPHY_API_KEY` replaces `TENOR_API_KEY` (deprecated, ignored, startup warning). Instances using GIF search must swap the env var; nothing else changes.
- The replay orphan sweep is on by default and will delete any leftover orphaned segment directories (older than 24h, unreferenced by an active session) within an hour of upgrading — this is the intended cleanup of the accumulated leak. Set `REPLAY_ORPHAN_SWEEP_ENABLED=false` beforehand if you want to inspect those directories first.

## [0.4.0] - 2026-08-18

### Added

- **S3 Object Storage** — S3-compatible object storage backend for file uploads, selectable per-deployment alongside local filesystem storage (#427)
- **Password Reset via Email** — Self-service password reset flow over SMTP (#412)
- **Tenor GIF Picker** — GIF picker in the message composer, backed by a server-side Tenor search proxy (#411)
- **Incoming Channel Webhooks** — Create incoming webhooks per channel to post messages from external services (#413), with a per-webhook-id rate limit on the execute endpoint (#419)
- **Background Job Queue** — BullMQ-backed queue for async notification fan-out, with batched eligibility checks for large channels (#429)
- **Optimistic Message Sending** — Messages appear immediately with pending/failed states while the send round-trips (#431)
- **Cursor-Paginated Member Lists** — Community member lists use cursor pagination, with list caps applied consistently across the API (#430)
- **Push Mark-as-Read** — Action button on push notifications to mark the originating message read without opening the app (#438)
- **Electron Deep Links** — `semaphore://` custom protocol for deep-linking into the desktop app (#432)
- **Electron Hardening** — Explicit sandboxing, origin-checked permission requests, and secure-storage transparency for the desktop app (#420)
- **Electron PR Smoke Build** — CI now produces a smoke build of the desktop app on every PR (#421)
- **Accessibility: Mention/Emoji/Menus** — Keyboard navigation and ARIA support for the mention dropdown, emoji picker, and menus (#428)
- **Accessibility: Message List** — Keyboard navigation and screen-reader announcements for the message list (#434)
- **Error Boundaries** — App-level and route-level error boundaries so a component crash no longer blanks the whole page (#418)
- **Helm S3 Configuration** — New `fileStorage.s3.*` values to configure S3-compatible object storage from the chart, with the multi-replica-guard relaxed accordingly (#433)
- **Helm `backend.extraEnv`** — Inject arbitrary env vars into the backend container for optional features (Tenor, SMTP, job tuning)

### Changed

- **Message Dispatch Pipeline** — Consolidated message send/broadcast logic into a shared dispatch pipeline with Redis-backed WS throttle state (#422)
- **Single Virtualized Message List** — `virtua` is now the only message-list renderer, removing the legacy non-virtualized fallback (#426)
- **RBAC Permission Cache** — Redis-backed permission cache with epoch-based invalidation, cutting repeated permission-check DB load (#423)
- **Presence Re-render Fix** — Presence events no longer re-render whole member lists (#424)

### Fixed

- **WebSocket Payload Serialization** — WS payloads are normalized to JSON wire form at emit, so raw `Date` fields no longer arrive as `{}` on clients connected to a different replica (notepack encoding under the Redis adapter) (#441)
- **Unread Badges** — Stopped peer DM reads from wiping unread badges on other devices; auto-read now gates on window focus (#436)
- **Live-Edge Detachment** — Fixed cache corruption and stranding at the `MESSAGE_MAX_PAGES` cap, including virtua-prepend detection at the cap (#404) (#415, #416)
- **Thumbnail Backfill OOM** — Batched and deferred thumbnail backfill on startup to avoid OOM on large instances (#410)
- **Trivy Findings** — Cleared newly flagged HIGH/CRITICAL vulnerabilities in the backend Docker image (#437); overrode `deepmerge-ts` to ^8.0.0 for CVE-2026-40345 (published 0.4.0 images include this)
- **E2E Compose Isolation** — E2E stack now runs under a dedicated Docker Compose project name, preventing collisions with dev containers (#414)
- **Electron CI Publish** — Restored `--publish never` for Linux electron-builder CI builds (#435)
- **Helm Chart** — Merged duplicate `redis.master` keys in values.yaml (the second `master:` block was silently clobbering the first, so the bundled Redis deployed without persistence). Changed unsafe defaults: `backend.replicaCount` now defaults to `1` (was `2`) and `fileStorage.enabled` now defaults to `true` (was `false`), so a fresh install doesn't silently lose uploaded files. The uploads PVC `accessMode` is now auto-selected (new `fileStorage.accessMode`, default `""`): `ReadWriteOnce` at 1 potential backend replica (works on any storage class, including RWO-only default provisioners), `ReadWriteMany` once the backend can scale beyond 1 — previously the chart always hardcoded `ReadWriteMany`, which left the PVC `Pending` forever on RWO-only clusters at default settings. Added render-time guards that fail `helm template`/`helm install` if (a) the backend's *potential* replica count — `backend.replicaCount`, or HPA `maxReplicas` when autoscaling is enabled (not `minReplicas`, which could otherwise be bypassed by an HPA scaling up later) — is `> 1` while `fileStorage.enabled=false` (set `fileStorage.allowEphemeral=true` to opt out), or (b) `fileStorage.accessMode` is explicitly forced to `ReadWriteOnce` while potential replicas `> 1`. **Behavior change for existing installs upgrading without pinning these values explicitly — PVC `accessModes` are immutable, so releases that already created a `ReadWriteMany` uploads PVC should pin `fileStorage.accessMode: ReadWriteMany` explicitly (see NOTES.txt on upgrade).** (#417)

### Upgrade notes

No breaking API changes in this release. All new environment variables are optional, and the features they gate are off by default — the one exception is thumbnail backfill, which is on by default but deliberately throttled (batched, delayed on startup, and rate-limited) so it doesn't spike memory or CPU on upgrade.

**Database migrations** — three new migrations are included and run automatically via the Helm pre-upgrade migrate Job (or the backend entrypoint's migration step under Docker Compose): `add_password_reset_tokens`, `add_channel_webhooks`, `membership_community_page_index`.

**New optional environment variables** (full reference: https://docs.semaphorechat.app/installation/configuration/):

- *S3 file storage* — `STORAGE_TYPE=S3` opts in; `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` are required when enabled; `S3_ENDPOINT` (custom/self-hosted endpoints, e.g. MinIO) and `S3_FORCE_PATH_STYLE` are optional. Leave `STORAGE_TYPE` unset to keep local filesystem storage.
- *SMTP password reset* — `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. The feature auto-disables unless `SMTP_HOST`, `SMTP_FROM`, and `PUBLIC_APP_URL` are all set. `PUBLIC_APP_URL` is also used to build absolute URLs for incoming-webhook execution endpoints, so set it even if you don't use SMTP.
- *GIF search* — `TENOR_API_KEY`. Without it, the GIF picker is hidden in the UI and the `/gifs` search endpoint returns 503.
- *Background jobs* — `JOB_WORKER_CONCURRENCY` (default `4`, max jobs processed in parallel per queue per process) and `CHANNEL_MESSAGE_MEMBER_THRESHOLD` (default `5000` — public channels in communities above this member count skip `CHANNEL_MESSAGE` notification fan-out entirely, logged as a warning, to protect the database).
- *Thumbnail backfill* — `THUMBNAIL_BACKFILL_ENABLED` (default `true`), `THUMBNAIL_BACKFILL_BATCH_SIZE`, `THUMBNAIL_BACKFILL_STARTUP_DELAY_MS`, `THUMBNAIL_BACKFILL_THROTTLE_MS`.

**Helm-specific notes** (full reference: https://docs.semaphorechat.app/installation/kubernetes/):

- New `fileStorage.s3.*` values (`enabled`, `bucket`, `region`, `endpoint`, `forcePathStyle`, plus secret-backed credentials) configure S3 object storage from the chart, as an alternative to the PVC-backed local storage path.
- New `backend.extraEnv` lets you inject the environment variables above that don't have first-class chart values yet (SMTP, Tenor, job tuning) without forking the chart.
- Carried over from the `#417` fix in this release and worth re-flagging on upgrade: `backend.replicaCount` now defaults to `1` (was `2`), `fileStorage.enabled` now defaults to `true` (was `false`), and the uploads PVC `accessMode` is now auto-selected instead of hardcoded to `ReadWriteMany`. Existing installs with a `ReadWriteMany` uploads PVC should pin `fileStorage.accessMode: ReadWriteMany` explicitly before upgrading, since PVC `accessModes` are immutable.

**Multi-replica note**: WebSocket state is now Redis-backed (message-dispatch pipeline, #422) and notification fan-out runs through BullMQ on the same Redis instance (#429). Redis is now load-bearing for messaging correctness — not just scaling — at more than one backend replica; size and monitor it accordingly.

## [0.1.2] - 2026-03-12

### Added

- **Jump to Message** — Navigate to any message via around endpoint (#328)
- **DM Read Receipts** — Watermark-based read receipt indicators in DMs (#329)

### Fixed

- **Health Endpoint** — Check Redis and DB connectivity (#324)
- **Pinned Messages** — Render attachment previews in pinned messages panel (#325)
- **DM Hover Actions** — Fix DM message hover actions & Prisma config migration (#326)
- **Message Readers** — Only fetch message readers on tooltip hover
- **Push Notifications** — Suppression, service worker click navigation & DM sound suppression (#327)
- **Push Deep Links** — Push notification deep links use HashRouter paths (#319)
- **Mobile Notifications** — Mobile notification click navigates to channel instead of no-op (#317)
- **Replay Cleanup** — Handle ENOENT race in replay segment cleanup crons (#295)
- **Disconnected Devices** — Show disconnected device indicator in audio/video settings (#331)

## [0.0.10] - 2026-03-03

### Added

- **PostgreSQL Migration** — Migrated from MongoDB to PostgreSQL with Prisma ORM (#267)
- **DM Unread Badges** — Unread count badges on sidebar and DM list (#266)
- **Notification Sounds** — Full notification sound palette using Eb major pentatonic scale, wired across the app (#262)
- **Voice Mute Overhaul** — Server mute enforcement and persistent local volume controls (#261)
- **Voice Activity Gate** — Gate audio transmission based on voice activity threshold (#260)
- **FK Constraints** — Added foreign key constraints to all previously unenforced entity references (#268)
- **Helm Migration Job** — Pre-install/pre-upgrade database migration Job for Helm deployments

### Changed

- **Frontend Code Review** — Fixes across 9 audit phases (#273)
- **Backend Code Review** — Security, authorization, and data integrity fixes (#274)
- **README Rewrite** — Rewrote README and updated Docker Compose install guide (#254)

### Fixed

- **Notification Reliability** — 7 bug fixes for notification system reliability (#264, #275)
- **Voice Presence** — Stop Socket.IO disconnects from removing voice presence (#270)
- **Voice Activity Lockout** — Prevent gate lockout by cloning analysis track (#271)
- **Replay Capture** — Resolve race conditions and buffer overflow errors (#259)
- **Replay Audio Codec** — Use AAC audio codec for HLS replay egress (#167)
- **WebSocket Auth** — Prevent reconnection loop (#258)
- **WebSocket Validation** — Add whitelist/transform to WS gateway ValidationPipe (#269)
- **Electron Fixes** — Quit on window close when "Close to Tray" is disabled (#206), open links in default browser, fix signed URL 401s (#257), fix DM read receipt bugs (#265)
- **Reaction Grouping** — Group reactions in HTTP response for add/remove endpoints
- **Scroll Sentinel** — Use explicit '1px' for scroll sentinel height in MUI sx prop
- **Prisma Schema** — Replace @@unique with @@index on Role/UserRoles and ReadReceipt to fix prisma db push crashes
- **VAPID Keys** — Handle empty string VAPID keys in auto-generation conditional

## [0.0.3] - 2025-02-11

### Added

- **Reset Default Roles** — Communities can now reset roles back to defaults (#65)
- **Typed API Pipeline** — Shared WebSocket types package and fully typed API client generation (#53)
- **Screen Share Diagnostics** — Diagnostic logging for audio capture failures in screen sharing (#50)
- **Electron Screen Share** — Graceful audio fallback for improved Electron screen sharing

### Changed

- **TanStack Query Migration** — Migrated frontend from RTK Query to TanStack Query v5 (#59)
- **Backend Code Review** — Comprehensive backend code quality improvements (#44, #51)
- **Frontend Beta Readiness** — Frontend polish and readiness fixes (#45)

### Fixed

- **OpenAPI Response Types** — Added remaining response types, eliminating 93+ unknown type generations (#57, #63)
- **Replay Trim UI** — Fixed trim UI bugs, Wayland screen sharing, and Redux messages migration (#64)
- **PIP Auto-Restore** — Fixed auto-restore of picture-in-picture from maximized state on navigation
- **Video Overlay UX** — Improved video overlay interactions and fixed replay message bug (#47)
- **Production Dockerfile** — Fixed workspace layout, dist output path, and start script for production builds

### DevOps

- **GHCR Push on Main** — Docker images now push to GHCR on every push to main

## [0.0.1] - 2025-01-01

### Added

- **Real-time Messaging**
  - WebSocket-based messaging with instant delivery
  - File attachments with drag-and-drop support
  - Message reactions and emoji support
  - @mentions for users and groups (alias groups)
  - Message editing and deletion

- **Voice & Video**
  - LiveKit-powered voice and video calls
  - Screen sharing with system audio capture
  - Replay buffer for screen recording clips
  - Persistent voice connections across navigation

- **Communities**
  - Community-based server organization
  - Text and voice channels
  - Private channels with membership control
  - Community roles and permissions

- **Direct Messages**
  - Private 1:1 and group messaging
  - File attachments in DMs
  - Read receipts and typing indicators

- **User System**
  - User profiles with avatars and banners
  - Online/offline presence tracking
  - Friend system
  - Push-to-talk support

- **Notifications**
  - @mention notifications
  - Do Not Disturb mode
  - Desktop notifications (Electron)
  - Notification settings per channel/DM

- **Admin Dashboard**
  - Instance statistics and monitoring
  - User management (roles, bans)
  - Community management
  - Storage quota management
  - Instance roles configuration

- **Security**
  - JWT-based authentication
  - Role-based access control (RBAC)
  - Private channel membership
  - Instance and community invites

- **Deployment**
  - Docker Compose for development
  - Docker images for production
  - Helm chart for Kubernetes
  - Electron desktop app (Windows, Linux)
  - Auto-update support for Electron

### Technical

- NestJS backend with modular architecture
- React 19 frontend with Material-UI
- Redux Toolkit with RTK Query for state management
- PostgreSQL with Prisma ORM
- Redis for caching and WebSocket scaling
- LiveKit for WebRTC media
