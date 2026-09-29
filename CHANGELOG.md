# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-09-28

### ⚠️ Breaking changes

Check these before upgrading. Each one is covered in full under **Upgrade notes** below. Nobody is signed out by the upgrade itself, and there are no new database migrations and no new, renamed or removed environment variables or Helm values.

- **Redis 6 or newer is required.** Affected: instances with an external Redis 5 or older, where the backend won't start. Upgrade Redis first. The bundled Redis in Docker Compose and the Helm chart is fine.
- **Docker Compose publishes the backend on `127.0.0.1:3000` only.** Affected: a reverse proxy on another host that points at port 3000. Point it at the frontend instead, or run the proxy on the same host.
- **Database SSL now verifies the certificate.** `sslmode=require`, `prefer` and `verify-ca` in `DATABASE_URL` act like `verify-full`. Affected: databases with a self-signed or private-CA certificate, where the backend fails to start. Add `sslrootcert=...`, or use `sslmode=no-verify` to keep the old behaviour.
- **`TRUST_PROXY` must equal the real number of proxy hops.** It now also ties refresh tokens to the client's IP address. Affected: anyone behind a reverse proxy. Check the value (usually `1`), and never use `true`.
- **Custom `backend/Dockerfile.prod` builds.** Copy `backend/prisma.config.ts` into the runtime stage, and drop the Alpine bcrypt rebuild step, which now fails.
- **Database connection pool is now 10 per backend process.** The `connection_limit`, `pool_timeout`, `sslaccept` and `schema` URL parameters are ignored. Affected: instances that tuned the pool through `DATABASE_URL`.

### Added

- **Upload Progress for Attachments** — A message with files now appears in the conversation as soon as you send it, like a text message, with a tile per file showing real upload progress. An upload in progress can be cancelled; a failed one offers Retry and Remove, and removing the last file of a message with no text deletes the message. Uploads keep going if you switch to another conversation. Before, the composer cleared and nothing showed until the upload finished, so a big upload on a slow link looked like a send that had failed. (#541)
- **Video Stage, Float and Dock** — On desktop, the connected voice channel's page shows the video tiles embedded full-size, and every participant gets a tile (camera-off users as avatar, name and speaking ring). In the DM hosting a call, the tiles sit above the chat with a draggable divider. Anywhere else a compact floating card shows the active speaker, or the screen share you're watching; click it to go back to the call, or drag it to a corner to dock it. It remembers where you left it, and "hide video tiles" collapses it to a pill instead of hiding the call. Grid, pin and spotlight choices survive moving between these views. (#443)
- **Mobile Message Search** — Message search now works on phones too. (#447)
- **"Can't reach the server" Screen** — If the server doesn't answer while the app loads, it keeps trying for about 40 seconds and then offers **Try again** and **Sign in again**, instead of a spinner that never ends. (#501)

### Changed

- **Mobile and Tablet Overhaul** — Phone and tablet are no longer a reduced copy of desktop (#447):
  - The phone and tablet channel lists show unread counts, mentions, the lock icon and who is in each voice channel, like desktop.
  - Loading, errors (with Retry) and empty lists are shown as such; a failed load no longer reads "No channels yet".
  - The composer knows your permissions: read-only and timed-out users are told they can't send messages, instead of getting a composer whose messages the server rejects.
  - Consecutive messages from the same author are grouped, with short times and day separators; names stay on one line; notification and DM rows are more compact.
  - The bottom of the screen no longer overlaps: nav, voice bar, composer and toasts stack cleanly and follow the on-screen keyboard. The bottom nav is hidden in a chat.
  - A slimmer touch composer with a "+" sheet, a quoted-reply snippet and an attachment tray. Composer drafts are kept when you switch tabs.
  - Threads open full screen on phones, and Back closes open layers first. A back swipe follows your finger.
  - A compact phone voice bar with a "more" sheet that fits 320 px screens, and a denser tile grid for large calls.
  - Tablets get two columns, sidebar navigation and an overlay member list.
  - The installed app can rotate to landscape (the portrait lock is gone), and the browser's theme colour follows the app theme.
- **Faster First Load** — The voice/video (LiveKit) and replay (hls.js) code now loads only when you join a call or play a clip. The main bundle every visitor downloads drops from about 800 KB to about 325 KB gzipped. (#425)
- **Chat History Loading Indicator** — Loading older or newer messages shows a thin progress bar at the edge of the list instead of placeholder rows that didn't line up with the messages and shifted the list while you scrolled. (#505)
- **Session List** — Each session in Settings is listed under a stable id that doesn't change when its token refreshes. "Last active" can lag by up to a minute. (#501)
- **Prisma 7** — The backend moves from Prisma 6.19 to 7.9.1 (pinned exactly: the `prisma@7.10.0` CLI was published without npm provenance). The database client now connects through node-postgres (`@prisma/adapter-pg`) instead of Prisma's Rust query engine, and the migrate CLI reads the database URL from `backend/prisma.config.ts`.
- **Dependencies** — NestJS 12, Prisma 7.9.1, BullMQ 6, ioredis 6 and node-redis 6, bcrypt 6, nodemailer 10 on the backend; Vite 8, TypeScript 5.9, React 19.3, MUI 7.3.11 and LiveKit client 2.22 on the frontend; `@types/node` 24 to match the Node 24 runtime (unchanged); nginx 1.31 in the frontend image. See the upgrade notes for the ones that affect a running instance.

### Security

- **Signing out ends live connections** — Real-time connections used to be checked only when they connected, so a logout, ban, password reset, revoked session or expired token left the socket open and receiving events. The socket is now tied to its session: logout, revoking a session, a password reset, an instance ban and account deletion end the affected connections at once, across backend replicas, and the old tokens can't reconnect. Revoking a session also revokes its access tokens immediately (before, they stayed valid for up to an hour). Connections renew their token in place before it expires. After a password change, ban or account deletion, the login page says why you were signed out. (#496)
- **Refresh token theft detection** — A refresh token that is presented again after it was rotated now ends the whole session (its access tokens and connections too), not just the token chain. To avoid signing out legitimate users, the same browser re-presenting its token within 30 seconds (tabs refreshing at once, a retry after a lost response) gets the same new token back instead, and only when its IP address and user agent match; anyone else is treated as a thief. Concurrent refreshes no longer fork a session into several live tokens. (#501)
- **Login vs. password reset** — A login that raced a password reset could leave a working session with the old password. It is now refused. (#501)
- **Community and instance bans** — A community ban also removes the user from the community's alias group rooms, and resubscribing can't bring back a community's private channels. An instance ban or account deletion removes the user from the community voice channels they are in, and a banned user's token refresh is refused (an unban restores the session). (#496)
- **Refresh rate limit per token** — `/auth/refresh` is limited per presented token (10/s, 60/min) instead of per IP (4/s, 10/min), so restored tabs or an office behind one NAT address no longer hit it, and an attacker holding an old token only throttles themselves. (#501)
- **Less lock contention in auth** — Logout, login and password reset check or hash passwords and tokens (bcrypt) before taking the per-user lock, so one user's logout no longer stalls their other sessions' refreshes. (#501, #503)
- **Dependency advisories** — Cleared 142 Dependabot alerts with in-range updates and a lockfile refresh (#453), the generated API client's prototype-chain issue (GHSA-hhx9-57xq-r5rw) and build-tool advisories (#455), and 65 Electron and electron-builder alerts (#456). With Electron 44, `extract-zip` (no upstream fix) is gone from the dependency tree. (#542)

### Desktop app

- **Electron 44** — The desktop app moves from Electron 38 to 44 (Chromium 152, Node 24), and electron-builder from 24 to 26. (#456, #542)
- **Screen share refusals no longer error** — When a picked screen or window had gone away, or no sources were available, the refusal threw an unhandled error in the app's main process and a page error in the window. Refusals and a cancelled picker now leave sharing off cleanly. (#542)
- **Desktop layout at every width** — A desktop window narrower than 1200 px switched to the touch tablet layout. The desktop app now always uses the desktop layout; below 1024 px the member list opens from a button in the chat header. (#485)
- **Update notice version** — The "ready to install" notice could read "Version  is ready" if the app reloaded while the update downloaded. It now always shows the version. (#509)
- **Auto-update** — Updating from 0.4.3 works as usual. Windows users still on 0.4.0–0.4.2 and .deb users on 0.4.0–0.4.1 must install once by hand, as described under 0.4.3 and 0.4.2.

### Fixed

- **Blank app on update** — In dark mode with "balanced" or "vibrant" intensity, the app went blank whenever an app update was available. (#447)
- **Signed out on a flaky connection** — A failed token refresh during normal use signed you out even on a network error, a 5xx or a 429. It now retries and signs out only when the server refuses the session. An expired or invalid refresh token got a 500 and left the app on "Connecting…" instead of going to the login page. A POST/PATCH/PUT retried after a token refresh failed because its body had already been used. (#501)
- **Unread state** — A conversation whose messages all fit on screen was never marked read, so its unread badge kept coming back. (#477)
- **Message list** — A reaction on the newest message, or an image or link preview finishing loading near the bottom, pushed the row below the fold (#477). The "is typing…" line covered the newest message (#452).
- **Threads on phones** — A thread could open with the first reply cut off under the original message; it now opens at the top. (#483)
- **DM header** — Opening a DM showed "Unknown" (desktop) or a blank title (phone) until it loaded. It shows the name at once, or a placeholder; call buttons wait for the name. (#479)
- **Light theme** — The notification bell in the app bar was white on white (#475), and chip text such as the voice bar's "Connected" was close to invisible. Chips now meet WCAG AA contrast in every theme, accent and intensity (#525).
- **Mobile navigation** — `/profile/:userId` showed your own profile on phone and tablet, and the Friends page highlighted Home instead of Messages. (#447, #484)
- **Broken links and avatars** — Quote previews in DMs and the Friends "Message" button linked to a 404; `?highlight=` links didn't jump to the message when the channel wasn't loaded yet; avatars were broken in notifications, the incoming-call banner and the admin community list. (#447)
- **Large communities** — A "Maximum update depth exceeded" crash in avatar updates with 55+ members. (#447)
- **Notifications** — A long display name squeezed the type label ("Mentioned you", …) down to one letter. The name is truncated instead. (#451)
- **Community settings** — The community name field no longer grabs focus when you open the settings page. (#504)

### Upgrade notes

No new database migrations, and no new, renamed or removed environment variables or Helm values in this release.

- **Redis 6 or newer is required.** The WebSocket adapter's Redis client (node-redis 6) opens every connection with `HELLO 3` and has no fallback, so against Redis 5 or older the backend can't connect its WebSocket adapter at startup. (BullMQ already recommended 6.2+.) The bundled Redis in Docker Compose and the Helm chart is newer; only external Redis servers are affected. Upgrade Redis before upgrading Semaphore Chat.
- **Docker Compose: backend published on `127.0.0.1` only.** `docker-compose.prod.yml` and the Compose examples in the docs now publish the backend as `127.0.0.1:${BACKEND_PORT:-3000}:3000`, because with `TRUST_PROXY=1` a client that reaches port 3000 directly can spoof its IP with an `X-Forwarded-For` header (and ports published by Docker bypass ufw). If you run your own copy of a Compose file, make the same change. **Affected:** setups where something on another host reaches the backend's port 3000, e.g. a reverse proxy on a different machine. Point that proxy at the frontend (which proxies `/api` and `/socket.io` to the backend over the Compose network), or run the proxy on the same host. The frontend container reaches the backend over the Compose network and is unaffected, and so is the Caddy setup, which publishes no backend port. See [Reverse proxy](https://docs.semaphorechat.app/installation/configuration/#reverse-proxy).
- **`TRUST_PROXY` must match the real number of proxy hops.** It now also decides which client a refresh token belongs to (IP address plus user agent), besides rate limiting and session IPs. Too low (or unset behind a proxy): every client has the proxy's address, so only the user agent tells them apart. Too high, or `true`: clients can spoof their address. `env.sample`, the Compose examples and the Helm chart set `1`; unset means no proxy is trusted (the docs used to say it defaulted to `1`).
- **Sessions: what users will notice.** Existing sessions carry over, and nobody is signed out by the upgrade itself. After it:
  - Logging out signs out every tab of that browser at once.
  - A password reset, ban or account deletion ends the user's open sessions immediately, with a message on the login page.
  - A refresh token re-presented after its 30-second grace window, or by a different IP address or user agent, ends the session. A user whose IP changes during a refresh (a phone switching from Wi-Fi to cellular, a browser mixing IPv4 and IPv6) can be signed out; this was already the case before. The backend logs `Refresh token reuse detected (by another client)` or `(after the grace window)` when it happens.
  - Tabs and desktop apps still running the 0.4.x client keep working; their live connection reconnects when their access token expires, until they reload or update.
- **Custom images:** an image built from a customised `backend/Dockerfile.prod` must also copy `backend/prisma.config.ts` into the runtime stage. Without it, `migrate deploy` (the entrypoint and the Helm migration job) fails with `The datasource.url property is required in your Prisma config file`. Also drop the Alpine stage's bcrypt rebuild (`npx @mapbox/node-pre-gyp install --build-from-source` and its `python3 make g++` build deps): bcrypt 6 ships prebuilt glibc and musl binaries, and the old step now fails with `bcrypt package.json is not node-pre-gyp ready`.
- **Database SSL:** `sslmode=require` (also `prefer` and `verify-ca`) in `DATABASE_URL` now verifies the server certificate, like `verify-full`. Before, it encrypted without checking the certificate. Instances that connect to a database with a self-signed or private-CA certificate must add `sslrootcert=/path/to/ca.pem` (with the CA certificate mounted into the container; the certificate must also match the hostname, or use `uselibpqcompat=true&sslmode=verify-ca&sslrootcert=...`) or, to keep the old unverified behaviour, use `sslmode=no-verify`. Otherwise the backend fails to connect at startup. `prisma migrate deploy` still uses its own driver, so the migration step can succeed while the app fails. Instances without SSL in `DATABASE_URL` (the Docker Compose and bundled Helm PostgreSQL defaults) are unaffected. See [Configuration](https://docs.semaphorechat.app/installation/configuration/).
- **Connection pool:** each backend process now opens at most 10 database connections (node-postgres' default; before it was Prisma's `2 × CPUs + 1`). The backend no longer reads the `connection_limit`, `pool_timeout`, `sslaccept` and `schema` URL parameters.
- **NestJS 12:** no configuration change. WebSocket messages now go through the same global validation, auth and timing as HTTP requests; clients see the same responses as before, and the per-message timing lines are logged at debug level.

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
