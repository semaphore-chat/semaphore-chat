/**
 * Theming: the six most-used screens in light and dark mode (default "teal"
 * accent, "minimal" intensity — `theme/constants.ts` `defaultSettings`),
 * plus non-default accents and intensities. Each story serves its settings from
 * `GET /api/appearance-settings`; the app's own `useThemeSync()` applies
 * them (see `fixtures/edge/states.ts`), independent of Ladle's theme toggle.
 */
import { edgeScreen } from '../../fixtures/edge/states';
import type { ThemeSettings } from '../../../theme/constants';
import {
  bigCommunityScenario,
  primaryCommunity,
  generalChannel,
  firstDmGroup,
} from '../../fixtures/scenarios';

const s = bigCommunityScenario;
const light: ThemeSettings = { mode: 'light', accentColor: 'teal', intensity: 'minimal' };
const dark: ThemeSettings = { mode: 'dark', accentColor: 'teal', intensity: 'minimal' };

const screens = {
  channelChat: `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
  channelList: `/community/${primaryCommunity.id}`,
  dmList: '/direct-messages',
  dmChat: `/direct-messages/${firstDmGroup.id}`,
  notifications: '/notifications',
  settings: '/settings',
};

export const LightChannelChat = edgeScreen(s, screens.channelChat, { theme: light });
export const DarkChannelChat = edgeScreen(s, screens.channelChat, { theme: dark });
export const LightChannelList = edgeScreen(s, screens.channelList, { theme: light });
export const DarkChannelList = edgeScreen(s, screens.channelList, { theme: dark });
export const LightDmList = edgeScreen(s, screens.dmList, { theme: light });
export const DarkDmList = edgeScreen(s, screens.dmList, { theme: dark });
export const LightDmChat = edgeScreen(s, screens.dmChat, { theme: light });
export const DarkDmChat = edgeScreen(s, screens.dmChat, { theme: dark });
export const LightNotifications = edgeScreen(s, screens.notifications, { theme: light });
export const DarkNotifications = edgeScreen(s, screens.notifications, { theme: dark });
export const LightSettings = edgeScreen(s, screens.settings, { theme: light });
export const DarkSettings = edgeScreen(s, screens.settings, { theme: dark });

/** Non-default accents on the busiest screen: "rose" vibrant in dark, "amber" balanced in light. */
export const AccentRoseVibrantDark = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'dark', accentColor: 'rose', intensity: 'vibrant' },
});
export const AccentAmberBalancedLight = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'light', accentColor: 'amber', intensity: 'balanced' },
});
/**
 * App-bar contrast at the extremes: the most tinted light bar ("purple"
 * vibrant, pale lavender) and a dark bar with an accent whose own contrast
 * text is dark ("lime"). The notification bell inherits the bar's colour, so
 * it must stay clearly visible on both.
 */
export const AccentPurpleVibrantLight = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'light', accentColor: 'purple', intensity: 'vibrant' },
});
export const AccentLimeVibrantDark = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'dark', accentColor: 'lime', intensity: 'vibrant' },
});
/** Accent in context of the unread/selected states of the channel list. */
export const AccentRoseVibrantDarkChannelList = edgeScreen(s, screens.channelList, {
  theme: { mode: 'dark', accentColor: 'rose', intensity: 'vibrant' },
});

/**
 * Connected to voice: the persistent voice bar's "Connected" chip (and every
 * other chip) is an accent tint with accent-derived text, which must stay
 * readable (WCAG AA) in light and dark mode for every accent and intensity.
 * Light used to be pale accent text on a pale tint (~1.0-1.8:1).
 */
export const VoiceBarLight = edgeScreen(s, screens.channelChat, { theme: light, voice: true });
export const VoiceBarDark = edgeScreen(s, screens.channelChat, { theme: dark, voice: true });
/** The most tinted light surface: "purple" vibrant (pale lavender bar and chip). */
export const VoiceBarPurpleVibrantLight = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'light', accentColor: 'purple', intensity: 'vibrant' },
  voice: true,
});
/** A bright accent whose own dark shade is too light for text on its tint: "amber" balanced. */
export const VoiceBarAmberBalancedLight = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'light', accentColor: 'amber', intensity: 'balanced' },
  voice: true,
});
/** Dark vibrant, where the chip text is lightened just enough to also pass on the hover tint. */
export const VoiceBarLimeVibrantDark = edgeScreen(s, screens.channelChat, {
  theme: { mode: 'dark', accentColor: 'lime', intensity: 'vibrant' },
  voice: true,
});
