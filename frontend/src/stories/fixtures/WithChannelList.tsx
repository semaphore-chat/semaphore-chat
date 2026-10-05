import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindAllForCommunityOptions } from '../../api-client/@tanstack/react-query.gen';

/**
 * Loads a community's (visible) channel list before rendering, as the
 * sidebar does in the app: #channel mentions resolve their names from it.
 */
export function WithChannelList({
  communityId,
  children,
}: {
  communityId: string;
  children: ReactNode;
}) {
  const { data } = useQuery(
    channelsControllerFindAllForCommunityOptions({ path: { communityId } }),
  );
  return data ? <>{children}</> : null;
}
