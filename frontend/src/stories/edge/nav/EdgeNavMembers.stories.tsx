/**
 * Member list at scale: just me / 5 / 252 (paginated at 100 like prod, with
 * the "Show more" affordance) / odd names, plus a private channel with no
 * channel members. Opened via the app bar's members button on phone/tablet
 * (desktop shows the sidebar by default).
 */
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId } from '../../fixtures/domQueries';
import {
  defineNavScreen,
  navBase,
  withMembers,
  withChannels,
  makeUsers,
  makeOddUsers,
  MANY_MEMBERS,
  NAV_COMMUNITY,
  NAV_FIRST_CHANNEL,
} from '../../fixtures/edge/nav';

const path = `/community/${NAV_COMMUNITY}/channel/${NAV_FIRST_CHANNEL}`;
const openMembers = <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />;
const base = withChannels(navBase(), NAV_COMMUNITY, ['general', 'random', 'help'], ['Lounge']);

/** Only `me` in the community (the minimum: you can't open a community you're not in). */
export const JustMe = defineNavScreen(withMembers(base, NAV_COMMUNITY, []), path, { overlay: openMembers });

/** Me + 5 members. */
export const Five = defineNavScreen(withMembers(base, NAV_COMMUNITY, makeUsers(5, { seed: 'edge-nav-five' })), path, {
  overlay: openMembers,
});

/** Me + 12 odd-named + 240 members = 253; the first page of 100 loads, "Show more" pages the rest. */
export const TwoHundredFifty = defineNavScreen(withMembers(base, NAV_COMMUNITY, [...makeOddUsers(), ...MANY_MEMBERS]), path, {
  overlay: openMembers,
});

/** Only the odd roster: 32-char names, no-space names, RTL, emoji-only, no display name, missing + broken avatars. */
export const OddNames = defineNavScreen(withMembers(base, NAV_COMMUNITY, makeOddUsers()), path, { overlay: openMembers });

/** A private channel whose channel-membership list is empty (0 members) — `/api/channel-membership` returns []. */
const privateScenario = {
  ...base,
  communities: base.communities.map((c) =>
    c.id === NAV_COMMUNITY ? { ...c, channels: c.channels.map((ch) => (ch.id === NAV_FIRST_CHANNEL ? { ...ch, isPrivate: true } : ch)) } : c,
  ),
};
export const PrivateChannelZero = defineNavScreen(privateScenario, path, { overlay: openMembers });
