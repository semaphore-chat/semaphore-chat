/**
 * The left island of a community screen (design §3.3, PR 6): the community's header and its menu,
 * the text channels and the voice rooms. The user's own card is the island's footer (the frame puts
 * `UserCardConnected` in ThreeIslands' `leftFooter` at compact and wide). The frame gives it the route's ids (no `useParams` in a piece).
 *
 * Data: `useCommunity`, `useCommunityActions` (the menu), `useCommunityPresence` (the header's
 * "N around", no number while it is unknown), `useCommunityChannels` (only the server's
 * filtered list), `useUnreadSummary`, a `VoiceRoomCardConnected` per room.
 *
 * The header's "N around" opens the frame's members (`useScreenChrome`) while they are not beside the list. A
 * tapped channel row is busy until its screen (the old shell's chat) takes over. The community is remembered for
 * the classic Home tab (`utils/lastCommunity`).
 */
import { startTransition, useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Stack, Text, useQueryLoadState, useWidthRange } from '../../../../kit';
import { useCommunity, useCommunityActions } from '../../../../data/communities';
import { sortCommunityChannels, useCommunityChannels } from '../../../../data/channels';
import type { Channel } from '../../../../types/channel.type';
import { useCommunityPresence, useIdentityCache } from '../../../../data/members';
import { useUnreadSummary } from '../../../../data/unread';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';
import { isPermanentAccessError } from '../../../../utils/httpError';
import { rememberLastCommunity } from '../../../../utils/lastCommunity';
import { rememberActivatedRow } from '../../../routeMemory';
import { useScreenChrome } from '../../screen';
import { useLoungeLinks } from '../../links';
import { CommunityHeader, type CommunityAction, type CommunityHeaderProps } from './CommunityHeader';
import { ChannelSection, type ChannelItem, type ChannelSectionProps } from './ChannelSection';
import { VoiceRoomCardConnected } from './VoiceRoomCard';

export interface CommunityLeftProps {
  communityId: string;
  /** The selected channel, when the route names one. */
  channelId: string | null;
}

export interface CommunityLeftViewProps {
  /** `notMember`: the server says this community is not yours (403/404). */
  access: 'ok' | 'notMember';
  header: CommunityHeaderProps;
  channels: ChannelSectionProps;
  /** The voice room cards, in order; none: no "Voice rooms" section. */
  rooms: readonly ReactNode[];
  onLeave(): void;
}

export function CommunityLeftView({ access, header, channels, rooms, onLeave }: CommunityLeftViewProps): JSX.Element {
  if (access === 'notMember') {
    return (
      <Stack gap="md">
        <Text variant="title" as="h2">
          You're not a member of this community
        </Text>
        <Text tone="secondary" as="p">
          Ask someone in it for an invite.
        </Text>
        <div>
          <Button onClick={onLeave}>Go to your communities</Button>
        </div>
      </Stack>
    );
  }
  return (
    <Stack gap="lg">
      <CommunityHeader {...header} />
      <ChannelSection {...channels} />
      {rooms.length > 0 && (
        <Stack gap="sm">
          <Text variant="section" tone="secondary" as="h2">
            Voice rooms
          </Text>
          {rooms}
        </Stack>
      )}
    </Stack>
  );
}

const sameChannelItem = (a: ChannelItem, b: ChannelItem) =>
  a.name === b.name && a.unread === b.unread && a.mentions === b.mentions && a.isPrivate === b.isPrivate && a.announcement === b.announcement;

/** No text channel in the server's list (voice rooms have their own section). */
const noTextChannels = (data: Channel[]) => sortCommunityChannels(data).text.length === 0;

export function CommunityLeft({ communityId, channelId }: CommunityLeftProps): JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { community, status: communityStatus, error: communityError } = useCommunity(communityId);
  const { canEdit } = useCommunityActions(communityId);
  // The community's own online count: no member pages, no instance-wide presence for a header.
  const aroundCount = useCommunityPresence(communityId).data?.onlineCount ?? null;
  const { text, voice, status, error, query } = useCommunityChannels(communityId);
  const unread = useUnreadSummary();
  const range = useWidthRange();
  const { rightOpen, setRightOpen } = useScreenChrome();
  const onShowMembers = useCallback(() => setRightOpen(true), [setRightOpen]);
  const { blobUrl } = useAuthenticatedImage(community?.avatarFileId ?? null);
  // Loaded channels stay through a failed refetch (a toast says so); the error face only with nothing to show.
  const channelsState = useQueryLoadState(query, { notifyId: 'lounge-channels', resetKey: communityId, isEmpty: noTextChannels });

  const freshItems = useMemo<ChannelItem[]>(
    () =>
      text.map((channel) => {
        const counts = unread.channel(channel.id);
        return {
          id: channel.id,
          name: channel.name,
          unread: counts.unread > 0,
          mentions: counts.mentions,
          isPrivate: channel.isPrivate,
          announcement: channel.preset === 'ANNOUNCEMENT',
        };
      }),
    [text, unread],
  );
  // An unchanged channel keeps its object, so its memoised row skips the render.
  const channelItems = useIdentityCache(freshItems, sameChannelItem);

  const actions = useMemo<CommunityAction[]>(() => (canEdit ? ['settings'] : []), [canEdit]);
  const onAction = useCallback(
    (action: CommunityAction) => {
      if (action === 'settings') startTransition(() => navigate(`/community/${communityId}/edit`));
    },
    [navigate, communityId],
  );
  const links = useLoungeLinks();
  const hrefFor = useCallback((id: string) => links.channel(communityId, id), [links, communityId]);
  // The row whose screen is loading: only on the path it was tapped from. A later hash change that is not
  // that row's (Back before the chat showed, another link) clears it.
  const [pending, setPending] = useState<{ path: string; id: string } | null>(null);
  const busyId = pending !== null && pending.path === pathname ? pending.id : null;
  const onActivate = useCallback(
    (id: string) => {
      rememberActivatedRow(pathname, id);
      setPending({ path: pathname, id });
    },
    [pathname],
  );
  useEffect(() => {
    if (busyId === null) return undefined;
    const href = hrefFor(busyId);
    const onHashChange = () => {
      if (window.location.hash !== href) setPending(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [busyId, hrefFor]);

  // The classic Home tab returns to the community last opened, in either shell. Only one that loaded:
  // a community the user cannot open (not a member, deleted) must not become where Home leads.
  const communityLoaded = communityStatus === 'success';
  useEffect(() => {
    if (communityLoaded) rememberLastCommunity(communityId);
  }, [communityId, communityLoaded]);

  const notMember =
    (communityStatus === 'error' && isPermanentAccessError(communityError)) ||
    (status === 'error' && isPermanentAccessError(error));

  return (
    <CommunityLeftView
      access={notMember ? 'notMember' : 'ok'}
      header={{
        name: community?.name ?? (communityStatus === 'error' ? 'Community' : null),
        src: blobUrl ?? undefined,
        aroundCount,
        actions,
        onAction,
        onShowMembers,
        // At wide the members can be an island beside the list; below it they are always a Sheet over it.
        membersShown: range === 'wide' && rightOpen,
      }}
      channels={{
        channels: channelItems,
        selectedId: channelId,
        hrefFor,
        onActivate,
        state: channelsState,
        hasRooms: voice.length > 0,
        busyId,
      }}
      rooms={voice.map((room) => (
        <VoiceRoomCardConnected key={room.id} room={room} communityId={communityId} />
      ))}
      onLeave={() => startTransition(() => navigate('/'))}
    />
  );
}
