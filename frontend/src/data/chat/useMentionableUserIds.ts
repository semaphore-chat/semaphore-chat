import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { channelMembershipControllerFindAllForChannelOptions } from '../../api-client/@tanstack/react-query.gen';

const NOBODY: ReadonlySet<string> = new Set();

/**
 * Who `@` can suggest in a channel. A public channel (or an unknown one: null)
 * has no filter (`ids: null`). A private channel allows only its members, from
 * the channel membership list; until that list arrives (or if it fails) the
 * set is empty, so nobody outside the channel is ever suggested.
 */
export function useMentionableUserIds(channel: { id: string; isPrivate: boolean } | null): {
  ids: ReadonlySet<string> | null;
  loading: boolean;
} {
  const isPrivate = channel?.isPrivate === true;
  const query = useQuery({
    ...channelMembershipControllerFindAllForChannelOptions({ path: { channelId: channel?.id ?? '' } }),
    enabled: isPrivate,
  });
  const data = isPrivate ? query.data : undefined;
  const ids = useMemo(() => (data ? new Set(data.map((m) => m.userId)) : NOBODY), [data]);

  if (!isPrivate) return { ids: null, loading: false };
  return { ids: query.isError ? NOBODY : ids, loading: query.isPending && !query.isError };
}
