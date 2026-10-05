import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleChannelPermissionsUpdated,
  handleMemberAddedToCommunity,
} from '../../../socket-hub/handlers/communityHandlers';

describe('communityHandlers', () => {
  it('invalidates communityControllerFindAllMine queries', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    handleMemberAddedToCommunity({ communityId: 'c1', userId: 'u1' }, queryClient);

    expect(spy).toHaveBeenCalledWith({
      queryKey: [{ _id: 'communityControllerFindAllMine' }],
    });
  });

  it('refetches the channel list and channel permissions when overwrites change', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    handleChannelPermissionsUpdated({ communityId: 'c1', channelId: 'ch1' }, queryClient);

    const keys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: [{ _id: string }] }).queryKey[0]._id,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'channelsControllerFindAllForCommunity',
        'channelPermissionsControllerGetMyCommunityChannelPermissions',
        'channelPermissionsControllerGetMyChannelPermissions',
        'channelPermissionsControllerListChannelPermissions',
        'channelPermissionsControllerGetOverwrites',
      ]),
    );
  });
});
