import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Settings = defineScreen(bigCommunityScenario, '/settings');

/** The Settings page with "Load pictures and previews from other sites" off (the Privacy section). */
export const SettingsRemoteContentOff = defineScreen({ ...bigCommunityScenario, loadRemoteContent: false }, '/settings');
SettingsRemoteContentOff.meta = { viewports: ['desktop', 'phone'] };
