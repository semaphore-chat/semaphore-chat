/**
 * The new shell's text channel chat: the header, the shared message list with kit rows, the day and unread
 * separators, read marking, Jump to latest with "N new", the typing line and `?highlight=` deep links, all on the
 * shared chat layer (`data/chat/useConversation`) (PR 10c-1); and the write side (PR 10c-2a): the composer
 * (`ChatComposer`), a message's actions (`MessageActionsSheet`), editing in place, and Retry or Delete on a failed
 * send. The real channel route's at phone width (PR 10c-2b, `ChannelChatScreen`), and the hidden chat fixture's.
 *
 * At compact and wide (PR 10e) the community's list is beside the chat, so there is no Back; a thread and (at wide)
 * the pinned messages are the frame's right panel (`ScreenChrome.setPanel`), portalled into its slot, in place of the
 * members; at wide the composer takes focus on entry (B4); the channel is remembered as the community's last at every
 * width (both shells open it next).
 *
 * Typing in the composer and opening a message's actions re-render no row: the composer keeps its own state, and
 * what rows share (`ChatRowContext`) holds only stable values.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { moderationControllerGetPinnedMessagesOptions } from '../../../../api-client/@tanstack/react-query.gen';
import type { PinnedMessageDto } from '../../../../api-client/types.gen';
import { pinnedJumpTarget } from '../../../../data/chat/usePinnedList';
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
import { readThreadParam, searchWith, THREAD_PARAM } from '../../../../data/chat/threadParam';
import { navigateAfterLayers } from '../../../../data/systemBack';
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
import { MessageMediaViewer, type ViewerRequest } from './MessageMediaViewer';
import { ReactionPeopleSheet, type ReactionPeopleRequest } from './ReactionPeopleSheet';
import { THREAD_VIEW_ATTRIBUTE, ThreadView } from './ThreadView';
import { PinnedPanel, PinnedSheet } from './PinnedSheet';
import { ReactionPickerSheet, type ReactionPickerRequest } from './ReactionPickerSheet';
import { useComposerDrop } from './composerDrop';
import { findLastEditableMessage } from '../../../../data/chat/lastEditable';
import { focusIsAtRest, hasKeyboardFocus } from './focusRules';
import { useTouchFirst } from '../../../../data/touchFirst';
import type { OpenActionsVia } from '../../../../kit';
import { channelTitle, useRouteChannel } from './channelTitle';
import { setLastChannelId } from '../../../../utils/lastChannel';

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
function useChatBack(communityId: string): { onBack: (() => void) | undefined; goHome: () => void } {
  const navigate = useNavigate();
  // Back is a phone's: at compact and wide the community's list is on screen beside the chat.
  const phone = useWidthRange() === 'phone';
  const homePath = pathOf(useLoungeLinks().community(communityId));
  const onBack = useCallback(() => {
    if (previousPathname() === homePath) navigate(-1);
    else navigate(homePath, { replace: true });
  }, [homePath, navigate]);
  const goHome = useCallback(() => navigate(homePath, { replace: true }), [homePath, navigate]);
  return { onBack: phone ? onBack : undefined, goHome };
}

/** The history entry a thread was opened into from this chat (Back then closes it with a step back). */
interface ThreadEntryState {
  threadFrom?: string;
}

/**
 * Where focus goes when the thread closes: what opened it (the "3 replies" button, or the row "Reply in thread" came
 * from), else the parent's row, else the composer's field. Tried over a few frames: the channel underneath stops
 * being inert, and a row the list had recycled comes back after scrolling to it.
 */
function focusAfterThread(opener: HTMLElement | null, parentId: string | null, scrollTo: (id: string) => void, field: HTMLElement | null) {
  const usable = (element: Element | null | undefined): element is HTMLElement =>
    element instanceof HTMLElement && element.isConnected && element.closest('[inert]') === null;
  if (parentId !== null && !usable(opener)) scrollTo(parentId);
  let frames = 0;
  const attempt = () => {
    const active = document.activeElement;
    // Something else took focus meanwhile (a sheet, the reader): leave it. The body and a layout pane (the frame
    // focuses the pane when the members island is hidden) are nobody's choice.
    if (!focusIsAtRest(active) && usable(active)) return;
    if (usable(opener)) return opener.focus({ preventScroll: true });
    const row =
      parentId === null
        ? null
        : [...document.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find((element) => element.dataset.messageId === parentId && element.closest('[inert]') === null)
            ?.querySelector<HTMLElement>('[data-row-focus-target]');
    if (usable(row)) return row.focus({ preventScroll: true });
    frames += 1;
    if (frames < 10) {
      requestAnimationFrame(attempt);
      return;
    }
    if (usable(field)) field.focus({ preventScroll: true });
  };
  requestAnimationFrame(attempt);
}

function ChannelChatBody({ communityId, channelId }: { communityId: string; channelId: string }): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const links = useLoungeLinks();
  const chatPath = pathOf(links.channel(communityId, channelId));
  const { channel, loaded } = useRouteChannel({ communityId, channelId });
  // Only a channel the list confirms is a text channel may be written to (I1): a channel missing from the list
  // (no access, deleted) reads without a composer, reactions or actions.
  const writable = channel?.type === ChannelType.TEXT;
  // The open thread (`?thread=`). On a phone it covers the channel; at compact it is a Sheet over it; in both the
  // channel then marks nothing read and announces nothing. At wide it is beside the channel, which stays live.
  const threadId = readThreadParam(searchParams);
  const range = useWidthRange();
  const conversation = useConversation({ communityId, channelId, chatPath, covered: threadId !== null && range !== 'wide' });
  const { rightOpen, setRightOpen, showRight, panel: shownPanel, setPanel, panelTarget } = useScreenChrome();
  // Where a thread goes: over the channel on a phone, the frame's right panel at compact and wide.
  const threadInPanel = threadId !== null && range !== 'phone';
  const openProfile = useContext(UserProfileContext)?.openProfile;
  const toasts = useToasts();
  const reportOpenError = useCallback((message: string) => void toasts.show({ tone: 'danger', message }), [toasts]);
  const opener = useAttachmentOpener(reportOpenError);
  const { byId: emojiById } = useCommunityCustomEmojis(communityId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadInputRef = useRef<HTMLTextAreaElement>(null);
  const [editing] = useState(createEditingStore);
  // The thread's own edit state: its parent is also a row of the channel underneath, which must not edit too.
  const [threadEditing] = useState(createEditingStore);
  const haptics = useHapticFeedback();
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;
  // The message whose actions are open (one host for the whole list).
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const writableRef = useRef(writable);
  writableRef.current = writable;
  // The row whose actions are open (it has focus as they open): where "See reactions" returns focus.
  const actionsRow = useRef<HTMLElement | null>(null);
  // Whether the open actions are a thread row's: at wide the thread and its channel are both on screen.
  const [actionsInThread, setActionsInThread] = useState(false);
  const openActions = useCallback((message: Message, via: OpenActionsVia) => {
    if (!writableRef.current) return;
    const active = document.activeElement;
    actionsRow.current = active instanceof HTMLElement ? active : null;
    setActionsInThread(actionsRow.current?.closest(`[${THREAD_VIEW_ATTRIBUTE}]`) != null);
    if (via === 'touch') hapticsRef.current.longPress();
    setActionsFor(message);
  }, []);
  const closeActions = useCallback(() => setActionsFor(null), []);
  // The picture viewer and who reacted: one host each for the whole list.
  const [viewer, setViewer] = useState<ViewerRequest | null>(null);
  const openViewer = useCallback((message: Message, fileId: string) => setViewer({ message, fileId }), []);
  const closeViewer = useCallback(() => setViewer(null), []);
  const [reactionPeople, setReactionPeople] = useState<ReactionPeopleRequest | null>(null);
  const showReactions = useCallback(
    (message: Message, reactionKey?: string, returnTo?: HTMLElement | null) =>
      setReactionPeople({ message, ...(reactionKey ? { reactionKey } : {}), returnTo: returnTo ?? null }),
    [],
  );
  // From the actions sheet, which closes as this one opens: focus returns to the message's row.
  const showReactionsFromActions = useCallback(
    (message: Message) => showReactions(message, undefined, actionsRow.current),
    [showReactions],
  );
  const closeReactions = useCallback(() => setReactionPeople(null), []);
  // "More reactions": the emoji picker, reacting to the message; focus returns to its row.
  const [reactionPicker, setReactionPicker] = useState<ReactionPickerRequest | null>(null);
  const moreReactions = useCallback((message: Message) => setReactionPicker({ message, returnTo: actionsRow.current }), []);
  const closeReactionPicker = useCallback(() => setReactionPicker(null), []);
  const touch = useTouchFirst(range);
  // Files dropped on the conversation go to the composer.
  const drop = useComposerDrop();
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
  const onEdit = useCallback(
    (message: Message) => (actionsInThread ? threadEditing : editing).start(message.id),
    [editing, threadEditing, actionsInThread],
  );
  // ↑ in the empty composer: the reader's newest message that can be edited opens in place, scrolled into view.
  const orderedRef = useRef(conversation.orderedMessages);
  orderedRef.current = conversation.orderedMessages;
  const listRef = conversation.listRef;
  const me = conversation.me;
  const editLastMessage = useCallback((): boolean => {
    const last = findLastEditableMessage([...orderedRef.current].reverse(), me);
    if (last === null) return false;
    editing.start(last.id);
    listRef.current?.scrollToMessage(last.id);
    return true;
  }, [editing, listRef, me]);

  // --- The thread: opened into a new history entry (Back closes it), on the channel's own path ---
  const searchRef = useRef(searchParams);
  searchRef.current = searchParams;
  const threadOpener = useRef<HTMLElement | null>(null);
  // Through a ref, so the rows' shared context does not change with the navigate function.
  const threadNavigate = useRef(navigate);
  threadNavigate.current = navigate;
  const openThread = useCallback(
    (message: Message, opener: HTMLElement | null) => {
      const active = document.activeElement;
      threadOpener.current = opener ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      const state: ThreadEntryState = { threadFrom: chatPath };
      // A jump still settling stays with the channel's entry: the thread's entry has no `?highlight=` (Back would
      // run the jump again).
      const withoutJump = new URLSearchParams(searchWith(searchRef.current, 'highlight', null));
      threadNavigate.current(`${chatPath}${searchWith(withoutJump, THREAD_PARAM, message.id)}`, { state });
    },
    [chatPath],
  );
  const openThreadFromActions = useCallback((message: Message) => openThread(message, actionsRow.current), [openThread]);
  const closeThread = useCallback(() => {
    if ((location.state as ThreadEntryState | null)?.threadFrom === chatPath) navigate(-1);
    else navigate(`${chatPath}${searchWith(searchRef.current, THREAD_PARAM, null)}`, { replace: true });
  }, [location.state, chatPath, navigate]);
  // Closed (Back, its button, the browser's Back): focus back where it came from.
  const lastThread = useRef<string | null>(threadId);
  useEffect(() => {
    const was = lastThread.current;
    lastThread.current = threadId;
    if (was === null || threadId !== null) return;
    const opener = threadOpener.current;
    threadOpener.current = null;
    focusAfterThread(opener, was, (id) => conversation.listRef.current?.scrollToMessage(id), inputRef.current);
  }, [threadId, conversation.listRef]);
  // --- Pinned messages: a sheet from More; a jump closes it and centres the message (a thread reply: its parent,
  // then its thread opens, in a new entry so Back closes it) ---
  // Only for a known text channel: an unknown, gone or forbidden one would only earn a refusal.
  const { data: pins = [] } = useQuery({ ...moderationControllerGetPinnedMessagesOptions({ path: { channelId } }), enabled: writable });
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedOpener, setPinnedOpener] = useState<HTMLElement | null>(null);
  const showPinned = useCallback((opener: HTMLElement | null) => {
    setPinnedOpener(opener);
    setPinnedOpen(true);
  }, []);
  const closePinned = useCallback(() => setPinnedOpen(false), []);
  const jumpToPin = useCallback(
    (pin: PinnedMessageDto) => {
      const target = pinnedJumpTarget(pin);
      // After the sheet's own history entry is gone: the jump lands on the chat's entry (Back and the header's back
      // arrow then leave in one press).
      navigateAfterLayers(() => {
        if (target.thread !== undefined) {
          threadOpener.current = null;
          const state: ThreadEntryState = { threadFrom: chatPath };
          navigate(`${chatPath}?highlight=${target.highlight}&${THREAD_PARAM}=${target.thread}`, { state });
        } else {
          navigate(`${chatPath}?highlight=${target.highlight}`, { replace: true });
        }
      });
    },
    [chatPath, navigate],
  );
  const threadParent = useMemo(
    () => (threadId === null ? null : (conversation.orderedMessages.find((m) => m.id === threadId) ?? null)),
    [threadId, conversation.orderedMessages],
  );

  // --- The right panel (compact and wide): the thread, else (wide only) the pinned messages, in the members' place.
  // A thread opened from a pin takes the panel; closing it brings the pins back. ---
  const pinsInPanel = pinnedOpen && range === 'wide' && !threadInPanel;
  const closePinnedPanel = useCallback(() => {
    setPinnedOpen(false);
    // The More button that opened them (its menu has closed); it stays in the header.
    requestAnimationFrame(() => {
      if (pinnedOpener?.isConnected) pinnedOpener.focus({ preventScroll: true });
    });
  }, [pinnedOpener]);
  const closeThreadRef = useRef(closeThread);
  closeThreadRef.current = closeThread;
  const closePinnedRef = useRef(closePinnedPanel);
  closePinnedRef.current = closePinnedPanel;
  const panelKind = threadInPanel ? 'thread' : pinsInPanel ? 'pins' : null;
  useEffect(() => {
    setPanel(
      panelKind === 'thread'
        ? { label: 'Thread', fill: true, onClose: () => closeThreadRef.current() }
        : panelKind === 'pins'
          ? { label: 'Pinned messages', onClose: () => closePinnedRef.current() }
          : null,
    );
  }, [panelKind, setPanel]);
  // The panel goes with the chat (another channel, another screen).
  useEffect(() => () => setPanel(null), [setPanel]);
  // Both shells open this channel next time the community is opened with none chosen.
  useEffect(() => {
    if (writable) setLastChannelId(conversation.me || undefined, communityId, channelId);
  }, [writable, conversation.me, communityId, channelId]);
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
      openViewer,
      showReactions,
      editing,
      retrySend,
      removeFailed,
      openThread,
    }),
    [
      openThread,
      conversation.me,
      communityId,
      writable,
      segments,
      showMessage,
      openPath,
      hasProfile,
      openProfileStable,
      opener,
      openActions,
      openViewer,
      showReactions,
      editing,
      retrySend,
      removeFailed,
    ],
  );

  const { onBack } = useChatBack(communityId);

  const typingUsers = useUsers(conversation.typingUserIds);
  const typingNames = conversation.typingUserIds.map((_, i) => {
    const user = typingUsers[i]?.data;
    return user?.displayName || user?.username || 'Someone';
  });

  const face = faceOf(conversation);

  // Members: at wide a toggle for the island (pressed while it shows, not while a panel has its place); below wide it
  // opens the Sheet. Showing them closes a panel (one thing at a time in the right region).
  const membersShown = range === 'wide' ? rightOpen && shownPanel === null : undefined;
  // At wide the toggle stays on screen whichever way it is pressed, so focus stays on it: the island opens through
  // `setRightOpen` (the frame closes a panel first through `showRight`, which also moves focus into the island).
  const onMembers = useCallback(() => {
    if (membersShown === true) {
      setRightOpen(false);
      return;
    }
    if (range === 'wide') {
      shownPanel?.onClose();
      setRightOpen(true);
      return;
    }
    showRight();
  }, [membersShown, range, setRightOpen, shownPanel, showRight]);

  // B4: at wide, on a pointer-first device, the composer takes focus once on entry, unless the user is moving through
  // a list (the dock, the channels) or is in a layer, or a thread opened with the chat (its heading has focus).
  const composerShown = writable && (face === 'list' || face === 'empty');
  const entryFocused = useRef(false);
  useEffect(() => {
    if (touch || !composerShown || entryFocused.current) return;
    const handle = requestAnimationFrame(() => {
      // The entry is over at any width: a later resize into wide must not take focus from where the user is.
      entryFocused.current = true;
      if (range !== 'wide' || threadId !== null) return;
      const active = document.activeElement;
      if (active?.closest('[role="dialog"], [aria-modal="true"]')) return;
      // Focus rests (body, the heading, a pane), or a mouse press left it on a link of the left island. A keyboard
      // user in the island, or in an open menu, keeps their place.
      const pressed = active !== null && active.closest('nav') !== null && !hasKeyboardFocus(active);
      if (!focusIsAtRest(active) && !pressed) return;
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(handle);
    // `threadId` is read for the entry only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, range, composerShown]);
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
            onShowMembers={channel === null || face === 'noAccess' || face === 'gone' ? undefined : onMembers}
            membersShown={membersShown}
            onSearch={() => navigate(`/community/${communityId}/channel/${channelId}/search`)}
            onShowPinned={face === 'gone' || face === 'noAccess' ? undefined : showPinned}
            pinnedCount={pins.length}
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
        dropZone={drop.dropZone}
        cover={
          threadId !== null && !threadInPanel ? (
            <ThreadView
              key={threadId}
              communityId={communityId}
              channelId={channelId}
              channelTitle={channel === null ? null : channelTitle(channel)}
              parentMessageId={threadId}
              parent={threadParent}
              writable={writable}
              shared={shared}
              editing={threadEditing}
              inputRef={threadInputRef}
              onClose={closeThread}
            />
          ) : undefined
        }
        composer={
          writable && (face === 'list' || face === 'empty') ? (
            <ChatComposer
              communityId={communityId}
              channelId={channelId}
              me={conversation.me}
              inputRef={inputRef}
              replyTo={replyToMessage}
              onCancelReply={handleCancelReply}
              dropActive={drop.active}
              dropInto={drop.into}
              onEditLastMessage={editLastMessage}
            />
          ) : undefined
        }
      />
      <MessageActionsSheet
        message={actionsFor}
        me={conversation.me}
        communityId={communityId}
        onDone={closeActions}
        // Inside a thread: no quote reply and no thread of a thread (as the old thread panel).
        onReply={actionsInThread ? undefined : onReply}
        onReplyInThread={actionsInThread ? undefined : openThreadFromActions}
        onEdit={onEdit}
        onShowReactions={showReactionsFromActions}
        onMoreReactions={moreReactions}
      />
      {threadInPanel &&
        threadId !== null &&
        panelTarget !== null &&
        createPortal(
          <ThreadView
            key={threadId}
            placement="panel"
            communityId={communityId}
            channelId={channelId}
            channelTitle={channel === null ? null : channelTitle(channel)}
            parentMessageId={threadId}
            parent={threadParent}
            writable={writable}
            shared={shared}
            editing={threadEditing}
            inputRef={threadInputRef}
            onClose={closeThread}
          />,
          panelTarget,
        )}
      {pinsInPanel &&
        panelTarget !== null &&
        createPortal(
          <PinnedPanel communityId={communityId} channelId={channelId} writable={writable} onClose={closePinnedPanel} onJump={jumpToPin} />,
          panelTarget,
        )}
      {pinnedOpen && range !== 'wide' && (
        <PinnedSheet
          communityId={communityId}
          channelId={channelId}
          writable={writable}
          opener={pinnedOpener}
          onDone={closePinned}
          onJump={jumpToPin}
        />
      )}
      <ReactionPickerSheet
        request={reactionPicker}
        me={conversation.me}
        communityId={communityId}
        touch={touch}
        onDone={closeReactionPicker}
      />
      <MessageMediaViewer request={viewer} opener={opener} onDone={closeViewer} />
      <ReactionPeopleSheet request={reactionPeople} me={conversation.me} emoji={segments} onDone={closeReactions} />
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
