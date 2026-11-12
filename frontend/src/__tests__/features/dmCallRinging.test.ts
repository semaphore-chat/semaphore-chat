import { describe, expect, it } from 'vitest';
import {
  callEndStopsMyRinging,
  declineEndsMyCall,
  declineStopsMyRinging,
  joinStopsMyRinging,
  type DeclineAgainstMyCall,
} from '../../features/voice/dmCallRinging';

const ringing = { dmGroupId: 'dm-1' };

describe('declineStopsMyRinging', () => {
  it.each([
    ['my own decline for the ringing DM', ringing, { dmGroupId: 'dm-1', userId: 'me' }, 'me', true],
    ['someone else declining the same DM', ringing, { dmGroupId: 'dm-1', userId: 'other' }, 'me', false],
    ['my decline for another DM', ringing, { dmGroupId: 'dm-2', userId: 'me' }, 'me', false],
    ['nothing ringing', null, { dmGroupId: 'dm-1', userId: 'me' }, 'me', false],
    ['a signed-out client', ringing, { dmGroupId: 'dm-1', userId: 'me' }, null, false],
  ])('%s', (_label, call, declined, myUserId, expected) => {
    expect(declineStopsMyRinging(call, declined, myUserId)).toBe(expected);
  });
});

describe('joinStopsMyRinging', () => {
  it.each([
    ['I joined on another device', ringing, { dmGroupId: 'dm-1', user: { id: 'me' } }, 'me', true],
    ['someone else joined', ringing, { dmGroupId: 'dm-1', user: { id: 'other' } }, 'me', false],
    ['I joined another DM', ringing, { dmGroupId: 'dm-2', user: { id: 'me' } }, 'me', false],
    ['nothing ringing', null, { dmGroupId: 'dm-1', user: { id: 'me' } }, 'me', false],
    ['a signed-out client', ringing, { dmGroupId: 'dm-1', user: { id: 'me' } }, null, false],
  ])('%s', (_label, call, joined, myUserId, expected) => {
    expect(joinStopsMyRinging(call, joined, myUserId)).toBe(expected);
  });
});

describe('callEndStopsMyRinging', () => {
  it.each([
    ['the ringing call ended', ringing, { dmGroupId: 'dm-1' }, true],
    ['another DM call ended', ringing, { dmGroupId: 'dm-2' }, false],
    ['nothing ringing', null, { dmGroupId: 'dm-1' }, false],
  ])('%s', (_label, call, ended, expected) => {
    expect(callEndStopsMyRinging(call, ended)).toBe(expected);
  });
});

describe('declineEndsMyCall', () => {
  const base: DeclineAgainstMyCall = {
    declinedBy: 'other',
    myUserId: 'me',
    isGroupDm: false,
    inThisCall: true,
    otherMembersInCall: 0,
  };

  it.each<[string, Partial<DeclineAgainstMyCall>, boolean]>([
    ['the other person declines my 1:1 call and I am alone in it', {}, true],
    ['a group call keeps going', { isGroupDm: true }, false],
    ['I am not in that call', { inThisCall: false }, false],
    ['someone else is still in the call', { otherMembersInCall: 1 }, false],
    ['I declined on another device', { declinedBy: 'me' }, false],
    ['a signed-out client', { myUserId: null }, false],
  ])('%s', (_label, overrides, expected) => {
    expect(declineEndsMyCall({ ...base, ...overrides })).toBe(expected);
  });
});
