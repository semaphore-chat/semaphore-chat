/**
 * Community switcher at scale: 1 / 50 / 1000 communities, with the drawer
 * (phone/tablet) or rail (desktop) opened via the menu button. Plus odd
 * community looks: very long name + 500-char description, no avatar,
 * broken avatar.
 */
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId } from '../../fixtures/domQueries';
import {
  defineNavScreen,
  navBase,
  withCommunityCount,
  withOnlyCommunities,
  withCommunityLook,
  withChannels,
  LONG_COMMUNITY_NAME,
  LONG_COMMUNITY_DESCRIPTION,
  NAV_COMMUNITY,
  NAV_FIRST_CHANNEL,
} from '../../fixtures/edge/nav';

const openSwitcher = <ClickOnMount find={() => findButtonByIconTestId('MenuIcon')} />;

/** Member of exactly one community, switcher open. */
export const OneOpen = defineNavScreen(withOnlyCommunities(navBase(), 1), '/', { overlay: openSwitcher });

/** 50 communities (some odd names, ~20% no avatar, ~9% broken avatar), switcher open. */
export const FiftyOpen = defineNavScreen(withCommunityCount(navBase(), 50), '/', { overlay: openSwitcher });

/** 1000 communities, switcher open. */
export const ThousandOpen = defineNavScreen(withCommunityCount(navBase(), 1000), '/', { overlay: openSwitcher });

/** 1000 communities, switcher closed (desktop rail / home screen). */
export const Thousand = defineNavScreen(withCommunityCount(navBase(), 1000), '/');

const oddLook = withChannels(
  withCommunityLook(
    withCommunityLook(navBase(), NAV_COMMUNITY, { name: LONG_COMMUNITY_NAME, description: LONG_COMMUNITY_DESCRIPTION, avatar: 'broken' }),
    'community-2',
    { name: 'Supercalifragilisticexpialidociousandthensome', avatar: 'none' },
  ),
  NAV_COMMUNITY,
  ['general', 'random'],
  ['Lounge'],
);

/** Long-named community with a broken avatar selected (header/sidebar title). */
export const LongNameSelected = defineNavScreen(oddLook, `/community/${NAV_COMMUNITY}/channel/${NAV_FIRST_CHANNEL}`);

/** Long name / no-space name / broken + missing avatars in the open switcher. */
export const OddLooksOpen = defineNavScreen(oddLook, `/community/${NAV_COMMUNITY}`, { overlay: openSwitcher });
