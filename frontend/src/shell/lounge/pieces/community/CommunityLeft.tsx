/**
 * The left island of a community screen (design §3.3, PR 6): the community's header and its menu,
 * the text channels, the voice rooms, and at compact and wide the user's own card pinned to the
 * island's foot. The frame gives it the route's ids (no `useParams` in a piece).
 *
 * Data: `useCommunity`, `useCommunityActions` (the menu), `useCommunityMembers().aroundCount` (the
 * header's "N around", no number while it is null), `useCommunityChannels` (only the server's
 * filtered list), `useUnreadSummary`, a `VoiceRoomCardConnected` per room and `UserCardConnected`.
 */
import { startTransition, useCallback, useMemo, type JSX, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Text, useKitPalette, useWidthRange } from '../../../../kit';
import { useCommunity, useCommunityActions } from '../../../../data/communities';
import { useCommunityChannels } from '../../../../data/channels';
import { useCommunityMembers } from '../../../../data/members';
import { useUnreadSummary } from '../../../../data/unread';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';
import { isPermanentAccessError } from '../../../../utils/httpError';
import { rememberActivatedRow } from '../../frame/routeMemory';
import { column, pinnedFoot, SECTION_GAP } from '../arrange';
import { loadController } from './lines';
import { CommunityHeader, type CommunityAction, type CommunityHeaderProps } from './CommunityHeader';
import { ChannelSection, type ChannelSectionProps } from './ChannelSection';
import { VoiceRoomCardConnected } from './VoiceRoomCard';
import { UserCardConnected } from './UserCard';

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
  /** The user's card (compact and wide); null leaves it out (a phone). */
  userCard: ReactNode | null;
  onLeave(): void;
}

export function CommunityLeftView({ access, header, channels, rooms, userCard, onLeave }: CommunityLeftViewProps): JSX.Element {
  const palette = useKitPalette();
  if (access === 'notMember') {
    return (
      <div style={column('md')}>
        <Text variant="title" as="h2">
          You're not a member of this community
        </Text>
        <Text tone="secondary" as="p">
          Ask someone in it for an invite.
        </Text>
        <div>
          <Button onClick={onLeave}>Go to your communities</Button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...column(SECTION_GAP), flexGrow: 1 }}>
      <CommunityHeader {...header} />
      <ChannelSection {...channels} />
      {rooms.length > 0 && (
        <div style={column('sm')}>
          <Text variant="section" tone="secondary" as="h2">
            Voice rooms
          </Text>
          {rooms}
        </div>
      )}
      {userCard !== null && (
        // Pinned to the island's foot: below the rooms when they are short, and over the list's end
        // while it scrolls.
        <div style={pinnedFoot(palette.surface)}>{userCard}</div>
      )}
    </div>
  );
}

export function CommunityLeft({ communityId, channelId }: CommunityLeftProps): JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const range = useWidthRange();
  const { community, status: communityStatus, error: communityError } = useCommunity(communityId);
  const { canEdit } = useCommunityActions(communityId);
  const { aroundCount } = useCommunityMembers(communityId);
  const { text, voice, status, error, refetch } = useCommunityChannels(communityId);
  const unread = useUnreadSummary();
  const { blobUrl } = useAuthenticatedImage(community?.avatarFileId ?? null);

  const channelItems = useMemo(
    () =>
      text.map((channel) => {
        const counts = unread.channel(channel.id);
        return {
          id: channel.id,
          name: channel.name,
          unread: counts.unread > 0,
          mentions: counts.mentions,
          isPrivate: channel.isPrivate,
        };
      }),
    [text, unread],
  );

  const actions = useMemo<CommunityAction[]>(() => (canEdit ? ['settings'] : []), [canEdit]);
  const onAction = useCallback(
    (action: CommunityAction) => {
      if (action === 'settings') startTransition(() => navigate(`/community/${communityId}/edit`));
    },
    [navigate, communityId],
  );
  const hrefFor = useCallback((id: string) => `#/community/${communityId}/channel/${id}`, [communityId]);
  const onActivate = useCallback((id: string) => rememberActivatedRow(pathname, id), [pathname]);

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
      }}
      channels={{
        channels: channelItems,
        selectedId: channelId,
        hrefFor,
        onActivate,
        state: loadController(status, text.length === 0, refetch),
      }}
      rooms={voice.map((room) => (
        <VoiceRoomCardConnected key={room.id} room={room} communityId={communityId} />
      ))}
      userCard={range === 'phone' ? null : <UserCardConnected />}
      onLeave={() => startTransition(() => navigate('/'))}
    />
  );
}
