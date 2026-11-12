import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import {
  handleDmGroupCreated,
  handleDmGroupMemberAdded,
  handleDmGroupMemberLeft,
} from '../../../socket-hub/handlers/dmGroupHandlers';

describe('dmGroupHandlers', () => {
  function invalidatedKeys(run: (queryClient: QueryClient) => void) {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    run(queryClient);

    return spy.mock.calls;
  }

  const expected = [
    // the DM list: a row appears, reorders, or loses a member
    [{ queryKey: [{ _id: 'directMessagesControllerFindUserDmGroups' }] }],
    // the group itself: its response carries the member list the UI renders
    [{ queryKey: [{ _id: 'directMessagesControllerFindDmGroup' }] }],
  ];

  it('a new group refetches the DM list and the group', () => {
    const calls = invalidatedKeys((queryClient) =>
      handleDmGroupCreated(
        { groupId: 'dm-1', memberIds: ['user-a', 'user-b'] },
        queryClient,
      ),
    );

    expect(calls).toEqual(expected);
  });

  it('a member added refetches the DM list and the group', () => {
    const calls = invalidatedKeys((queryClient) =>
      handleDmGroupMemberAdded(
        { groupId: 'dm-1', userIds: ['user-c'] },
        queryClient,
      ),
    );

    expect(calls).toEqual(expected);
  });

  it('a member left refetches the DM list and the group', () => {
    const calls = invalidatedKeys((queryClient) =>
      handleDmGroupMemberLeft({ groupId: 'dm-1', userId: 'user-c' }, queryClient),
    );

    expect(calls).toEqual(expected);
  });
});
