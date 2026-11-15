/** After a socket reconnect, the bulk presence every member list reads is refetched (missed online/offline events). */
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { handleReconnect } from '../../../socket-hub/handlers/reconnectHandlers';
import { presenceControllerGetBulkPresenceQueryKey } from '../../../api-client/@tanstack/react-query.gen';

describe('handleReconnect and presence', () => {
  it('invalidates bulk presence', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(presenceControllerGetBulkPresenceQueryKey(), { presence: { 'user-1': true } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    handleReconnect(queryClient);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: presenceControllerGetBulkPresenceQueryKey() });
    expect(queryClient.getQueryState(presenceControllerGetBulkPresenceQueryKey())?.isInvalidated).toBe(true);
  });
});
