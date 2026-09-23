/**
 * Ready-made scenarios for stories. Add more presets here as needed — they're
 * just `buildScenario()` calls, optionally reshaped with `with*` modifiers
 * from `modifiers.ts`.
 */
import { buildScenario } from './builder';
import { withEmpty } from './modifiers';

/** "Me" + ~12 users, 2 communities (8 text + 2 voice channels each), a
 *  40-message #general with a thread/pin/mention/attachment, 6 DMs, a
 *  handful of notifications and friends. The default backdrop for most
 *  screen and component stories. */
export const bigCommunityScenario = buildScenario({
  seed: 'busy-community',
  // Instance owner so the admin screens render their full content.
  meOverrides: { role: 'OWNER' },
});

/** A convenient handle onto the first community's #general channel and its
 *  first voice channel, so screen stories don't have to guess ids. */
export const primaryCommunity = bigCommunityScenario.communities[0];
export const generalChannel = primaryCommunity.channels.find((c) => c.name === 'general')!;
export const secondChannel = primaryCommunity.channels.filter((c) => c.type === 'TEXT')[1] ?? generalChannel;
export const primaryVoiceChannel = primaryCommunity.channels.find((c) => c.type === 'VOICE')!;
export const threadParentMessageId = Object.keys(bigCommunityScenario.threadRepliesByParent)[0];
export const firstDmGroup = bigCommunityScenario.dmGroups[0];

/** Brand-new user: no communities, no DMs, no notifications, no friends. */
export const emptyUserScenario = withEmpty(
  withEmpty(withEmpty(withEmpty(buildScenario({ seed: 'empty-user', notificationCount: 0 }), 'communities'), 'dmGroups'), 'notifications'),
  'friends',
);
