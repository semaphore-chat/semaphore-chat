/**
 * Channel-list fixtures for the sidebar's type icon and access marker:
 * announcement (megaphone, leading), private (lock, trailing), both, and a
 * long name next to them. Built on the nav fixtures (`edge/nav.ts`).
 */
import type { Scenario } from '../types';
import { LONG_CHANNEL_NAME, NAV_COMMUNITY, navBase, withChannels } from './nav';

type Marker = { preset?: 'NORMAL' | 'READ_ONLY' | 'ANNOUNCEMENT'; isPrivate?: boolean };

/** name → preset / privacy, in display order. */
export const CHANNEL_MARKERS: [string, Marker][] = [
  ['general', {}],
  ['announcements', { preset: 'ANNOUNCEMENT' }],
  ['rules', { preset: 'READ_ONLY' }],
  ['staff', { isPrivate: true }],
  ['staff-announcements', { preset: 'ANNOUNCEMENT', isPrivate: true }],
  [LONG_CHANNEL_NAME, { preset: 'ANNOUNCEMENT', isPrivate: true }],
];

/** The nav scenario whose channel list shows every marker combination. */
export function channelMarkersScenario(): Scenario {
  const names = CHANNEL_MARKERS.map(([name]) => name);
  const scenario = withChannels(navBase(), NAV_COMMUNITY, names, ['lounge']);
  const markers = new Map(CHANNEL_MARKERS);
  return {
    ...scenario,
    communities: scenario.communities.map((community) =>
      community.id !== NAV_COMMUNITY
        ? community
        : {
            ...community,
            channels: community.channels.map((channel) => {
              const marker = markers.get(channel.name);
              if (!marker) return channel;
              return {
                ...channel,
                preset: marker.preset ?? channel.preset,
                isPrivate: marker.isPrivate ?? channel.isPrivate,
              };
            }),
          },
    ),
  };
}

export const CHANNEL_MARKERS_PATH = `/community/${NAV_COMMUNITY}`;
