/**
 * The channel row's left-edge pill: 4x8 for unread, 4x20 for the selected
 * channel, none for a read one; text colour at 80%. Light and dark.
 */
import { edgeScreen } from '../../fixtures/edge/states';
import type { ThemeSettings } from '../../../theme/constants';
import {
  navBase,
  navHandlers,
  withChannels,
  withAllChannelsUnread,
  NAV_COMMUNITY,
} from '../../fixtures/edge/nav';
import type { Scenario } from '../../fixtures/types';

const light: ThemeSettings = { mode: 'light', accentColor: 'teal', intensity: 'minimal' };
const dark: ThemeSettings = { mode: 'dark', accentColor: 'teal', intensity: 'minimal' };

const TEXT = ['general', 'announcements', 'design-review', 'random', 'support', 'releases'];
const base = withAllChannelsUnread(withChannels(navBase(), NAV_COMMUNITY, TEXT, ['Lounge', 'Stage']), NAV_COMMUNITY);
const channels = base.communities.find((c) => c.id === NAV_COMMUNITY)!.channels;
const idOf = (name: string) => channels.find((c) => c.name === name)!.id;

// "random" and "support" are read (no pill), the other text channels unread.
const unreadByContextId = { ...base.unreadByContextId };
delete unreadByContextId[idOf('random')];
delete unreadByContextId[idOf('support')];
const scenario: Scenario = { ...base, unreadByContextId };

const communityPath = `/community/${NAV_COMMUNITY}`;
const selectedPath = `${communityPath}/channel/${idOf('design-review')}`;
const handlers = navHandlers(scenario);

/** Sidebar with unread (short pill), read (none) and the selected channel (tall pill); dark. */
export const UnreadSelectedReadDark = edgeScreen(scenario, selectedPath, { theme: dark, extraHandlers: handlers });

/** Same, light. */
export const UnreadSelectedReadLight = edgeScreen(scenario, selectedPath, { theme: light, extraHandlers: handlers });

/** The channel list with nothing selected: unread pills and read rows; dark. */
export const UnreadNoneSelectedDark = edgeScreen(scenario, communityPath, { theme: dark, extraHandlers: handlers });

/** The channel list with nothing selected; light. */
export const UnreadNoneSelectedLight = edgeScreen(scenario, communityPath, { theme: light, extraHandlers: handlers });
