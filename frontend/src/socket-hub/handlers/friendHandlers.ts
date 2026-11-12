import type { QueryClient } from '@tanstack/react-query';
import type { FriendshipPayload } from '@semaphore-chat/shared';
import { invalidateFriendQueries } from '../../utils/queryInvalidation';

/**
 * A friendship changed (request sent, accepted, declined, cancelled, or a
 * friend removed). The payload carries ids only, so the friends list, the
 * pending requests and the per-user status are all refetched: those three are
 * what the Friends UI renders, and the server decides which rows to show
 * (a request appears in one side's "sent" and the other's "received").
 *
 * All five events carry the same payload, so one handler is registered for
 * each of them.
 */
export const handleFriendshipChanged = (
  _payload: FriendshipPayload,
  queryClient: QueryClient,
): void => {
  invalidateFriendQueries(queryClient);
};
