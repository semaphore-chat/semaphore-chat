/**
 * Channel settings → Permissions (presets over per-channel overwrites).
 * Data and handlers: `fixtures/channelSettings.ts`.
 */
import { Paper } from '@mui/material';
import ChannelPermissionsTab from '../../components/Community/ChannelPermissionsTab';
import EditChannelDialog from '../../components/Community/EditChannelDialog';
import { defineComponent } from '../fixtures/componentStory';
import { ClickOnMount } from '../fixtures/interactions';
import {
  MANY_ROLES,
  announcementOverwrites,
  channelSettingsFixture,
  customOverwrites,
  findPermissionsTab,
  readOnlyOverwrites,
  settingsChannel,
  type ChannelSettingsFixture,
} from '../fixtures/channelSettings';

function tabStory(options: ChannelSettingsFixture) {
  const { scenario, handlers } = channelSettingsFixture(options);
  return defineComponent(
    scenario,
    () => (
      <Paper sx={{ p: 2 }}>
        <ChannelPermissionsTab channel={settingsChannel} />
      </Paper>
    ),
    { extraHandlers: handlers, maxWidth: 600 },
  );
}

function dialogStory(options: ChannelSettingsFixture, openPermissions: boolean) {
  const { scenario, handlers } = channelSettingsFixture(options);
  return defineComponent(
    scenario,
    () => (
      <>
        {openPermissions && <ClickOnMount find={findPermissionsTab} />}
        <EditChannelDialog open channel={settingsChannel} onClose={() => {}} />
      </>
    ),
    { extraHandlers: handlers, maxWidth: false },
  );
}

/** Nothing stored: Normal, members can attach. */
export const NormalPreset = tabStory({ actor: 'admin' });

/** Normal with "Members can attach files" off. */
export const NormalNoAttachments = tabStory({
  actor: 'admin',
  overwrites: [{ targetType: 'EVERYONE', roleId: null, allow: [], deny: ['ATTACH_FILES'] }],
});

/** Read-only, Community Admin posts (as the owner: every role is pickable). */
export const ReadOnlyPreset = tabStory({ actor: 'owner', preset: 'READ_ONLY', overwrites: readOnlyOverwrites });

/** Announcement as a Moderator: Community Admin ranks above, so it's kept automatically (locked chip). */
export const AnnouncementAsModerator = tabStory({
  actor: 'moderator',
  preset: 'ANNOUNCEMENT',
  overwrites: announcementOverwrites,
});

/** A set no preset produces: the Custom card and a plain-language summary. */
export const CustomOverwrites = tabStory({ actor: 'admin', preset: 'CUSTOM', overwrites: customOverwrites });

/** A manager without "Send messages": Read-only and Announcement are disabled. */
export const PresetsDisabledForActor = tabStory({ actor: 'limited' });

export const Loading = tabStory({ actor: 'admin', loading: true });

export const LoadError = tabStory({ actor: 'admin', error: true });

/** Many roles with long names in the "Roles that can post" chips. */
export const ManyLongRoleNames = tabStory({
  actor: 'owner',
  preset: 'ANNOUNCEMENT',
  overwrites: announcementOverwrites,
  roles: MANY_ROLES,
});

/** The edit dialog opened on its Permissions tab (full-screen sheet on phones). */
export const DialogPermissionsTab = dialogStory(
  { actor: 'moderator', preset: 'ANNOUNCEMENT', overwrites: announcementOverwrites },
  true,
);

/** Phone: the cards stack in one column. */
export const DialogPermissionsPhone = dialogStory(
  { actor: 'admin', preset: 'READ_ONLY', overwrites: readOnlyOverwrites },
  true,
);
DialogPermissionsPhone.meta = { viewports: ['phone'] };

/** Someone who can edit the channel but not manage its permissions: no tabs. */
export const DialogNonManager = dialogStory({ actor: 'admin', canManage: false }, false);
