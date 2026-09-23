/**
 * DM list at scale: 120 conversations (1:1 + group DMs, one in 12 with 15
 * members, some unnamed), odd names, unread 0 / 1 / 7 / 150 (99+) with
 * mentions; an all-read variant; and a big group DM opened with its member
 * list.
 */
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId } from '../../fixtures/domQueries';
import { defineNavScreen, navBase, withDmGroups, DM_POOL } from '../../fixtures/edge/nav';

const many = withDmGroups(navBase(), DM_POOL, 120);

/** 120 DMs with mixed unread counts. */
export const HundredTwenty = defineNavScreen(many, '/direct-messages');

/** 120 DMs, nothing unread. */
export const HundredTwentyAllRead = defineNavScreen({ ...many, unreadByContextId: {} }, '/direct-messages');

/** A single DM with 1 unread. */
export const OneUnread = defineNavScreen(withDmGroups(navBase(), DM_POOL.slice(0, 1), 1), '/direct-messages');

/** A 15-member unnamed group DM open, member list opened. */
const bigGroup = many.dmGroups.find((g) => g.members.length >= 10 && !g.name)!;
export const BigGroupOpen = defineNavScreen(many, `/direct-messages/${bigGroup.id}`, {
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />,
});
