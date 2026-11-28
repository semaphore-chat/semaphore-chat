/**
 * The reader's signed-in sessions (Settings > Sessions), shared by both shells: the list, signing one out, and
 * signing out every other one. Lifted from the old `SessionsSettings` card, with its cache key.
 *
 * Signing out everywhere else also ends every push subscription on the server, this device's too, so `revokeOthers`
 * re-subscribes this device's existing subscription afterwards (best effort, as before).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authControllerGetSessionsOptions,
  authControllerRevokeAllOtherSessionsMutation,
  authControllerRevokeSessionMutation,
  pushNotificationsControllerSubscribeMutation,
} from '../api-client/@tanstack/react-query.gen';
import type { SessionInfoDto } from '../api-client/types.gen';
import {
  extractSubscriptionData,
  getCurrentPushSubscription,
  hasNotificationPermission,
  isPushSupported,
} from '../utils/pushSubscription';
import { logger } from '../utils/logger';

export type { SessionInfoDto as SessionInfo } from '../api-client/types.gen';

export interface Sessions {
  /** Every session, this device's included (`isCurrent`). Empty while loading. */
  sessions: SessionInfoDto[];
  /** The sessions other than this device's. */
  otherCount: number;
  loading: boolean;
  error: boolean;
  refetch(): void;
  /** Signs one session out. Rejects when the server refuses. */
  revoke(sessionId: string): Promise<void>;
  /** Signs out every session but this one; resolves with the server's message. Rejects when the server refuses. */
  revokeOthers(): Promise<string>;
  revokingOthers: boolean;
}

export function useSessions(): Sessions {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery(authControllerGetSessionsOptions());
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [{ _id: 'authControllerGetSessions' }] }),
    [queryClient],
  );
  const { mutateAsync: revokeSession } = useMutation({ ...authControllerRevokeSessionMutation(), onSuccess: invalidate });
  const { mutateAsync: revokeAll, isPending: revokingOthers } = useMutation({
    ...authControllerRevokeAllOtherSessionsMutation(),
    onSuccess: invalidate,
  });
  const { mutateAsync: subscribePush } = useMutation(pushNotificationsControllerSubscribeMutation());

  const revoke = useCallback(
    async (sessionId: string) => {
      await revokeSession({ path: { sessionId } });
    },
    [revokeSession],
  );

  const revokeOthers = useCallback(async () => {
    const result = await revokeAll({});
    // The server ended every push subscription with them; this device stays.
    try {
      if (isPushSupported() && hasNotificationPermission()) {
        const subscription = await getCurrentPushSubscription();
        if (subscription) await subscribePush({ body: extractSubscriptionData(subscription) });
      }
    } catch (err) {
      logger.warn('Could not keep push on this device:', err);
    }
    return result.message;
  }, [revokeAll, subscribePush]);

  const sessions = data ?? [];
  return {
    sessions,
    otherCount: sessions.filter((session) => !session.isCurrent).length,
    loading: isLoading,
    error: isError,
    refetch: () => void refetch(),
    revoke,
    revokeOthers,
    revokingOthers,
  };
}
