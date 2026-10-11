import { http, HttpResponse } from 'msw';
import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';

/*
 * The desktop page shells. User pages are centred: notifications an 800px
 * feed, friends a 720px list (plus a side panel from 1200px of shell), a
 * profile up to 1200px, and form pages (settings, profile edit, community
 * settings) a 220px section nav plus a 680px column (a fluid column up to
 * 1280px for tables). Admin pages grow to 1600px, left-aligned next to their
 * drawer. Desktop widths 1280/1440/1920/2560; Electron's narrow window (820)
 * shows the nav collapsed to tabs. Phone and tablet keep their own layouts
 * (the existing Settings, Notifications, Profile ... stories cover them).
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
SettingsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

/** Settings with an unsaved notification change: the sticky save bar (Reset / Save). */
export const SettingsUnsavedChanges = defineScreen(bigCommunityScenario, settings, {
  overlay: <ClickOnMount find={switchLabelled('Do Not Disturb')} />,
});
SettingsUnsavedChanges.meta = { viewports: ['desktop', 'desktop-1920', 'desktop-2560'] };

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
CommunitySettingsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

/** Community settings, Members: a table section in the wide column (up to 1280px; "Joined" from 800px). */
export const CommunitySettingsMembers = defineScreen(bigCommunityScenario, communityEdit, {
  overlay: <ClickOnMount find={navButton('Members')} />,
});
CommunitySettingsMembers.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

/** Community settings in Electron's narrow window: section tabs. */
export const CommunitySettingsElectronNarrow = asElectron(defineScreen(bigCommunityScenario, communityEdit));
CommunitySettingsElectronNarrow.meta = { viewports: ['tablet'] };

/** Profile edit: one centred 680px column. */
export const ProfileEditShell = defineScreen(bigCommunityScenario, '/profile/edit');
ProfileEditShell.meta = { viewports: ['desktop', 'desktop-1920', 'desktop-2560'] };

/** List pages: notifications (a centred 800px feed), friends, a profile, admin. */
export const NotificationsShell = defineScreen(bigCommunityScenario, '/notifications');
NotificationsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

export const FriendsShell = defineScreen(bigCommunityScenario, '/friends');
/** Friends: a centred tabbed card below 1200px of shell; from it the list plus add friend and pending requests. */
FriendsShell.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

export const ProfileShell = defineScreen(bigCommunityScenario, `/profile/${bigCommunityScenario.me.id}`);
ProfileShell.meta = { viewports: ['desktop', 'desktop-1920', 'desktop-2560'] };

// /admin/communities: the sandbox has no fixture for the users table.
export const AdminCommunitiesShell = defineScreen(bigCommunityScenario, '/admin/communities');
AdminCommunitiesShell.meta = { viewports: ['desktop-1280', 'desktop-1920', 'desktop-2560'] };

/** Friends in Electron's narrow window: the centred tabbed card. */
export const FriendsElectronNarrow = asElectron(defineScreen(bigCommunityScenario, '/friends'));
FriendsElectronNarrow.meta = { viewports: ['tablet'] };

/** Friends with the rail expanded at 1440: the shell is still wide enough for the side panel. */
export const FriendsRailExpanded = defineScreen(bigCommunityScenario, '/friends', {
  overlay: <ClickOnMount find={() => document.querySelector<HTMLElement>('[aria-label="Expand sidebar"]')} />,
});
FriendsRailExpanded.meta = { viewports: ['desktop'] };

const clip = (i: number) => ({
  id: `clip-${i}`,
  fileId: `clip-file-${i}`,
  channelId: null,
  durationSeconds: 30 + i * 7,
  isPublic: i % 2 === 0,
  capturedAt: new Date(Date.UTC(2026, 8, 20 - i, 18, 30)).toISOString(),
  downloadUrl: `/api/file/clip-file-${i}`,
  sizeBytes: 4_000_000 + i * 750_000,
  filename: `replay-${i + 1}.mp4`,
});
const sixClips = Array.from({ length: 6 }, (_, i) => clip(i));

/** Your profile with six clips: the banner at ~4:1 and the clip grid by the page's width. */
export const ProfileWithClips = defineScreen(bigCommunityScenario, `/profile/${bigCommunityScenario.me.id}`, {
  extraHandlers: [
    http.get('/api/livekit/clips', () => HttpResponse.json(sixClips)),
    http.get('/api/livekit/clips/user/:userId', () => HttpResponse.json(sixClips)),
  ],
});
ProfileWithClips.meta = { viewports: ['desktop-1280', 'desktop-1920', 'desktop-2560'] };

/** Admin pages grow to 1600px, left-aligned next to the drawer: the dashboard, invites, storage. */
export const AdminDashboardShell = defineScreen(bigCommunityScenario, '/admin');
AdminDashboardShell.meta = { viewports: ['desktop-1280', 'desktop-1920', 'desktop-2560'] };

export const AdminInvitesShell = defineScreen(bigCommunityScenario, '/admin/invites');
AdminInvitesShell.meta = { viewports: ['desktop-1280', 'desktop-1920', 'desktop-2560'] };

export const AdminStorageShell = defineScreen(bigCommunityScenario, '/admin/storage');
AdminStorageShell.meta = { viewports: ['desktop-1920', 'desktop-2560'] };
