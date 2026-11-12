import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';
import { invalidateAliasGroupQueries } from '../../utils/queryInvalidation';

// =============================================================================
// Custom Emoji
// =============================================================================

export const handleCustomEmojiCreated: SocketEventHandler<
  typeof ServerEvents.CUSTOM_EMOJI_CREATED
> = (payload, queryClient: QueryClient) => {
  invalidateEmojiQueries(queryClient, payload.communityId);
};

export const handleCustomEmojiDeleted: SocketEventHandler<
  typeof ServerEvents.CUSTOM_EMOJI_DELETED
> = (payload, queryClient: QueryClient) => {
  invalidateEmojiQueries(queryClient, payload.communityId);
};

/** The emoji picker and the community's emoji admin list share this query. */
function invalidateEmojiQueries(queryClient: QueryClient, communityId: string) {
  queryClient.invalidateQueries({
    queryKey: [
      { _id: 'customEmojiControllerListCommunityEmojis', path: { communityId } },
    ],
  });
}

// =============================================================================
// Soundboard
// =============================================================================

export const handleSoundboardSoundCreated: SocketEventHandler<
  typeof ServerEvents.SOUNDBOARD_SOUND_CREATED
> = (payload, queryClient: QueryClient) => {
  invalidateSoundboardQueries(queryClient, payload.communityId);
};

export const handleSoundboardSoundDeleted: SocketEventHandler<
  typeof ServerEvents.SOUNDBOARD_SOUND_DELETED
> = (payload, queryClient: QueryClient) => {
  invalidateSoundboardQueries(queryClient, payload.communityId);
};

/** The voice soundboard button and the sound admin list share this query. */
function invalidateSoundboardQueries(
  queryClient: QueryClient,
  communityId: string,
) {
  queryClient.invalidateQueries({
    queryKey: [
      {
        _id: 'soundboardControllerListCommunitySounds',
        path: { communityId },
      },
    ],
  });
}

// =============================================================================
// Alias (Mention) Groups
// =============================================================================

export const handleAliasGroupChanged: SocketEventHandler<
  | typeof ServerEvents.ALIAS_GROUP_CREATED
  | typeof ServerEvents.ALIAS_GROUP_UPDATED
  | typeof ServerEvents.ALIAS_GROUP_DELETED
  | typeof ServerEvents.ALIAS_GROUP_MEMBERS_UPDATED
> = (_payload, queryClient: QueryClient) => {
  invalidateAliasGroupQueries(queryClient);
};

// =============================================================================
// Webhooks
// =============================================================================

export const handleWebhookCreated: SocketEventHandler<
  typeof ServerEvents.WEBHOOK_CREATED
> = (payload, queryClient: QueryClient) => {
  invalidateWebhookQueries(queryClient, payload.channelId);
};

export const handleWebhookDeleted: SocketEventHandler<
  typeof ServerEvents.WEBHOOK_DELETED
> = (payload, queryClient: QueryClient) => {
  invalidateWebhookQueries(queryClient, payload.channelId);
};

function invalidateWebhookQueries(
  queryClient: QueryClient,
  channelId: string,
) {
  queryClient.invalidateQueries({
    queryKey: [
      { _id: 'webhooksControllerFindAllForChannel', path: { channelId } },
    ],
  });
}
