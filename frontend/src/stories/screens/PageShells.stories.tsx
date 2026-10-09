import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';

/*
 * The desktop page shells: list pages (notifications, friends, profile, admin)
 * up to 960px, form pages (settings, profile edit, community settings) with a
 * 220px section nav and a 680px column (960 for tables), all left-aligned.
 * Desktop widths 1280/1440/1920; Electron's narrow window (820) shows the nav
 * collapsed to tabs. Phone and tablet keep their own layouts (the existing
 * Settings, Notifications, Profile ... stories cover them).
 */

const settings = '/settings';
const communityEdit = `/community/${primaryCommunity.id}/edit`;

const navButton = (label: string) => () =>
  Array.from(document.querySelectorAll<HTMLElement>('nav button, [role="tab"]')).find((b) => b.textContent === label);
const switchLabelled = (text: string) => () =>
  Array.from(document.querySelectorAll<HTMLElement>('label')).find((l) => l.textContent?.includes(text))
    ?.querySelector<HTMLElement>('input[type="checkbox"]');

/** Settings: section nav, 680px column. */
export const SettingsShell = defineScreen(bigCommunityScenario, settings);
SettingsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** Settings with an unsaved notification change: the sticky save bar (Reset / Save). */
export const SettingsUnsavedChanges = defineScreen(bigCommunityScenario, settings, {
  overlay: <ClickOnMount find={switchLabelled('Do Not Disturb')} />,
});
SettingsUnsavedChanges.meta = { viewports: ['desktop', 'desktop-1920'] };

/** Settings after picking "Sessions" in the nav: scrolled there, Sessions highlighted. */
export const SettingsSessionsSelected = defineScreen(bigCommunityScenario, settings, {
  overlay: <ClickOnMount find={navButton('Sessions')} />,
});
SettingsSessionsSelected.meta = { viewports: ['desktop'] };

/** Electron settings: adds the Desktop app section. */
export const SettingsElectron = asElectron(defineScreen(bigCommunityScenario, settings));
SettingsElectron.meta = { viewports: ['desktop'] };

/** Electron's narrow window: the nav collapses into a row of tabs above the column. */
export const SettingsElectronNarrow = asElectron(defineScreen(bigCommunityScenario, settings));
SettingsElectronNarrow.meta = { viewports: ['tablet'] };

/** Electron narrow, unsaved changes: the save bar under the collapsed nav. */
export const SettingsElectronNarrowUnsaved = asElectron(
  defineScreen(bigCommunityScenario, settings, { overlay: <ClickOnMount find={switchLabelled('Do Not Disturb')} /> }),
);
SettingsElectronNarrowUnsaved.meta = { viewports: ['tablet'] };

/** Community settings: the settings form (680px column). */
export const CommunitySettingsShell = defineScreen(bigCommunityScenario, communityEdit);
CommunitySettingsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** Community settings, Members: a table section in the wide (960px) column. */
export const CommunitySettingsMembers = defineScreen(bigCommunityScenario, communityEdit, {
  overlay: <ClickOnMount find={navButton('Members')} />,
});
CommunitySettingsMembers.meta = { viewports: ['desktop', 'desktop-1920'] };

/** Community settings in Electron's narrow window: section tabs. */
export const CommunitySettingsElectronNarrow = asElectron(defineScreen(bigCommunityScenario, communityEdit));
CommunitySettingsElectronNarrow.meta = { viewports: ['tablet'] };

/** Profile edit: one 680px column. */
export const ProfileEditShell = defineScreen(bigCommunityScenario, '/profile/edit');
ProfileEditShell.meta = { viewports: ['desktop', 'desktop-1920'] };

/** List pages at 1920: notifications, friends, a profile, an admin table. */
export const NotificationsShell = defineScreen(bigCommunityScenario, '/notifications');
NotificationsShell.meta = { viewports: ['desktop-1280', 'desktop-1920'] };

export const FriendsShell = defineScreen(bigCommunityScenario, '/friends');
FriendsShell.meta = { viewports: ['desktop-1280', 'desktop-1920'] };

export const ProfileShell = defineScreen(bigCommunityScenario, `/profile/${bigCommunityScenario.me.id}`);
ProfileShell.meta = { viewports: ['desktop-1920'] };

// /admin/communities: the sandbox has no fixture for the users table.
export const AdminCommunitiesShell = defineScreen(bigCommunityScenario, '/admin/communities');
AdminCommunitiesShell.meta = { viewports: ['desktop-1920'] };
