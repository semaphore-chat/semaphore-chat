import { describe, it, expect } from 'vitest';
import {
  parseScreenFromPath,
  type ParsedScreen,
} from '../../components/Mobile/Navigation/MobileNavigationContext';

describe('parseScreenFromPath', () => {
  const cases: Array<{
    pathname: string;
    expected: ParsedScreen;
    desc: string;
  }> = [
    {
      desc: 'channel chat',
      pathname: '/community/c1/channel/ch1',
      expected: { screen: 'chat', communityId: 'c1', channelId: 'ch1', dmGroupId: null, userId: null },
    },
    {
      desc: 'channel search',
      pathname: '/community/c1/channel/ch1/search',
      expected: { screen: 'search', communityId: 'c1', channelId: 'ch1', dmGroupId: null, userId: null },
    },
    {
      desc: 'community channels list',
      pathname: '/community/c1',
      expected: { screen: 'channels', communityId: 'c1', channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'community create -> route (not channels with id=create)',
      pathname: '/community/create',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'community edit -> route',
      pathname: '/community/c1/edit',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'dm chat',
      pathname: '/direct-messages/dm1',
      expected: { screen: 'dm-chat', communityId: null, channelId: null, dmGroupId: 'dm1', userId: null },
    },
    {
      desc: 'dm list',
      pathname: '/direct-messages',
      expected: { screen: 'dm-list', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'notifications',
      pathname: '/notifications',
      expected: { screen: 'notifications', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'settings',
      pathname: '/settings',
      expected: { screen: 'settings', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'settings nested',
      pathname: '/settings/appearance',
      expected: { screen: 'settings', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'profile edit -> route (NOT profile)',
      pathname: '/profile/edit',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'profile bare',
      pathname: '/profile',
      expected: { screen: 'profile', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'profile with userId -> user-profile',
      pathname: '/profile/u1',
      expected: { screen: 'user-profile', communityId: null, channelId: null, dmGroupId: null, userId: 'u1' },
    },
    {
      desc: "another user's profile",
      pathname: '/profile/other',
      expected: { screen: 'user-profile', communityId: null, channelId: null, dmGroupId: null, userId: 'other' },
    },
    {
      desc: 'home',
      pathname: '/',
      expected: { screen: 'channels', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'admin dashboard -> route',
      pathname: '/admin',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'admin nested -> route',
      pathname: '/admin/users',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'friends -> route',
      pathname: '/friends',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'debug page -> route',
      pathname: '/debug/notifications',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
    {
      desc: 'unknown path -> route',
      pathname: '/something/unknown',
      expected: { screen: 'route', communityId: null, channelId: null, dmGroupId: null, userId: null },
    },
  ];

  it.each(cases)('maps $desc', ({ pathname, expected }) => {
    expect(parseScreenFromPath(pathname)).toEqual(expected);
  });
});
