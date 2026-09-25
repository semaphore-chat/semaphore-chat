import { describe, it, expect, beforeEach } from 'vitest';
import { getDmDisplayName, getDmHeaderName, getDmOtherUser, formatLastMessageTime } from '../../utils/dmHelpers';
import { createDmGroup, createDmGroupMember, resetFactoryCounter } from '../test-utils/factories';

beforeEach(() => {
  resetFactoryCounter();
});

describe('getDmDisplayName', () => {
  it('returns "Unknown" for undefined group', () => {
    expect(getDmDisplayName(undefined, 'user-1')).toBe('Unknown');
  });

  it('returns the custom name when the group has one', () => {
    const group = createDmGroup({ name: 'Cool Group' });
    expect(getDmDisplayName(group, 'user-1')).toBe('Cool Group');
  });

  it('returns other user displayName for 1:1 DM', () => {
    const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'myself', displayName: 'Me', avatarUrl: null } });
    const other = createDmGroupMember({ userId: 'other', user: { id: 'other', username: 'other_user', displayName: 'Other Person', avatarUrl: null } });
    const group = createDmGroup({ isGroup: false, members: [me, other] });
    expect(getDmDisplayName(group, 'me')).toBe('Other Person');
  });

  it('falls back to username when other user has no displayName in 1:1 DM', () => {
    const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'myself', displayName: null, avatarUrl: null } });
    const other = createDmGroupMember({ userId: 'other', user: { id: 'other', username: 'fallback_name', displayName: null, avatarUrl: null } });
    const group = createDmGroup({ isGroup: false, members: [me, other] });
    expect(getDmDisplayName(group, 'me')).toBe('fallback_name');
  });

  it('returns comma-separated names for group DM without a name', () => {
    const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'myself', displayName: 'Me', avatarUrl: null } });
    const alice = createDmGroupMember({ userId: 'alice', user: { id: 'alice', username: 'alice', displayName: 'Alice', avatarUrl: null } });
    const bob = createDmGroupMember({ userId: 'bob', user: { id: 'bob', username: 'bob', displayName: 'Bob', avatarUrl: null } });
    const group = createDmGroup({ isGroup: true, members: [me, alice, bob] });
    expect(getDmDisplayName(group, 'me')).toBe('Alice, Bob');
  });

  it('returns "Group Chat" for group DM with no members', () => {
    const group = createDmGroup({ isGroup: true, members: [] });
    expect(getDmDisplayName(group, 'me')).toBe('Group Chat');
  });
});

describe('getDmOtherUser', () => {
  it('returns undefined for undefined group', () => {
    expect(getDmOtherUser(undefined, 'user-1')).toBeUndefined();
  });

  it('returns undefined for a group DM', () => {
    const group = createDmGroup({ isGroup: true, members: [] });
    expect(getDmOtherUser(group, 'me')).toBeUndefined();
  });

  it('returns the other user object for a 1:1 DM', () => {
    const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'myself', displayName: null, avatarUrl: null } });
    const other = createDmGroupMember({ userId: 'other', user: { id: 'other', username: 'other_user', displayName: 'Other', avatarUrl: null } });
    const group = createDmGroup({ isGroup: false, members: [me, other] });
    const result = getDmOtherUser(group, 'me');
    expect(result).toEqual({ id: 'other', username: 'other_user', displayName: 'Other', avatarUrl: null });
  });

  it('returns undefined for a 1:1 DM with only 1 member', () => {
    const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'myself', displayName: null, avatarUrl: null } });
    const group = createDmGroup({ isGroup: false, members: [me] });
    expect(getDmOtherUser(group, 'me')).toBeUndefined();
  });
});

describe('formatLastMessageTime', () => {
  it('returns "Xd ago" for messages from days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatLastMessageTime(threeDaysAgo)).toBe('3d ago');
  });

  it('returns "Xh ago" for messages from hours ago', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatLastMessageTime(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns "Xm ago" for messages from minutes ago', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    expect(formatLastMessageTime(tenMinutesAgo)).toBe('10m ago');
  });

  it('returns "Just now" for very recent messages', () => {
    const justNow = new Date(Date.now() - 5 * 1000);
    expect(formatLastMessageTime(justNow)).toBe('Just now');
  });

  it('accepts an ISO string as input', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatLastMessageTime(twoDaysAgo)).toBe('2d ago');
  });
});

describe('getDmHeaderName', () => {
  const me = createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null } });
  const other = createDmGroupMember({ userId: 'u2', user: { id: 'u2', username: 'u2', displayName: 'Other Person', avatarUrl: null } });

  it('is undefined while the group is loading (never "Unknown")', () => {
    expect(getDmHeaderName(undefined, 'me')).toBeUndefined();
  });

  it('is undefined for an unnamed DM until the current user is known', () => {
    const group = createDmGroup({ isGroup: false, members: [me, other] });
    expect(getDmHeaderName(group, undefined)).toBeUndefined();
  });

  it("shows a group's own name even before the current user is known", () => {
    const group = createDmGroup({ name: 'Cool Group', isGroup: true, members: [me, other] });
    expect(getDmHeaderName(group, undefined)).toBe('Cool Group');
  });

  it('names an unnamed DM after the other member once the current user is known', () => {
    const group = createDmGroup({ isGroup: false, members: [me, other] });
    expect(getDmHeaderName(group, 'me')).toBe('Other Person');
  });
});
