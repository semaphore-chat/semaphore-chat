/**
 * Friends page variants: none, 60 friends with odd names/avatars, and a
 * pile of pending requests (15 incoming, 10 outgoing).
 */
import { defineNavScreen, navBase, withFriends, makeOddUsers, DM_POOL } from '../../fixtures/edge/nav';

export const None = defineNavScreen(withFriends(navBase(), []), '/friends');
export const Sixty = defineNavScreen(withFriends(navBase(), [...makeOddUsers(), ...DM_POOL.slice(0, 48)]), '/friends');
export const ManyRequests = defineNavScreen(
  withFriends(navBase(), DM_POOL.slice(0, 3), DM_POOL.slice(3, 18), DM_POOL.slice(18, 28)),
  '/friends',
);
