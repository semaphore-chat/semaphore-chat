/**
 * Channel list at scale: 0 / 1 / 60 channels (50 text incl. odd + 100-char
 * names, 10 voice, some private), everything unread with mention badges
 * (some 99+), and the collapsed-category state (phone/tablet only — the
 * desktop list has no collapse control).
 */
import { ClickOnMount } from '../../fixtures/interactions';
import {
  defineNavScreen,
  navBase,
  withChannels,
  withAllChannelsUnread,
  SIXTY_TEXT,
  TEN_VOICE,
  NAV_COMMUNITY,
  LONG_CHANNEL_NAME,
} from '../../fixtures/edge/nav';

const communityPath = `/community/${NAV_COMMUNITY}`;
const sixty = withChannels(navBase(), NAV_COMMUNITY, SIXTY_TEXT, TEN_VOICE, { privateEvery: 11 });

/** A community with no channels at all. */
export const Zero = defineNavScreen(withChannels(navBase(), NAV_COMMUNITY, []), communityPath);

/** Exactly one text channel. */
export const One = defineNavScreen(withChannels(navBase(), NAV_COMMUNITY, ['general']), communityPath);

/** 60 channels, all read. */
export const Sixty = defineNavScreen(sixty, communityPath);

/** 60 channels, every text channel unread; every 3rd has mentions, some 250 unread / 120 mentions. */
export const SixtyAllUnread = defineNavScreen(withAllChannelsUnread(sixty, NAV_COMMUNITY), communityPath);

function findCategoryHeader(label: RegExp): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('.MuiListItemButton-root'));
  return buttons.find((b) => label.test(b.textContent ?? '')) ?? null;
}

/** 60 unread channels with the TEXT category collapsed (click on the category header; no-op on desktop). */
export const SixtyTextCollapsed = defineNavScreen(withAllChannelsUnread(sixty, NAV_COMMUNITY), communityPath, {
  overlay: <ClickOnMount find={() => findCategoryHeader(/^TEXT CHANNELS$/)} />,
});

/** Chat open on the 100-char channel name (header + selected row). */
const longId = sixty.communities[0].channels.find((c) => c.name === LONG_CHANNEL_NAME)!.id;
export const LongNameSelected = defineNavScreen(withAllChannelsUnread(sixty, NAV_COMMUNITY), `${communityPath}/channel/${longId}`);
