/**
 * Connectivity + app-shell chrome in context on real screens: offline
 * (`OfflineBanner`), socket reconnecting (`ConnectionStatusBanner`, with and
 * without the voice bar it has to clear), "Update available" (`UpdateToast`)
 * and the PWA install snackbar (`PWAInstallPrompt`), plus combined
 * worst cases. See `fixtures/edge/states.ts` for how each is driven.
 */
import { edgeScreen } from '../../fixtures/edge/states';
import { defaultSettings } from '../../../theme/constants';
import { withLongNames, withUnread } from '../../fixtures/modifiers';
import {
  bigCommunityScenario,
  primaryCommunity,
  generalChannel,
  secondChannel,
  primaryVoiceChannel,
  firstDmGroup,
} from '../../fixtures/scenarios';

const s = bigCommunityScenario;
const chatPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;
const dmPath = `/direct-messages/${firstDmGroup.id}`;

// ── Offline ──────────────────────────────────────────────────────────────

/** Connectivity drops while reading #general (cached messages stay on screen). */
export const OfflineChannelChat = edgeScreen(s, chatPath, { offline: true });

export const OfflineDmList = edgeScreen(s, '/direct-messages', { offline: true });

export const OfflineNotifications = edgeScreen(s, '/notifications', { offline: true });

// ── Socket reconnecting ──────────────────────────────────────────────────

export const ReconnectingChannelChat = edgeScreen(s, chatPath, { isSocketConnected: false });

export const ReconnectingDmChat = edgeScreen(s, dmPath, { isSocketConnected: false });

/** Reconnecting while in a voice call — the chip must sit above the voice bar. */
export const ReconnectingWithVoice = edgeScreen(s, chatPath, { isSocketConnected: false, voice: true });

/** Same, while looking at the voice channel itself. */
export const ReconnectingOnVoiceChannel = edgeScreen(
  s,
  `/community/${primaryCommunity.id}/channel/${primaryVoiceChannel.id}`,
  { isSocketConnected: false, voice: true },
);

// ── PWA chrome ───────────────────────────────────────────────────────────
//
// UpdateToast stories pin the product-default theme (dark / teal /
// "minimal"). `UpdateToastCrashBalancedDark` below covers dark + "balanced"
// (the sandbox default): that combination used to put a `linear-gradient(...)`
// in `palette.background.default`, and MUI's `SnackbarContent` calls
// `emphasize(background.default)` → threw "Unsupported linear-gradient color".
// Fixed: `background.default` is always solid now (the gradient lives in
// `background.ground`), and the toasts sit behind silent ErrorBoundaries
// (`components/PWA/AppChrome.tsx`).
const minimalDark = defaultSettings;

/** A new service worker is waiting — "Update available / Reload" toast over the chat composer. */
export const UpdateToastChannelChat = edgeScreen(s, chatPath, { updateAvailable: true, theme: minimalDark });

export const UpdateToastDmList = edgeScreen(s, '/direct-messages', { updateAvailable: true, theme: minimalDark });

/**
 * Regression guard (story id kept for history): the same toast with dark +
 * "balanced" appearance. It used to throw while rendering and, mounted
 * outside every ErrorBoundary, blank the whole UI the moment a new service
 * worker was detected. Must now show the toast over the chat.
 */
export const UpdateToastCrashBalancedDark = edgeScreen(s, chatPath, {
  updateAvailable: true,
  theme: { mode: 'dark', accentColor: 'blue', intensity: 'balanced' },
});

/** Android Chrome fired `beforeinstallprompt` — the install snackbar over the chat composer. */
export const InstallPromptChannelChat = edgeScreen(s, chatPath, { installPrompt: true });

export const InstallPromptDmList = edgeScreen(s, '/direct-messages', { installPrompt: true });

/** Update toast and install prompt at once — both anchor bottom-center. */
export const UpdateAndInstallTogether = edgeScreen(s, chatPath, {
  updateAvailable: true,
  installPrompt: true,
  theme: minimalDark,
});

// ── Worst cases ──────────────────────────────────────────────────────────

const worst = withUnread(withUnread(withLongNames(s), secondChannel.id, 140, 12), firstDmGroup.id, 99, 3);

/**
 * Everything at once on #general, mid-call: long names, heavy unread,
 * voice bar, socket reconnecting, browser offline, install snackbar.
 * (No update toast: `voiceActions` defers it for the whole call.)
 */
export const WorstCaseInCall = edgeScreen(worst, chatPath, {
  voice: true,
  isSocketConnected: false,
  offline: true,
  installPrompt: true,
});

/** Not in a call: long names, reconnecting, offline, update toast and install snackbar all stacked. */
export const WorstCaseNoCall = edgeScreen(worst, chatPath, {
  isSocketConnected: false,
  offline: true,
  updateAvailable: true,
  installPrompt: true,
  theme: minimalDark,
});
