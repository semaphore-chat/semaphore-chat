import { http, HttpResponse } from 'msw';
import { PrivacySettings } from '../../pages/SettingsPage';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** Settings > Privacy with pictures from other sites loading (the default). */
export const On = defineComponent(bigCommunityScenario, () => <PrivacySettings />);

/** The reader turned it off: links show their text only. */
export const Off = defineComponent({ ...bigCommunityScenario, loadRemoteContent: false }, () => <PrivacySettings />);

/** Off, at 320px wide (the description wraps under the label). */
export const OffNarrow320 = defineComponent(
  { ...bigCommunityScenario, loadRemoteContent: false },
  () => <PrivacySettings />,
  { maxWidth: 320 },
);
OffNarrow320.meta = { viewports: ['phone'] };

/** The settings could not be loaded. */
export const LoadError = defineComponent(bigCommunityScenario, () => <PrivacySettings />, {
  extraHandlers: [http.get('/api/appearance-settings', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))],
});
