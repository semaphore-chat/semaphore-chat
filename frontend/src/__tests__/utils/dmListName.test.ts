import { describe, it, expect } from 'vitest';
import { getCompactDmName } from '../../utils/dmListName';
import { createDmGroup, createDmGroupMember } from '../test-utils';

const me = createDmGroupMember({
  id: 'm-me',
  userId: 'me',
  user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null },
});

const member = (i: number, displayName: string | null = `P${i}`) =>
  createDmGroupMember({
    id: `m-${i}`,
    userId: `u-${i}`,
    user: { id: `u-${i}`, username: `user${i}`, displayName, avatarUrl: null },
  });

describe('getCompactDmName', () => {
  it('uses the custom group name when set', () => {
    const group = createDmGroup({ isGroup: true, name: 'Team', members: [me, member(1), member(2), member(3), member(4)] });
    expect(getCompactDmName(group, 'me')).toEqual({ label: 'Team', full: 'Team', names: 'Team', extra: 0 });
  });

  it('uses the other person for 1:1 DMs', () => {
    const group = createDmGroup({ isGroup: false, members: [me, member(1, 'Alice')] });
    expect(getCompactDmName(group, 'me').label).toBe('Alice');
  });

  it('lists up to three other members in full', () => {
    const group = createDmGroup({ isGroup: true, members: [me, member(1), member(2), member(3)] });
    expect(getCompactDmName(group, 'me').label).toBe('P1, P2, P3');
  });

  it('collapses four or more to "A, B + N"', () => {
    const group = createDmGroup({ isGroup: true, members: [me, member(1), member(2), member(3), member(4)] });
    expect(getCompactDmName(group, 'me')).toEqual({
      label: 'P1, P2 + 2',
      full: 'P1, P2, P3, P4',
      names: 'P1, P2',
      extra: 2,
    });
  });

  it('falls back to usernames', () => {
    const group = createDmGroup({ isGroup: true, members: [me, member(1, null), member(2, null)] });
    expect(getCompactDmName(group, 'me').label).toBe('user1, user2');
  });

  it('handles an empty group', () => {
    const group = createDmGroup({ isGroup: true, members: [me] });
    expect(getCompactDmName(group, 'me').label).toBe('Group Chat');
  });
});
