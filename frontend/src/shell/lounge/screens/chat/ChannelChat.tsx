/**
 * The new shell's text channel chat: the header, the shared message list with kit rows, the day and unread
 * separators, read marking, Jump to latest with "N new", the typing line and `?highlight=` deep links, all on the
 * shared chat layer (`data/chat/useConversation`) (PR 10c-1); and the write side (PR 10c-2a): the composer
 * (`ChatComposer`), a message's actions (`MessageActionsSheet`), editing in place, and Retry or Delete on a failed
 * send. The real channel route's at phone width (PR 10c-2b, `ChannelChatScreen`), and the hidden chat fixture's.
 *
 * Typing in the composer and opening a message's actions re-render no row: the composer keeps its own state, and
 * what rows share (`ChatRowContext`) holds only stable values.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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
import { createEditingStore } from '../../../../data/chat/editingStore';
import { useReplyAndEdit } from '../../../../data/chat/useReplyAndEdit';
import { VoiceSessionType } from '../../../../contexts/VoiceContext';
import { useHapticFeedback } from '../../../../hooks/useHapticFeedback';
import { removeOptimisticRow, retryOptimisticMessage } from '../../../../hooks/useOptimisticSendMessage';
import { useSendMessage } from '../../../../hooks/useSendMessage';
import type { Message } from '../../../../types/message.type';
import { ChannelType } from '../../../../types/channel.type';
import { useAttachmentOpener } from '../../../../data/chat/useAttachmentOpener';
import type { MentionChannel } from '../../../../data/chat/toSegments';
import { findCachedChannel } from '../../../../hooks/useChannelMentionTarget';
import { useCommunityCustomEmojis } from '../../../../hooks/useCommunityCustomEmojis';
import { useUsers } from '../../../../hooks/useUser';
import { UserProfileContext } from '../../../../contexts/UserProfileContext';
import { getFileUrl } from '../../../../utils/fileHelpers';
import { getHttpStatus } from '../../../../utils/httpError';
import { previousPathname } from '../../../routeMemory';
import { noteVoiceChannels } from '../../../voiceChannelMemory';
import { useLoungeLinks } from '../../links';
import { useScreenChrome, type LoungeScreenProps } from '../../screen';
import { ChatHeader } from './ChatHeader';
import { ChatList } from './ChatList';
import { ChatRowContext, type ChatRowShared } from './ChatRow';
import { ChatComposer } from './ChatComposer';
import { MessageActionsSheet } from './MessageActionsSheet';
import type { OpenActionsVia } from '../../../../kit';
import { channelTitle, useRouteChannel } from './channelTitle';

const NO_MESSAGES: Message[] = [];
const noSend = () => undefined;

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

/**
 * Back (B6): to the community's home. When the screen before this one was that home, it is a step back in the
 * history (its scroll and the channel row's focus come back); a cold deep link replaces this entry instead.
 * (The app's hash history keeps no index in history.state, so the frame's own record of the Lounge path shown
 * before this one decides; it is cleared whenever the old shell shows in between.) `goHome` always replaces.
 */
function useChatBack(communityId: string): { onBack: () => void; goHome: () => void } {
  const navigate = useNavigate();
  const homePath = pathOf(useLoungeLinks().community(communityId));
  const onBack = useCallback(() => {
    if (previousPathname() === homePath) navigate(-1);
    else navigate(homePath, { replace: true });
  }, [homePath, navigate]);
  const goHome = useCallback(() => navigate(homePath, { replace: true }), [homePath, navigate]);
  return { onBack, goHome };
}

function ChannelChatBody({ communityId, channelId }: { communityId: string; channelId: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const links = useLoungeLinks();
  const chatPath = pathOf(links.channel(communityId, channelId));
  const { channel, loaded } = useRouteChannel({ communityId, channelId });
  // Only a channel the list confirms is a text channel may be written to (I1): a channel missing from the list
  // (no access, deleted) reads without a composer, reactions or actions.
  const writable = channel?.type === ChannelType.TEXT;
  const conversation = useConversation({ communityId, channelId, chatPath });
  const range = useWidthRange();
  const { rightOpen, setRightOpen } = useScreenChrome();
  const openProfile = useContext(UserProfileContext)?.openProfile;
  const toasts = useToasts();
  const reportOpenError = useCallback((message: string) => void toasts.show({ tone: 'danger', message }), [toasts]);
  const opener = useAttachmentOpener(reportOpenError);
  const { byId: emojiById } = useCommunityCustomEmojis(communityId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [editing] = useState(createEditingStore);
  const haptics = useHapticFeedback();
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;
  // The message whose actions are open (one host for the whole list).
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const writableRef = useRef(writable);
  writableRef.current = writable;
  const openActions = useCallback((message: Message, via: OpenActionsVia) => {
    if (!writableRef.current) return;
    if (via === 'touch') hapticsRef.current.longPress();
    setActionsFor(message);
  }, []);
  const closeActions = useCallback(() => setActionsFor(null), []);
  // Reply (the shared quote-reply state; it resets when the channel changes). Sending goes through the composer.
  const { replyToMessage, handleQuoteReply, handleCancelReply } = useReplyAndEdit({
    contextType: VoiceSessionType.Channel,
    contextId: channelId,
    authorId: conversation.me,
    messages: NO_MESSAGES,
    onSendMessage: noSend,
  });
  const focusComposer = useCallback(() => {
    // After the actions sheet has given focus back to the row.
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);
  const onReply = useCallback(
    (message: Message) => {
      handleQuoteReply(message);
      focusComposer();
    },
    [handleQuoteReply, focusComposer],
  );
  const onEdit = useCallback((message: Message) => editing.start(message.id), [editing]);
  // One sender for the whole list's Retry (not one socket hook per row), read through a ref so the rows' shared
  // context stays the same when the connection changes.
  const { sendMessage: rawSend } = useSendMessage(VoiceSessionType.Channel);
  const rawSendRef = useRef(rawSend);
  rawSendRef.current = rawSend;
  const retrySend = useCallback((message: Message) => retryOptimisticMessage(queryClient, rawSendRef.current, message), [queryClient]);
  const removeFailed = useCallback((message: Message) => removeOptimisticRow(queryClient, message), [queryClient]);
  const escapeToInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

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
      writable,
      segments,
      showMessage,
      openPath,
      openProfile: hasProfile ? openProfileStable : undefined,
      opener,
      openActions,
      editing,
      retrySend,
      removeFailed,
    }),
    [conversation.me, communityId, writable, segments, showMessage, openPath, hasProfile, openProfileStable, opener, openActions, editing, retrySend, removeFailed],
  );

  const { onBack } = useChatBack(communityId);

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

  const state =
    face === 'loading' ? (
      <LoadingRows />
    ) : face === 'empty' ? (
      <StateMessage title="No messages yet." line="Start the conversation!" />
    ) : face === 'gone' ? (
      <GoneState communityId={communityId} />
    ) : face === 'noAccess' ? (
      <NoAccessState communityId={communityId} />
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
        list={face === 'list' ? <ChatList conversation={conversation} onEscapeToInput={escapeToInput} /> : undefined}
        typing={<TypingLine names={typingNames} />}
        jump={
          face === 'list' && conversation.jump.shown ? (
            <JumpToLatest onJump={conversation.jump.onJump} newCount={conversation.jump.newCount} />
          ) : undefined
        }
        announcement={conversation.announcement}
        composer={
          writable && (face === 'list' || face === 'empty') ? (
            <ChatComposer
              communityId={communityId}
              channelId={channelId}
              me={conversation.me}
              inputRef={inputRef}
              replyTo={replyToMessage}
              onCancelReply={handleCancelReply}
            />
          ) : undefined
        }
      />
      <MessageActionsSheet
        message={actionsFor}
        me={conversation.me}
        communityId={communityId}
        onDone={closeActions}
        onReply={onReply}
        onEdit={onEdit}
      />
    </ChatRowContext>
  );
}

/** The chat's frame before (or instead of) a conversation: the header with Back, and one state. */
function ChannelChatState({
  communityId,
  title,
  isPrivate,
  state,
}: {
  communityId: string;
  title: string | null;
  /** The known channel's privacy (the lock); false while the channel is unknown. */
  isPrivate: boolean;
  state: JSX.Element;
}): JSX.Element {
  const { onBack } = useChatBack(communityId);
  return (
    <ChatPane
      header={<ChatHeader title={title} isPrivate={isPrivate} onBack={onBack} />}
      state={state}
    />
  );
}

function GoneState({ communityId }: { communityId: string }): JSX.Element {
  const { goHome } = useChatBack(communityId);
  return (
    <StateMessage
      title="Channel not found"
      line="It may have been deleted, or the link is wrong."
      action={<Button onClick={goHome}>Go to the community</Button>}
    />
  );
}

function NoAccessState({ communityId }: { communityId: string }): JSX.Element {
  const { goHome } = useChatBack(communityId);
  return (
    <StateMessage
      title="You don't have access to this channel"
      line="It may be private, or you may have been removed from this community."
      action={<Button onClick={goHome}>Go to the community</Button>}
    />
  );
}

/** A voice channel has no chat: its route is the old shell's call view (I1, M1). */
function VoiceChannelState({ communityId }: { communityId: string }): JSX.Element {
  const { goHome } = useChatBack(communityId);
  return (
    <StateMessage
      title="Voice channel"
      line="Join it from the community's voice rooms."
      action={<Button onClick={goHome}>Go to the community</Button>}
    />
  );
}

/**
 * The centre of the chat screen: one conversation per channel (a switch starts the next one fresh), once the
 * community's channel list says the channel is not a voice one. Until then skeleton rows; a list that fails says so
 * with Try again (at phone width the left island's own Retry is hidden). A voice channel gets no chat: the chat notes
 * it (`voiceChannelMemory`), so the shell shows the old shell's call view, and until then (or on the hidden fixture)
 * a plain "Voice channel" state with Back.
 */
export function ChannelChat({ params }: LoungeScreenProps): JSX.Element {
  const communityId = params.communityId ?? '';
  const channelId = params.channelId ?? '';
  const { channel, status, error, refetch } = useRouteChannel({ communityId, channelId });
  const isVoice = channel?.type === ChannelType.VOICE;
  useEffect(() => {
    if (isVoice) noteVoiceChannels([channelId]);
  }, [isVoice, channelId]);
  if (isVoice) {
    return (
      <ChannelChatState
        communityId={communityId}
        title={channel.name}
        isPrivate={channel.isPrivate === true}
        state={<VoiceChannelState communityId={communityId} />}
      />
    );
  }
  if (status === 'pending') {
    return <ChannelChatState communityId={communityId} title={null} isPrivate={false} state={<LoadingRows />} />;
  }
  if (status === 'error') {
    // The list's 403 or 404 reads like the messages' own (a removed member's or a stale link): Try again could never work.
    const code = getHttpStatus(error);
    const state =
      code === 404 ? (
        <GoneState communityId={communityId} />
      ) : code === 403 ? (
        <NoAccessState communityId={communityId} />
      ) : (
        <StateMessage title="Couldn't load the channel" action={<Button onClick={refetch}>Try again</Button>} />
      );
    return <ChannelChatState communityId={communityId} title="Channel" isPrivate={false} state={state} />;
  }
  return <ChannelChatBody key={`${communityId}/${channelId}`} communityId={communityId} channelId={channelId} />;
}
