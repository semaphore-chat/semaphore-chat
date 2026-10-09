import { http, HttpResponse } from 'msw';
import { defineScreen, type LadleStoryComponent } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';
import { withLongNames } from '../fixtures/modifiers';
import { VoiceConnected } from './VoiceConnected.stories';

/*
 * The desktop shell without the top app bar: the community rail carries
 * Direct Messages and the notification inbox at the top, communities in the
 * middle, and the expand toggle plus your account menu at the foot. Desktop
 * only (phone and tablet have their own app bars), shot at 1280, 1440 and 1920;
 * the Electron stories at 820, Electron's narrow window.
 */

const generalPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;
const unreadCount = (count: number) => [
  http.get('/api/notifications/unread-count', () => HttpResponse.json({ count })),
];
const byLabel = (label: string) => () => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const menuItem = (text: RegExp) => () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => text.test(el.textContent ?? ''));

/** #general with the collapsed rail; 5 unread notifications on the inbox. */
export const Collapsed = defineScreen(bigCommunityScenario, generalPath);
Collapsed.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** The rail expanded into its 160px labelled list. */
export const Expanded = defineScreen(bigCommunityScenario, generalPath, {
  overlay: <ClickOnMount find={byLabel('Expand sidebar')} />,
});
Expanded.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** No unread notifications: the inbox has no badge. */
export const InboxNoUnread = defineScreen(bigCommunityScenario, generalPath, { extraHandlers: unreadCount(0) });
InboxNoUnread.meta = { viewports: ['desktop'] };

/** 150 unread notifications: the badge caps at 99+. */
export const InboxManyUnread = defineScreen(bigCommunityScenario, generalPath, { extraHandlers: unreadCount(150) });
InboxManyUnread.meta = { viewports: ['desktop'] };

/** The account menu open: name and status, Profile, Admin (owner), Settings, theme, Log out…. */
export const AccountMenuOpen = defineScreen(bigCommunityScenario, generalPath, {
  overlay: <ClickOnMount find={byLabel('Account menu')} />,
});
AccountMenuOpen.meta = { viewports: ['desktop-1280', 'desktop'] };

const OpenLogOutConfirm = () => (
  <>
    <ClickOnMount find={byLabel('Account menu')} />
    <ClickOnMount find={menuItem(/log out/i)} />
  </>
);

/** "Log out…" asks first. */
export const LogOutConfirm = defineScreen(bigCommunityScenario, generalPath, { overlay: <OpenLogOutConfirm /> });
LogOutConfirm.meta = { viewports: ['desktop'] };

const longNames = withLongNames(bigCommunityScenario);

/** Long names: the expanded rail truncates community names and yours. */
export const LongNamesExpanded = defineScreen(longNames, generalPath, {
  overlay: <ClickOnMount find={byLabel('Expand sidebar')} />,
});
LongNamesExpanded.meta = { viewports: ['desktop'] };

/** Long names in the account menu header. */
export const LongNamesAccountMenu = defineScreen(longNames, generalPath, {
  overlay: <ClickOnMount find={byLabel('Account menu')} />,
});
LongNamesAccountMenu.meta = { viewports: ['desktop'] };

/** In a call: the rail stops above the voice bar, with the account button still visible. */
export const InCallExpanded: LadleStoryComponent = () => (
  <>
    <VoiceConnected />
    <ClickOnMount find={byLabel('Expand sidebar')} />
  </>
);
InCallExpanded.msw = VoiceConnected.msw;
InCallExpanded.meta = { viewports: ['desktop-1280', 'desktop'] };

/** Electron's narrow (800px-class) window: the same rail, no app bar, native title bar above. */
export const ElectronNarrow = asElectron(defineScreen(bigCommunityScenario, generalPath));
ElectronNarrow.meta = { viewports: ['tablet'] };

/** Electron, account menu open. */
export const ElectronNarrowAccountMenu = asElectron(
  defineScreen(bigCommunityScenario, generalPath, { overlay: <ClickOnMount find={byLabel('Account menu')} /> }),
);
ElectronNarrowAccountMenu.meta = { viewports: ['tablet'] };

/** Electron at 1920 with the rail expanded. */
export const ElectronWideExpanded = asElectron(
  defineScreen(bigCommunityScenario, generalPath, { overlay: <ClickOnMount find={byLabel('Expand sidebar')} /> }),
);
ElectronWideExpanded.meta = { viewports: ['desktop-1920'] };
