# Ladle UX Sandbox — Design

Date: 2026-09-22 · Status: approved (user delegated autonomous execution)

## Goal
Render real app screens and individual components with fake data, so UX review is based on pixels rather than code reading. Also produce an automated screenshot sweep at phone / tablet / desktop sizes.

## Decisions
- **Tool:** Ladle (Vite-native, Storybook CSF-compatible).
- **Coverage:** full screens at mobile + tablet + desktop, plus key components.
- **Data strategy:** the real app runs against **MSW in the browser** (`setupWorker`) serving scenario data built from the existing `__tests__/test-utils/factories.ts`. No backend, no LiveKit. Components that need non-HTTP state (voice) get it via their React context providers.

## Architecture
- `frontend/.ladle/config.mjs` and `frontend/.ladle/components.tsx` (global Provider). The Provider wraps each story in: app MUI theme (dark by default; light via a Ladle control), a fresh `QueryClient` per story, `MemoryRouter` (initial path set per story), `SocketContext` with an inert mock socket, and it starts MSW before rendering.
- `frontend/src/stories/`
  - `fixtures/` — a scenario = a typed dataset (me, communities, channels, messages, DMs, notifications, members) plus `makeHandlers(scenario)` → MSW handlers covering every endpoint the screens call. Unhandled requests are logged loudly (`onUnhandledRequest: 'warn'`) so gaps are visible.
  - `screens/*.stories.tsx` — render the real `<Layout/>` subtree at a route. The same story shows Mobile, Tablet or Desktop layout depending on viewport width, which is how the three-layout coverage comes for free.
  - `components/*.stories.tsx` — isolated components with props or data.
- Voice-connected states: wrap with the real VoiceContext provider seeded with a connected state (small test-only seam if the provider doesn't accept initial state).
- "Keyboard open" is approximated by a short viewport (e.g. 390×500). True iOS keyboard overlay behavior cannot be reproduced in Chromium; this is a known limitation.

## Screenshot sweep
- Docker compose services behind a `tools` profile: `ladle` (frontend image, `ladle serve` on port 61000) and `ux-shots` (`mcr.microsoft.com/playwright:v1.60.0-jammy`).
- `frontend/scripts/ux-shots.mjs`: reads Ladle's `meta.json`, visits every story at phone 390×844 (touch + `isMobile`, so `(hover:none)` rules apply), tablet 820×1180 (touch), desktop 1440×900. Waits for network idle, captures full-viewport PNGs to `frontend/.ux-shots/<viewport>/<story>.png` (gitignored), and records console errors per story to `report.json`.

## Out of scope
Fixing any UX issue; visual regression baselines; stories for admin pages beyond one representative.

## Phase 2 — Edge-case fixture matrix (user-requested: "not just happy path")
Built on the composable scenario builder. Each axis gets stories, plus combined "worst-case" stories per screen.
- **Scale:** members 0/1/5/200+; channels 0/1/60 (many categories, collapsed, all unread); communities 1/50/1,000 in the switcher; DMs 100+.
- **Long/odd content:** 64-char display names and usernames, names with no spaces, emoji/RTL names, missing avatars, broken image URLs.
- **Messages:** wall of text, emoji-only, link-only, over-wide code blocks, long unbroken URLs, markdown edge cases, 20 mentions, @everyone, 30 distinct reactions, 99+ reaction count, edited/deleted/pending/failed-to-send, reply to deleted message, replies inside a thread.
- **Attachments:** very tall/wide images, multi-image, video, large files, upload in progress, GIF embeds, link previews.
- **Threads:** 0/1/200 replies; watched vs not.
- **Unread/notifications:** 0/1/99+, mention vs plain unread, jump-to-unread far back.
- **Voice:** 1/4/25 participants, camera, screen share, speaking indicators, muted/deafened, DM call, incoming-call banner.
- **Permissions:** member/admin/owner, read-only channel, private channel, banned/timed out.
- **Network:** loading, slow (skeletons), 500, 403, offline banner, socket reconnecting, empty states.
- **Composer:** reply banner + 5 file previews + 4-line draft together; mention dropdown with 50 matches; slow mode.
- **Theme:** light and dark, a couple of accent colors.
