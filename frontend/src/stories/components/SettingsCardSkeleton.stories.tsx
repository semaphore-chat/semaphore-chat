import SettingsCardSkeleton from '../../components/Settings/SettingsCardSkeleton';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { edgeScreen, withHangingEndpoint } from '../fixtures/edge/states';

/** The notification-settings card while its settings load: toggle + label rows. */
export const Default = defineComponent(bigCommunityScenario, () => (
  <SettingsCardSkeleton label="Loading notification settings" />
));

/** Two rows only. */
export const FewRows = defineComponent(bigCommunityScenario, () => <SettingsCardSkeleton rows={2} />);

/** At 320px wide, the narrowest phone column. */
export const Narrow320 = defineComponent(bigCommunityScenario, () => <SettingsCardSkeleton />, { maxWidth: 320 });
Narrow320.meta = { viewports: ['phone'] };

const hangSettings = [withHangingEndpoint('get', '/api/notifications/settings')];

/** The real Settings page while the notification settings are pending; dark. */
export const InSettingsDark = edgeScreen(bigCommunityScenario, '/settings', {
  theme: { mode: 'dark', accentColor: 'teal', intensity: 'minimal' },
  extraHandlers: hangSettings,
});

/** The real Settings page while the notification settings are pending; light. */
export const InSettingsLight = edgeScreen(bigCommunityScenario, '/settings', {
  theme: { mode: 'light', accentColor: 'teal', intensity: 'minimal' },
  extraHandlers: hangSettings,
});
