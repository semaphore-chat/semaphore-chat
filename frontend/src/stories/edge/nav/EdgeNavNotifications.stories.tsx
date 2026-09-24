/**
 * Notifications at 0 / 1 / 150 (130 unread → 99+ badges), mixed types
 * (mention, @everyone, DM, thread reply, channel message) and odd author
 * names/avatars. Paged at 50 like the backend.
 */
import {
  defineNavScreen,
  navBase,
  withNotifications,
  makeOddUsers,
  DM_POOL,
  MAX_DISPLAY_NAME,
  NO_SPACES_NAME,
} from '../../fixtures/edge/nav';

const authors = [...makeOddUsers(), ...DM_POOL];

export const None = defineNavScreen(withNotifications(navBase(), 0, 0, authors), '/notifications');
export const One = defineNavScreen(withNotifications(navBase(), 1, 1, authors), '/notifications');
export const HundredFifty = defineNavScreen(withNotifications(navBase(), 150, 130, authors), '/notifications');

/**
 * Every type label next to a 32-character name, spaced and unbroken. Types
 * cycle every 5 rows and the two authors alternate, so the 10 rows pair each
 * label with both names, once unread (bold, first 5) and once read. The name
 * should truncate; the label ("Replied in a thread" is the longest) should not.
 */
const longNameAuthors = makeOddUsers().filter(
  (u) => u.displayName === MAX_DISPLAY_NAME || u.displayName === NO_SPACES_NAME,
);
export const LongNamesEveryType = defineNavScreen(
  withNotifications(navBase(), 10, 5, longNameAuthors),
  '/notifications',
);
