# Mobile UX Audit — 2026-09-22 (code-read pass, not yet validated by rendering)

Status: SUPERSEDED by the screenshot-backed review (https://claude.ai/artifact/TaQpmm3N4HEKHY5Yvbm1as). Kept for the behaviour-only findings.

## Tier 1 — Feels broken (cheap fixes)
1. Voice bar covers bottom nav during calls — both `position:fixed; bottom:0`, voice bar 72px / zIndex 1300 vs nav 56px / appBar (`Voice/VoiceBottomBar.tsx:248`, `Mobile/Navigation/MobileBottomNavigation.tsx:46`).
2. Floating chrome ignores bottom nav: `ConnectionStatusBanner.tsx:22`, PWA `UpdateToast`/`OfflineBanner`/`PWAInstallPrompt`, DM FAB `MobileMessagesPanel.tsx:139` (no safe-area term). Idea: shared `useBottomChromeOffset()`.
3. Vite scaffold CSS still in `index.css` (body flex/center, `#646cff` links, button overrides, `#242424` root bg). `App.css` is dead.
4. No `overscroll-behavior` / `-webkit-tap-highlight-color` anywhere.
5. Manifest `orientation: "portrait"` (`vite.config.ts:29`) — bad for video/screenshare.
6. `theme-color` hardcoded `#1a1a2e`, never follows light mode / accent.

## Tier 2 — Structural
7. No keyboard awareness (zero `visualViewport` usage); fixed `100dvh` shell; bottom nav stays up while typing. Hide nav in chat/dm-chat; `useKeyboardInset()`.
8. `MobileScreenContainer.tsx:177` keyed `<Slide>` unmounts previous screen → scroll reset, composer draft lost (no draft persistence).
9. Thread/members/pinned drawers are local state, not history — back button leaves chat instead of closing overlay.
10. Swipe gestures are threshold-triggered, not drag-following (`onProgress` unused); 24px edge dead-zone also applies in standalone PWA.
11. Message search has no mobile entry point (`MobileAppBar` supports `showSearch`, `MobileChatPanel` never passes it; `MessageSearch` is an anchored Popover).

## Tier 3 — Visual
12. No consecutive-message grouping; every row repeats avatar/name/full `toLocaleString()` (`Message/MessageComponent.tsx:297-359`).
13. Theme has no `typography`/`shape`; 97 hardcoded `fontSize`; font is Vite default stack.
14. Composer: 4×48px buttons + 32px padding leave <120px to type on 375px. FAB/mention dropdown use hardcoded `bottom:80`/`bottom:60` and overlap a multi-line composer (`MessageContainer.tsx:383-432`, `MentionDropdown`).
15. Sub-44px targets: reaction chips 26px/4px gap; `size="small"` close buttons in `ThreadPanel`, `PinnedMessagesPanel`.
16. Consistency: ~20 admin dialogs bypass `ResponsiveDialog`; 82 spinner vs 15 skeleton files; pinned/thread panels lack top safe-area; `TabletSidebar` ≈ `MobileChannelsPanel` duplication; redundant back button in tablet chat.

## What's good (keep)
URL-driven mobile nav with sane back fallback; long-press action sheet; hover toolbar disabled under `(hover:none)`; virtua list with stick-to-bottom; `ResponsiveDialog`; emoji/GIF pickers → `MobileSheet` on touch; central `utils/breakpoints.ts`.
