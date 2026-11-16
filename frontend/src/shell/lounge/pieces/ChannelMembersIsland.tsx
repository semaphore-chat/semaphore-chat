/**
 * The chat screen's right content: the channel's members (design F4). For a public channel the community's, for
 * a private channel only the people in it, so the island never lists people who cannot read the channel. The
 * view is the members island's own.
 */
import { useCallback, useContext, type JSX } from 'react';
import { useQueryLoadState } from '../../../kit';
import { useCommunityChannels } from '../../../data/channels';
import { useChannelMembers } from '../../../data/members';
import { UserProfileContext } from '../../../contexts/UserProfileContext';
import type { LoungeScreenProps } from '../screen';
import { MembersIsland } from './MembersIsland';

function isEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  const pages = (data as { pages?: unknown[] } | undefined)?.pages ?? [];
  return pages.every((page) => (Array.isArray(page) ? page : ((page as { members?: unknown[] })?.members ?? [])).length === 0);
}

export function ChannelMembersIsland({ params }: LoungeScreenProps): JSX.Element {
  const communityId = params.communityId ?? '';
  const channelId = params.channelId ?? '';
  const channels = useCommunityChannels(communityId);
  const found = channels.all?.find((c) => c.id === channelId);
  const members = useChannelMembers(communityId, found ? { id: found.id, isPrivate: found.isPrivate } : null);
  const openProfile = useContext(UserProfileContext)?.openProfile;
  const onOpenProfile = useCallback((id: string) => openProfile?.(id), [openProfile]);
  const state = useQueryLoadState(members.pagesQuery, {
    notifyId: 'lounge-channel-members',
    resetKey: `${communityId}/${channelId}/${found?.isPrivate === true ? 'private' : 'public'}`,
    isEmpty,
  });
  return (
    <MembersIsland
      hosts={members.hosts}
      around={members.around}
      away={members.away}
      aroundCount={members.aroundCount}
      allLoaded={members.allLoaded}
      onLoadMore={members.loadMore}
      loadingMore={members.loadingMore}
      state={state}
      onOpenProfile={openProfile ? onOpenProfile : undefined}
    />
  );
}
