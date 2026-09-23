# Mobile UX Overhaul Implementation Plan

> **For agentic workers:** Executed through an ultracode Workflow: waves of parallel implementers with disjoint file ownership. Each task has an adversarial reviewer that checks it against the sandbox screenshots. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding in the screenshot-backed mobile review, from confirmed bugs through the visual system, without regressing desktop or Electron.

**Architecture:** Five waves, matching the review's five passes. Tasks within a wave own disjoint files and run in parallel in the shared working tree. Waves run in order, and each wave ends with a full test, lint, type-check and screenshot gate, followed by one commit per task. The Ladle sandbox (`frontend/src/stories/**`) is the visual oracle. Every task takes before and after screenshots of its stories and adds stories for any new states it introduces.

**Tech Stack:** React 19, MUI, TanStack Query, react-router (HashRouter), Vitest + RTL + MSW, Ladle, Playwright screenshot sweep. Everything runs in Docker.

**Spec:** Review page https://claude.ai/artifact/TaQpmm3N4HEKHY5Yvbm1as. Local references: `docs/mobile-ux-audit-2026-09-22.md` (behaviour-only items) and `docs/superpowers/specs/2026-09-22-ladle-ux-sandbox-design.md`.

**Deliberate deviation from the plan template:** this plan names files, interfaces, acceptance criteria and required tests, but not literal code. Per the user's delegation policy, implementation code is written by subagents, not by the planner. Each implementer must read the files listed before editing.

## Global Constraints

- Never run pnpm/node on the host. Use `docker compose run --rm frontend …` (type-check, lint, test) and `docker compose --profile tools run --rm ux-shots` (screenshots).
- Don't touch `backend/` (it has unrelated uncommitted changes) or `.vscode/`.
- Follow the CLAUDE.md platform rules: use `isElectron()`/`useResponsive()`, no inline platform checks, never override browser APIs.
- Electron and desktop (≥1200px) behaviour must not regress. Every task checks desktop screenshots of its stories.
- Touch targets must be at least `TOUCH_TARGETS.MINIMUM` (44px) on touch layouts.
- Use `getDmDisplayName` (`utils/dmHelpers.ts`) for DM names, `UserAvatar`/`AuthenticatedImage` for any file-id image, `useCanPerformAction`/`useUserPermissions` (`features/roles/useUserPermissions.ts`) for permission checks, and `useReadReceipts` (`hooks/useReadReceipts.ts`) for unread state.
- Every behaviour change gets Vitest tests under `frontend/src/__tests__/…`, using the existing patterns: `renderWithProviders`, MSW, and the factories.
- Every new visual state gets a Ladle story under `frontend/src/stories/`, built with the existing `buildScenario`/`defineScreen` helpers.
- Commits happen only at wave gates, made by the orchestrator, one per task, on `feat/ladle-ux-sandbox`. No pushing.

## Review Focus

1. **Electron / desktop width:** Electron windows narrower than 768px must stay on the desktop layout, and none of the new mobile-only UI (hidden nav, full-screen thread) may leak into desktop. Each task that touches layout adds a test that renders it with `isElectron()` mocked true.
2. **Theme matrix:** every changed component must render without throwing under all 3 intensities × 2 modes, since the gradient `background.default` caused the crash. Task 1 adds a matrix test helper; later tasks reuse it.
3. **Long and RTL content:** 32-character no-space names, emoji names and Arabic names must truncate with an ellipsis and never wrap the author line or overflow. Covered by the edge-nav/edge-chat stories and asserted in Task 14.
4. **Several floating elements at once:** offline, update, install, reconnecting and a voice call at the same time must stack without overlapping. Task 10 adds a test that asserts the computed offsets.
5. **Back behaviour:** hardware/browser back with the thread, members, pinned, search or an action sheet open must close that layer first, then leave the screen. Task 12 adds tests.

---

## Wave 1: Bugs (parallel, disjoint files)

### Task 1: Update-toast crash and theme-safe snackbars
**Files:** `theme/themeConfig.ts` (add a `MuiSnackbarContent` styleOverride that uses a solid colour; keep gradient backgrounds for page grounds only), `App.tsx` (move `PWAInstallPrompt`, `UpdateToast` and `OfflineBanner` inside the app-level `ErrorBoundary`), `components/PWA/UpdateToast.tsx`.
**Produces:** `__tests__/test-utils/themeMatrix.ts` exporting `THEME_MATRIX: Array<{mode, intensity}>` and `renderInEveryTheme(ui)`, for reuse by later tasks.
- [ ] Failing test: render `UpdateToast` (open) under dark + balanced and dark + vibrant. It currently throws.
- [ ] Fix, then add a test that a render error inside a toast is caught by the boundary.
- [ ] Also check `HomePage.tsx:333` and `AdminSettingsPage.tsx:233`, which have the same snackbar pattern.
- [ ] Acceptance: story `edge-states-network--update-toast-crash-balanced-dark` shows the toast, not a blank screen.

### Task 2: Other users' profiles on mobile and tablet
**Files:** `components/Mobile/Navigation/MobileNavigationContext.tsx:103` (add a `user-profile` screen for `/profile/:userId` when the id isn't the current user), `components/Mobile/Screens/MobileScreenContainer.tsx`, `components/Mobile/Tablet/TabletContentArea.tsx`, `components/Mobile/Panels/MobileProfilePanel.tsx` (accept an optional `userId`, fetch that user, hide edit controls for others). Reuse the desktop profile page content if one exists.
- [ ] Tests: `parseScreenFromPath('/profile/other')` returns `user-profile`; the panel renders the other user's name; `/profile/<me>` still shows edit controls.
- [ ] Acceptance: the `edge-nav-profile--*` and `edge-states-errors--not-found404-profile` phone shots show the correct user, or a proper not-found state.

### Task 3: Avatars from file ids
**Files:** `components/Notifications/NotificationList.tsx:114`, `components/Notifications/NotificationCenter.tsx:205`, `components/DirectMessage/IncomingCallBanner.tsx:61` (plus `IncomingCallListener.tsx:100` if the id is passed as a URL), `pages/admin/AdminCommunitiesPage.tsx:137`. Replace the raw `src={id}` with `UserAvatar`, or `AuthenticatedImage` for community avatars.
- [ ] Tests: each component renders `UserAvatar`/`AuthenticatedImage` (not an `<img src="<file-id>">`) when given a file id.
- [ ] Acceptance: avatars render in the `edge-nav-notifications--*` and `edge-voice-calls--incoming-call-banner` stories.

### Task 4: Deep-link highlight survives a cold load
**Files:** `components/Channel/ChannelMessageContainer.tsx:32-67`, `components/DirectMessages/DirectMessageContainer.tsx:47` (check the actual path), `hooks/useJumpToMessage.ts:62`. Keep the highlight id in state until the target message is rendered or the anchored query has settled; only then clear the URL param. Make the id-reset effect keep a highlight that arrived with the same navigation.
- [ ] Tests: when the target isn't in the cached first page, `useJumpToMessage` enters anchored mode and the target gets highlighted; switching channels with `?highlight` highlights in the new channel.
- [ ] Acceptance: `edge-chat-history--cold-deep-link-ignored` now shows the highlighted message. Rename the story to `cold-deep-link`.

### Task 5: Small fixes
**Files:** `components/Message/QuotePreview.tsx:45` (use `/direct-messages/…`, checked against `routes.tsx:57`), `components/Mobile/Panels/MobileChatPanel.tsx:150` (title via `getDmDisplayName`; add a members button for group DMs; nothing else in this file), `components/Channel/Channel.tsx` (desktop lock icon for private channels, plus the desktop channel header — find where it's rendered), `index.css` (remove the Vite scaffold rules for `a`, `body` flex/centering, `button`, `h1` and the `#242424` root background; keep `--full-dvh`; add `overscroll-behavior: none` on html/body and `-webkit-tap-highlight-color: transparent`), delete `App.css` (confirm it's unused), `vite.config.ts` (remove `orientation: "portrait"`), and a new `hooks/useThemeColorMeta.ts` that sets `<meta name="theme-color">` from the active theme (called from the theme provider module, NOT `App.tsx`, which Task 1 owns in this wave).
- [ ] Tests: the QuotePreview navigate target; the MobileChatPanel title for a 1:1 DM shows the other user's name; the desktop Channel row shows the lock for private channels; `useThemeColorMeta` updates the meta tag when the mode changes.
- [ ] Acceptance: the login and desktop screens show no layout change from removing the CSS. Compare the `login--login` and `channel-chat-busy` desktop shots before and after.

**Wave 1 gate:** full test, lint and type-check; a sweep of all stories at phone and desktop; the reviewer compares against `.ux-shots/final`; one commit per task.

## Wave 2: Mobile gets the same features as desktop

### Task 6: One shared channel row with unread, mentions, lock and voice participants
**Files:** create `components/Channel/ChannelRow.tsx` (built from what desktop `Channel.tsx` renders: `useReadReceipts` unread and mention badges, bold unread names, `VoiceChannelUserList` under voice channels, a lock for private channels, touch-size variant through `useResponsive().shouldUseTouchUI`), update `components/Channel/Channel.tsx` to use it, update `components/Channel/ChannelCategoryList.tsx` to use it and to take `isLoading`/`error` and render the list states (loading skeleton, error with retry, empty with "Create channel" for users who can create channels, via `useCanPerformAction`), and change `components/Mobile/Panels/MobileChannelsPanel.tsx` and `components/Mobile/Tablet/TabletSidebar.tsx` to pass the query state through and share one header component.
**Produces:** `ChannelRow` props `{ channel, communityId, selected, variant: 'desktop' | 'touch' }`.
- [ ] Tests: unread and mention badges render from mocked read receipts; voice participants render; lock renders; loading, error and empty branches (including the create CTA only with permission).
- [ ] Acceptance: phone `edge-nav-channels--sixty-all-unread` shows badges; `edge-voice-channel--twenty-five-browsing` phone and tablet show participants; `edge-states-errors--channel-list500` shows an error with retry.

### Task 7: Shared list-state component, used everywhere else
**Files:** create `components/Common/ListState.tsx` (`<ListState isLoading error onRetry isEmpty empty={<EmptyState …/>} skeleton={…}>{children}</ListState>`), and adopt it in `components/DirectMessages/DirectMessageList.tsx:35`, `components/Mobile/Panels/MobileMessagesPanel.tsx:44`, `components/Notifications/NotificationList.tsx:225-243`, `components/Thread/ThreadPanel.tsx:55,201`, and the member list container. Also fix the desktop member-list skeleton that never clears after a 403.
- [ ] Tests: ListState's four branches; each adopting component shows the error with retry on a 500 (MSW), not its empty copy.
- [ ] Acceptance: every `edge-states-errors--*500` story shows an error state; every `edge-states-loading--*` story shows a skeleton, not an empty state.

### Task 8: Composer that knows your permissions
**Files:** `components/Message/MessageInput.tsx` (and its styles file), plus a new `hooks/useComposerAvailability.ts` that returns `{ state: 'ok' | 'no-permission' | 'timed-out' | 'banned', until?: Date, reason?: string }`, using `useCanPerformAction(CREATE_MESSAGE)` and the current user's moderation state. Find the existing timeout and ban endpoint or query in `api-client`; if there's no way to learn your own timeout, use `no-permission` and write down the gap.
- [ ] Tests: each state renders a non-editable notice ("You can't send messages in #x", "Timed out, 12 min left" with a countdown), and the send button is absent. The `ok` state is unchanged.
- [ ] Acceptance: `edge-voice-permissions--read-only-channel` and `timed-out-member` show the notice.

### Task 9: Mobile message search
**Files:** create `components/Mobile/Screens/MobileSearchScreen.tsx` (full screen: search field autofocused, results list reusing `MessageSearch` result rendering, tap jumps via `?highlight`), add a route or screen type in `MobileNavigationContext` (for example `/community/:cid/channel/:chid/search`), and pass `showSearch`/`onSearchClick` in `MobileChatPanel.tsx`. Coordinate with Task 5, which only changes the title line of MobileChatPanel in wave 1.
- [ ] Tests: the search button appears on mobile chat; the screen queries and renders results (MSW); tapping a result navigates with `?highlight`; back returns to chat.
- [ ] Acceptance: new stories `edge-chat-search--results` and `--no-results` at phone size.

**Wave 2 gate:** same as wave 1.

## Wave 3: The bottom of the screen as one system

### Task 10: Bottom-chrome layout manager
**Files:** create `contexts/BottomChromeContext.tsx` (items register `{ id, height, order }`; exposes `useBottomChromeOffset(id)` returning the px offset from the bottom, including `env(safe-area-inset-bottom)` via a CSS var, and `useKeyboardInset()` based on `visualViewport`), and update `components/Mobile/MobileLayout.tsx`, `components/Mobile/Tablet/TabletLayout.tsx`, `components/Mobile/Navigation/MobileBottomNavigation.tsx` (hidden on the `chat`, `dm-chat`, `search` and voice screens, and while the keyboard is open), `components/Voice/VoiceBottomBar.tsx` (in normal flow above the nav on mobile, never `bottom: 0` over it), `components/ConnectionStatusBanner.tsx`, `components/PWA/UpdateToast.tsx`, `components/PWA/PWAInstallPrompt.tsx`, `components/PWA/OfflineBanner.tsx` (a slim strip under the app bar that pushes content down instead of covering it), `components/Mobile/Panels/MobileMessagesPanel.tsx` (FAB offset), `components/Mobile/Screens/MobileScreenContainer.tsx` (padding from the context), and `components/DirectMessage/IncomingCallBanner.tsx` (on mobile, register as top chrome that pushes content down rather than covering the app bar). Toasts queue: only one snackbar shows at a time, update ahead of install.
**Stack order (bottom up):** nav, voice bar, composer (inside the screen), toast/chip.
- [ ] Tests: offsets are computed correctly for each combination of {nav, voice bar, keyboard} (Review Focus #4); the nav is hidden on chat screens; toasts queue.
- [ ] Acceptance: `edge-states-network--worst-case-no-call`, `worst-case-in-call` and `edge-voice-calls--voice-bar-with-composer` show no overlaps; the voice bar isn't clipped at 390px.

### Task 11: Slimmer composer
**Files:** `components/Message/MessageInput.tsx` (on touch layouts: one "+" button opening a `MobileSheet` with Attach, GIF and Emoji; send button only when there's text or files; text field takes the remaining width; desktop unchanged), `components/Message/ReplyComposerBanner.tsx` (show a one-line quoted snippet), the file preview component (horizontal scrolling tray in a framed container, chips truncate with an ellipsis), `components/Message/MessageContainer.tsx:383-432` (position the jump FAB with a `ResizeObserver` on the composer height instead of `bottom: 80`), and `MentionDropdown` (position above the measured composer, at most 40% of the viewport, and show at least 5 rows on phone).
- [ ] Tests: the "+" sheet opens and triggers the attach input; send is hidden when empty and visible with text; the FAB bottom follows the composer height; the reply banner shows the snippet.
- [ ] Acceptance: in `edge-chat-composer--reply-files-draft` and `edge-chat-worst-case--everything-at-once` (phone), the composer area is at most about 40% of the height and the FAB isn't over the composer.

### Task 12: Full-screen thread on phone; back closes layers
**Files:** create `hooks/useOverlayHistory.ts` (`useOverlayHistory(open, onClose)` pushes a history entry when an overlay opens and closes it on `popstate`), use it in the thread, members and pinned drawers (`components/Channel/ChannelMessageContainer.tsx:210-273`, `components/Mobile/Panels/MobileChatPanel.tsx:259-345`), `MessageActionsSheet` and `MobileSheet`. On phone, render `ThreadPanel` as a full-screen slide-in with an app bar and back button, safe-area padding and 44px buttons. Tablet and desktop keep the side drawer. Also fix the pinned panel's safe area and 44px buttons (`components/Moderation/PinnedMessagesPanel.tsx:127-139`).
- [ ] Tests: opening an overlay pushes history; `popstate` closes it without navigating away; phone renders the thread full-screen.
- [ ] Acceptance: `edge-chat-threads--*` phone shots show a full-screen thread with the Reply field and send button not clipped.

### Task 13: Keep screens mounted and save drafts
**Files:** `components/Mobile/Screens/MobileScreenContainer.tsx` (keep the last screen per tab mounted and hidden, not unmounted, and restore scroll), create `hooks/useComposerDraft.ts` (drafts per channel or DM in `sessionStorage` with try/catch, cleared on send), wired into `MessageInput.tsx`. **Runs after Task 11** in the same wave, because both edit MessageInput.
- [ ] Tests: a draft survives unmount and remount of MessageInput for the same channel and is cleared after send; switching tabs and back keeps channel-list scroll (container-level test).

**Wave 3 gate:** same as above.

## Wave 4: Chat density and visual system

### Task 14: Message grouping, timestamps, day separators, truncation
**Files:** `components/Message/MessageComponent.tsx:297-359` (a `grouped` prop hides the avatar and name and shows a time on hover or long-press), the list that maps messages (`MessageContainer.tsx`/`VirtualMessageList.tsx`: compute `grouped` when the same author is within 5 minutes and there's no reply or thread boundary; insert day separators), a new `utils/messageTime.ts` (`formatMessageTime` gives "4:12 PM", "Yesterday 4:12 PM" or a short date), and author names on one line with an ellipsis. Apply the same truncation to video tiles and sidebars. (DM list items belong to Task 15.)
- [ ] Tests: grouping logic (same author within 5 minutes, broken by a time gap, a reply, or a day change); `formatMessageTime` cases; the author line has `noWrap` for 32-character no-space and Arabic names (Review Focus #3).
- [ ] Acceptance: `channel-chat-busy`, `edge-chat-messages--author-runs` and `edge-nav-dms--hundred-twenty` phone shots look like a modern chat app.

### Task 15: Compact notifications and a single DM unread indicator
**Files:** `components/Notifications/NotificationList.tsx` (compact rows with the display name, not the username; a real label per type, including thread replies; actions via swipe or long-press on touch and inline icons on desktop; fix the nested `<p>`), `components/DirectMessages/DmListItem.tsx:76-78` (one unread indicator: count badge, or a dot for exactly 1; aligned timestamp; names on one line with an ellipsis, group names as "A, B + 13"), and the new-DM FAB offset (from Task 10's context).
- [ ] Tests: label per notification type; display name shown; one unread indicator per state; group DM name truncation (Review Focus #3).
- [ ] Acceptance: `edge-nav-notifications--hundred-fifty` fits at least 9 rows on phone.

**Wave 4 gate.**

## Wave 5: Voice, tablet, gestures, type scale

### Task 16: Voice on the phone
**Files:** the voice channel view used on mobile (find it from `MobileScreenContainer` → voice screen, and `components/Voice/*`): on phone, a participant grid (2 columns, or a list above 6 people) with speaking rings and mute/deafen badges; a video tile only for someone with an active camera or screen share. `components/Voice/VoiceBottomBar.tsx` on phone: primary controls (mic, deafen, camera, hang-up), with screen share, soundboard and settings in a "more" `MobileSheet`, fitting 320px without clipping. Remove the empty band below the content.
- [ ] Tests: the grid renders N participants with their states; the bar renders 4 primary controls plus "more" on phone; the "more" sheet has the rest; desktop bar unchanged.
- [ ] Acceptance: `edge-voice-channel--four-mixed-states`, `twenty-five-connected` and `worst-case` phone shots.

### Task 17: Tablet layout
**Files:** `components/Mobile/Tablet/TabletLayout.tsx`, `TabletContentArea.tsx` (no back button when the sidebar is visible, fixing the inconsistency at line 93), `TabletSidebar.tsx`, and the member-list toggle: below 1024px, at most 2 columns and the member list closed by default (opens as an overlay). Tablet uses sidebar navigation only, with no bottom nav, and moves DMs, notifications and profile entry points into the sidebar header.
- [ ] Tests: at 820px the member list is closed by default and opens as an overlay; no back button in tablet chat; no bottom nav on tablet.
- [ ] Acceptance: in the tablet `channel-chat-busy` and `edge-states-theme--light-channel-chat` shots, author names don't wrap and the composer is at least 400px wide.

### Task 18: Swipe gestures that follow the finger
**Files:** `hooks/useSwipeGesture.ts` (subscribe to `onProgress` for a live transform), the back-swipe handler in `MobileChatPanel.tsx:118-136` (drag-following transform; in standalone display mode, `matchMedia('(display-mode: standalone)')`, drop the 24px edge dead zone), and `utils/breakpoints.ts`.
- [ ] Tests: progress callbacks drive the transform value; the edge zone is ignored in standalone mode.

### Task 19: Type scale and radius in the theme (runs alone, last)
**Files:** `theme/themeConfig.ts` (add `typography` with a named scale and `shape.borderRadius`; choose the font deliberately and load it: self-host or use the system stack on purpose, documented), then replace hard-coded numeric `fontSize` values in `sx` across `components/**` with typography variants or theme tokens, starting with the worst offenders (`Voice/components/CompactUserItem.tsx`, `Common/EmptyState.tsx`, `Voice/VideoTile.tsx`).
- [ ] Tests: a theme snapshot of typography tokens; existing tests pass unchanged.
- [ ] Acceptance: a full sweep shows no layout regressions compared with the previous wave's shots (the reviewer compares every phone and desktop story).

**Final gate:** full sweep at all viewports; independent reviewers audit the whole branch against the spec (see workflow); fix loop; full test suite; update the review page with before and after screenshots.
