import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { handleFriendshipChanged } from '../../../socket-hub/handlers/friendHandlers';

describe('friendHandlers', () => {
  it('invalidates exactly the three queries the Friends UI reads', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    handleFriendshipChanged(
      { friendshipId: 'fr-1', userAId: 'user-a', userBId: 'user-b' },
      queryClient,
    );

    // The list, the pending requests (a request appears on one side's sent
    // and the other's received) and the per-user status the add form shows.
    expect(spy.mock.calls).toEqual([
      [{ queryKey: [{ _id: 'friendsControllerGetFriends' }] }],
      [{ queryKey: [{ _id: 'friendsControllerGetPendingRequests' }] }],
      [{ queryKey: [{ _id: 'friendsControllerGetFriendshipStatus' }] }],
    ]);
  });
});
