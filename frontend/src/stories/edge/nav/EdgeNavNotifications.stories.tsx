/**
 * Notifications at 0 / 1 / 150 (130 unread → 99+ badges), mixed types
 * (mention, @everyone, DM, thread reply, channel message) and odd author
 * names/avatars. Paged at 50 like the backend.
 */
import { defineNavScreen, navBase, withNotifications, makeOddUsers, DM_POOL } from '../../fixtures/edge/nav';

const authors = [...makeOddUsers(), ...DM_POOL];

export const None = defineNavScreen(withNotifications(navBase(), 0, 0, authors), '/notifications');
export const One = defineNavScreen(withNotifications(navBase(), 1, 1, authors), '/notifications');
export const HundredFifty = defineNavScreen(withNotifications(navBase(), 150, 130, authors), '/notifications');
