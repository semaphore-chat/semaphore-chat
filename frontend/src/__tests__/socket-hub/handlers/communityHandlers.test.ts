import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleChannelsReordered,
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

    expect(spy).toHaveBeenCalledWith({
      queryKey: [{ _id: 'channelsControllerFindOne', path: { id: 'ch1' } }],
    });

    const keys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: [{ _id: string }] }).queryKey[0]._id,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'channelsControllerFindAllForCommunity',
        // carries the channel's `preset`, which the composer notice reads
        'channelsControllerFindOne',
        'channelPermissionsControllerGetMyCommunityChannelPermissions',
        'channelPermissionsControllerGetMyChannelPermissions',
        'channelPermissionsControllerListChannelPermissions',
        'channelPermissionsControllerGetOverwrites',
      ]),
    );
  });

  it('CHANNELS_REORDERED refetches the user\'s own list instead of replacing it with the payload', () => {
    // The payload carries only channels the whole community sees, so writing
    // it into the cache would drop the user's private channels.
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const setData = vi.spyOn(queryClient, 'setQueryData');

    handleChannelsReordered({ communityId: 'c1', channels: [] }, queryClient);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
    });
    expect(setData).not.toHaveBeenCalled();
  });
});
