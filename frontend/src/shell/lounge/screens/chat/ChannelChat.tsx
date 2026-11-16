/**
 * The new shell's text channel chat, the read side (PR 10c-1): the header, the shared message list with kit rows,
 * the day and unread separators, read marking, Jump to latest with "N new", the typing line and `?highlight=`
 * deep links, all on the shared chat layer (`data/chat/useConversation`). No composer and no message actions yet
 * (10c-2). Reached only on the hidden chat fixture until the real route is registered.
 */
import { useCallback, useContext, useMemo, useRef, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ChatPane,
  JumpToLatest,
  Skeleton,
  Stack,
  Text,
  TypingLine,
  useToasts,
  useWidthRange,
} from '../../../../kit';
import { useConversation, type Conversation } from '../../../../data/chat/useConversation';
import { useAttachmentOpener } from '../../../../data/chat/useAttachmentOpener';
import type { MentionChannel } from '../../../../data/chat/toSegments';
import { findCachedChannel } from '../../../../hooks/useChannelMentionTarget';
import { useCommunityCustomEmojis } from '../../../../hooks/useCommunityCustomEmojis';
import { useUsers } from '../../../../hooks/useUser';
import { UserProfileContext } from '../../../../contexts/UserProfileContext';
import { getFileUrl } from '../../../../utils/fileHelpers';
import { getHttpStatus } from '../../../../utils/httpError';
import { previousPathname } from '../../../routeMemory';
import { useLoungeLinks } from '../../links';
import { useScreenChrome, type LoungeScreenProps } from '../../screen';
import { ChatHeader } from './ChatHeader';
import { ChatList } from './ChatList';
import { ChatRowContext, type ChatRowShared } from './ChatRow';
import { channelTitle, useRouteChannel } from './channelTitle';

/** A hash href as a router path. */
const pathOf = (href: string) => href.replace(/^#/, '');

/** Where the chat is: skeleton rows, the list, an empty channel, or why it cannot be shown. */
type ChatFace = 'loading' | 'list' | 'empty' | 'gone' | 'noAccess' | 'error';

function faceOf(conversation: Conversation): ChatFace {
  if (conversation.isLoading) return 'loading';
  if (conversation.error) {
    const status = getHttpStatus(conversation.error);
    return status === 404 ? 'gone' : status === 403 ? 'noAccess' : 'error';
  }
  return conversation.orderedMessages.length > 0 ? 'list' : 'empty';
}

function LoadingRows(): JSX.Element {
  return (
    <Stack gap="lg">
      <span role="status">
        <Text variant="small" tone="secondary">
          Loading messages
        </Text>
      </span>
      {Array.from({ length: 6 }, (_, i) => (
        <Stack key={i} direction="row" gap="md">
          <Skeleton shape="circle" size="md" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={i % 2 === 0 ? 2 : 1} />
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

function StateMessage({ title, line, action }: { title: string; line?: string; action?: JSX.Element }): JSX.Element {
  return (
    <Stack gap="sm" align="start">
      <Text variant="title" as="h2">
        {title}
      </Text>
      {line !== undefined && <Text tone="secondary">{line}</Text>}
      {action}
    </Stack>
  );
}

function ChannelChatBody({ communityId, channelId }: { communityId: string; channelId: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const links = useLoungeLinks();
  const chatPath = pathOf(links.channel(communityId, channelId));
  const homePath = pathOf(links.community(communityId));
  const { channel, loaded } = useRouteChannel({ communityId, channelId });
  const conversation = useConversation({ communityId, channelId, chatPath });
  const range = useWidthRange();
  const { rightOpen, setRightOpen } = useScreenChrome();
  const openProfile = useContext(UserProfileContext)?.openProfile;
  const toasts = useToasts();
  const reportOpenError = useCallback((message: string) => void toasts.show({ tone: 'danger', message }), [toasts]);
  const opener = useAttachmentOpener(reportOpenError);
  const { byId: emojiById } = useCommunityCustomEmojis(communityId);

  // A visible channel by id, from every community's cached channel list (as the old renderer's mention lookup);
  // read again when this community's list changes.
  const channelsKey = loaded ? 'loaded' : 'loading';
  const channelById = useCallback(
    (id: string): MentionChannel | undefined => {
      const found = findCachedChannel(queryClient, id);
      return found ? { id: found.id, name: found.name, communityId: found.communityId } : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channelsKey re-reads the cache once the list is in
    [queryClient, channelsKey],
  );
  // The rows' shared context changes only when what it holds does (the reader, the community's emoji or channels):
  // never on an incoming message, a typing change or a scroll. Callbacks go through refs so they are stable.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openProfileRef = useRef(openProfile);
  openProfileRef.current = openProfile;
  const hasProfile = openProfile !== undefined;
  // An in-chat jump (a reply's original) replaces the entry: Back still leaves the chat in one press.
  const showMessage = useCallback(
    (messageId: string) => navigateRef.current(`${chatPath}?highlight=${messageId}`, { replace: true }),
    [chatPath],
  );
  const openPath = useCallback((path: string) => navigateRef.current(path), []);
  const openProfileStable = useCallback((userId: string) => openProfileRef.current?.(userId), []);
  const segments = useMemo(
    () => ({
      emojiById,
      channelById,
      fileUrl: getFileUrl,
      channelHref: (target: MentionChannel) => links.channel(target.communityId, target.id),
    }),
    [emojiById, channelById, links],
  );
  const shared = useMemo<ChatRowShared>(
    () => ({
      me: conversation.me,
      communityId,
      segments,
      showMessage,
      openPath,
      openProfile: hasProfile ? openProfileStable : undefined,
      opener,
    }),
    [conversation.me, communityId, segments, showMessage, openPath, hasProfile, openProfileStable, opener],
  );

  // Back (B6): to the community's home. When the screen before this one was that home, it is a step back in the
  // history (its scroll and the channel row's focus come back); a cold deep link replaces this entry instead.
  // (The app's hash history keeps no index in history.state, so the frame's own record of the Lounge path shown
  // before this one decides; it is cleared whenever the old shell shows in between.)
  const onBack = useCallback(() => {
    if (previousPathname() === homePath) navigate(-1);
    else navigate(homePath, { replace: true });
  }, [homePath, navigate]);

  const typingUsers = useUsers(conversation.typingUserIds);
  const typingNames = conversation.typingUserIds.map((_, i) => {
    const user = typingUsers[i]?.data;
    return user?.displayName || user?.username || 'Someone';
  });

  const face = faceOf(conversation);
  const retry = useCallback(() => {
    // As the old chat: refetch whatever active query failed (the messages query lives in the shared hook).
    void queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
  }, [queryClient]);
  const goHome = useCallback(() => navigate(homePath, { replace: true }), [homePath, navigate]);

  const state =
    face === 'loading' ? (
      <LoadingRows />
    ) : face === 'empty' ? (
      <StateMessage title="No messages yet." line="Start the conversation!" />
    ) : face === 'gone' ? (
      <StateMessage
        title="Channel not found"
        line="It may have been deleted, or the link is wrong."
        action={<Button onClick={goHome}>Go to the community</Button>}
      />
    ) : face === 'noAccess' ? (
      <StateMessage
        title="You don't have access to this channel"
        line="It may be private, or you may have been removed from this community."
        action={<Button onClick={goHome}>Go to the community</Button>}
      />
    ) : face === 'error' ? (
      <StateMessage title="Couldn't load messages" action={<Button onClick={retry}>Try again</Button>} />
    ) : undefined;

  return (
    <ChatRowContext value={shared}>
      <ChatPane
        header={
          <ChatHeader
            title={channel === null ? (loaded ? 'Channel' : null) : channelTitle(channel)}
            isPrivate={channel?.isPrivate === true}
            onBack={onBack}
            // Only for a channel the reader can see: never a member list for one they have no access to.
            onShowMembers={
              channel === null || face === 'noAccess' || face === 'gone' || (range === 'wide' && rightOpen)
                ? undefined
                : () => setRightOpen(true)
            }
            onSearch={() => navigate(`/community/${communityId}/channel/${channelId}/search`)}
          />
        }
        state={state}
        list={face === 'list' ? <ChatList conversation={conversation} /> : undefined}
        typing={<TypingLine names={typingNames} />}
        jump={
          face === 'list' && conversation.jump.shown ? (
            <JumpToLatest onJump={conversation.jump.onJump} newCount={conversation.jump.newCount} />
          ) : undefined
        }
        announcement={conversation.announcement}
      />
    </ChatRowContext>
  );
}

/** The centre of the chat screen: one conversation per channel (a switch starts the next one fresh). */
export function ChannelChat({ params }: LoungeScreenProps): JSX.Element {
  const communityId = params.communityId ?? '';
  const channelId = params.channelId ?? '';
  return <ChannelChatBody key={`${communityId}/${channelId}`} communityId={communityId} channelId={channelId} />;
}
