import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleAliasGroupChanged,
  handleCustomEmojiCreated,
  handleCustomEmojiDeleted,
  handleSoundboardSoundCreated,
  handleSoundboardSoundDeleted,
  handleWebhookCreated,
  handleWebhookDeleted,
} from '../../../socket-hub/handlers/communityAssetHandlers';

describe('communityAssetHandlers', () => {
  describe.each([
    ['handleCustomEmojiCreated', handleCustomEmojiCreated],
    ['handleCustomEmojiDeleted', handleCustomEmojiDeleted],
  ])('%s', (_name, handler) => {
    it('refetches that community\'s emoji list (picker and admin list)', () => {
      const queryClient = new QueryClient();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handler({ communityId: 'c1', emojiId: 'e1' }, queryClient);

      expect(spy).toHaveBeenCalledWith({
        queryKey: [
          {
            _id: 'customEmojiControllerListCommunityEmojis',
            path: { communityId: 'c1' },
          },
        ],
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe.each([
    ['handleSoundboardSoundCreated', handleSoundboardSoundCreated],
    ['handleSoundboardSoundDeleted', handleSoundboardSoundDeleted],
  ])('%s', (_name, handler) => {
    it('refetches that community\'s soundboard list', () => {
      const queryClient = new QueryClient();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handler({ communityId: 'c1', soundId: 's1' }, queryClient);

      expect(spy).toHaveBeenCalledWith({
        queryKey: [
          {
            _id: 'soundboardControllerListCommunitySounds',
            path: { communityId: 'c1' },
          },
        ],
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('alias group events', () => {
    it('refetches the community list and the single group', () => {
      const queryClient = new QueryClient();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleAliasGroupChanged(
        { communityId: 'c1', groupId: 'g1' },
        queryClient,
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'aliasGroupsControllerGetCommunityAliasGroups' }],
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'aliasGroupsControllerGetAliasGroup' }],
      });
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe.each([
    ['handleWebhookCreated', handleWebhookCreated],
    ['handleWebhookDeleted', handleWebhookDeleted],
  ])('%s', (_name, handler) => {
    it('refetches that channel\'s webhook list', () => {
      const queryClient = new QueryClient();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handler(
        { communityId: 'c1', channelId: 'ch1', webhookId: 'w1' },
        queryClient,
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: [
          { _id: 'webhooksControllerFindAllForChannel', path: { channelId: 'ch1' } },
        ],
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
