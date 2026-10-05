/**
 * The role editor's permission checkboxes, including the channel-permission
 * actions (attach files, speak, video, screen share, manage channel
 * permissions, manage webhooks).
 */
import RoleEditor from '../../components/Community/RoleEditor';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';
import { roleEditorProps } from '../fixtures/roleEditor';

export const NewRole = defineComponent(bigCommunityScenario, () => (
  <RoleEditor {...roleEditorProps({ communityId: primaryCommunity.id })} />
), { maxWidth: 720 });

export const DefaultMember = defineComponent(bigCommunityScenario, () => (
  <RoleEditor {...roleEditorProps({ communityId: primaryCommunity.id, preset: 'member' })} />
), { maxWidth: 720 });

export const AllPermissions = defineComponent(bigCommunityScenario, () => (
  <RoleEditor {...roleEditorProps({ communityId: primaryCommunity.id, preset: 'all' })} />
), { maxWidth: 720 });

export const LongRoleName = defineComponent(bigCommunityScenario, () => (
  <RoleEditor
    {...roleEditorProps({
      communityId: primaryCommunity.id,
      preset: 'member',
      name: 'Senior Release Coordination and Announcements Team for the Desktop App',
    })}
  />
), { maxWidth: 720 });

export const Phone = defineComponent(bigCommunityScenario, () => (
  <RoleEditor {...roleEditorProps({ communityId: primaryCommunity.id, preset: 'member' })} />
), { maxWidth: false });
Phone.meta = { viewports: ['phone'] };
