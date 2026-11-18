/**
 * A text channel's composer for the new shell's chat screen: one hook over the shared composer layer, so the screen
 * stays a view and a native shell can mirror the same model. Every behaviour is the old composer's
 * (`components/Message/MessageInput.tsx`), from the same hooks: the draft (`useComposerDraft`, one key for both
 * shells, so a half-typed message survives a shell swap), whether the reader may write (`useComposerAvailability`),
 * typing (`useTypingEmitter`), mentions (`useMentionAutocomplete`, the caret from `useMentionHandling`), queued files
 * (`useFileAttachments`), the keys (`useComposerKeys`: the input-method guard first, then the mention list, Escape
 * cancels a reply, Enter sends on a keyboard) and building the message's spans (`parseMessageWithMentions`).
 *
 * Who the mention list offers is the old composer's: every member of the community, also in a private channel
 * (`useMentionAutocomplete` reads the community's members).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  aliasGroupsControllerGetCommunityAliasGroupsOptions,
  channelsControllerGetMentionableChannelsOptions,
} from '../../api-client/@tanstack/react-query.gen';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { useAllCommunityMembers } from '../../hooks/useAllCommunityMembers';
import { useCommunityCustomEmojis } from '../../hooks/useCommunityCustomEmojis';
import { useComposerAvailability, type ComposerAvailability } from '../../hooks/useComposerAvailability';
import { useComposerDraft } from '../../hooks/useComposerDraft';
import { useMentionAutocomplete, type MentionSuggestion as ListedMention } from '../../hooks/useMentionAutocomplete';
import { useTypingEmitter } from '../../hooks/useTypingEmitter';
import { SpanType, type Span } from '../../types/message.type';
import { formatFileSize } from '../../utils/format';
import { formatRoleList } from '../../utils/formatRoleList';
import { insertMention, parseMessageWithMentions, type UserMention, type ChannelMention } from '../../utils/mentionParser';
import { logger } from '../../utils/logger';
import { useComposerKeys, type SimpleMentionState } from './useComposerKeys';
import { useFileAttachments } from './useFileAttachments';
import { useMentionHandling } from './useMentionHandling';

/** "12 min", "2 h 5 min", "42 s": rounded up so it never reads "0" (as the old composer). */
export function formatTimeLeft(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export type ComposerNoticeKind = 'read-only' | 'no-permission' | 'timed-out' | 'banned';

/** Why the reader cannot write here, in the old composer's words (`ComposerUnavailableNotice`). */
export function composerNotice(availability: ComposerAvailability): { kind: ComposerNoticeKind; text: string } | null {
  const reason = availability.reason ? ` Reason: ${availability.reason}` : '';
  switch (availability.state) {
    case 'read-only': {
      const where = availability.channelName ? `#${availability.channelName}` : 'This channel';
      const who = availability.postingRoleNames ?? [];
      const text = who.length > 0 ? `${where} is read-only. Only ${formatRoleList(who)} can post.` : `${where} is read-only.`;
      return { kind: 'read-only', text: text + reason };
    }
    case 'no-permission':
      return {
        kind: 'no-permission',
        text:
          (availability.channelName
            ? `You can't send messages in #${availability.channelName}`
            : "You can't send messages in this channel") + reason,
      };
    case 'timed-out':
      return {
        kind: 'timed-out',
        text:
          (availability.remainingMs !== undefined
            ? `Timed out, ${formatTimeLeft(availability.remainingMs)} left`
            : "You're timed out in this community") + reason,
      };
    case 'banned':
      return { kind: 'banned', text: "You're banned from this community" + reason };
    default:
      return null;
  }
}

/** One queued file, as the tray draws it. */
export interface QueuedFileView {
  key: string;
  index: number;
  name: string;
  /** Its size, for people. */
  detail: string;
  /** A picture's preview (a data URL), once read. */
  preview?: string;
}

export interface MentionListView {
  suggestions: readonly ListedMention[];
  activeIndex: number;
  loading: boolean;
  pick: (index: number) => void;
}

export interface UseChannelComposerOptions {
  communityId: string;
  channelId: string;
  /**
   * A reply in this message's thread instead of a channel message: its own draft, the thread's posting permission,
   * no typing line (threads have none), and the words and files stay until the server has the reply (`send`
   * resolves true), since a thread shows no pending row.
   */
  thread?: { parentMessageId: string };
  /** The text field (the kit Composer's `ref`). */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Sends the message (the shared upload-aware send), with the reply's id when replying. In a thread it resolves
   * true once the server has the reply (the composer clears then).
   */
  send: (content: string, spans: Span[], files: File[]) => Promise<void | boolean> | void;
  /** Tells the reader something failed or was refused (a toast). */
  onError: (message: string) => void;
  /** Touch first: Enter is a new line, never a send. */
  touch: boolean;
  /** Set while replying: Escape in the field cancels the reply. */
  onCancelReply?: () => void;
}

const NO_DM_MENTIONS: SimpleMentionState = { isOpen: false, suggestions: [], selectedIndex: 0, query: '', type: null, isLoading: false };

export function useChannelComposer({ communityId, channelId, thread, inputRef, send, onError, touch, onCancelReply }: UseChannelComposerOptions) {
  const [text, setText, clearDraft] = useComposerDraft(thread ? `thread:${thread.parentMessageId}` : `channel:${channelId}`);
  const [sending, setSending] = useState(false);
  const availability = useComposerAvailability({
    contextType: VoiceSessionType.Channel,
    contextId: channelId,
    communityId,
    thread: thread !== undefined,
  });
  const canCompose = availability.state === 'ok';
  const canAttach = availability.canAttach ?? true;
  const { handleKeyPress: emitTyping, sendTypingStop } = useTypingEmitter({ channelId: thread ? undefined : channelId });
  const keepUntilSent = thread !== undefined;
  const textRef = useRef(text);
  textRef.current = text;

  // --- Files ---
  const files = useFileAttachments();
  const { validationError, clearValidationError } = files;
  useEffect(() => {
    if (validationError) {
      onError(validationError);
      clearValidationError();
    }
  }, [validationError, onError, clearValidationError]);
  const attachUnavailableText = availability.channelName
    ? `Attaching files is turned off in #${availability.channelName}`
    : 'Attaching files is turned off in this channel';
  const queued: QueuedFileView[] = files.selectedFiles.map((file, index) => ({
    key: `${index}:${file.name}:${file.size}:${file.lastModified}`,
    index,
    name: file.name,
    detail: formatFileSize(file.size),
    preview: files.filePreviews.get(index),
  }));

  // --- Mentions: the caret, the server-backed list, and what a sent message's spans resolve against ---
  const { cursorPosition, updateCursorPosition, setupCursorTracking } = useMentionHandling();
  useEffect(() => {
    setupCursorTracking(inputRef as RefObject<HTMLInputElement | null>);
  }, [setupCursorTracking, inputRef, canCompose]);
  const mentionHook = useMentionAutocomplete({ communityId, text, cursorPosition });
  const { data: members = [] } = useAllCommunityMembers(communityId, { enabled: !!communityId });
  const { data: mentionableChannels = [] } = useQuery({
    ...channelsControllerGetMentionableChannelsOptions({ path: { communityId } }),
    enabled: !!communityId,
  });
  const { data: aliasGroups = [] } = useQuery({
    ...aliasGroupsControllerGetCommunityAliasGroupsOptions({ path: { communityId } }),
    enabled: !!communityId,
  });
  const { emojis: customEmojis } = useCommunityCustomEmojis(communityId);
  const userMentions: UserMention[] = useMemo(
    () =>
      members
        .filter((member) => member.user)
        .map((member) => ({ id: member.user!.id, username: member.user!.username, displayName: member.user!.displayName || undefined })),
    [members],
  );
  const channelMentions: ChannelMention[] = useMemo(
    () => mentionableChannels.map((channel) => ({ id: channel.id, name: channel.name })),
    [mentionableChannels],
  );
  const aliasMentions = useMemo(() => aliasGroups.map((group) => ({ id: group.id, name: group.name })), [aliasGroups]);
  const emojiMentions = useMemo(() => customEmojis.map((emoji) => ({ id: emoji.id, name: emoji.name })), [customEmojis]);

  // After a mention goes in, the caret goes after it once the field shows the new text.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    const field = inputRef.current;
    if (at === null || field === null) return;
    pendingCaret.current = null;
    field.setSelectionRange(at, at);
    updateCursorPosition();
  }, [text, inputRef, updateCursorPosition]);

  const handleMentionSelect = useCallback(
    (index: number) => {
      const chosen = mentionHook.state.suggestions[index];
      if (!chosen) return;
      const result = insertMention(text, cursorPosition, {
        type: chosen.type,
        username: chosen.type === 'user' ? chosen.displayName : undefined,
        specialKind: chosen.type === 'special' ? chosen.displayName : undefined,
        aliasName: chosen.type === 'alias' ? chosen.displayName : undefined,
      });
      pendingCaret.current = result.newCursorPosition;
      setText(result.newText);
      mentionHook.close();
    },
    [mentionHook, text, cursorPosition, setText],
  );

  // --- Send ---
  const sendingRef = useRef(false);
  const handleSend = useCallback(async () => {
    const selected = files.selectedFiles;
    if (!text.trim() && selected.length === 0) return;
    // One send at a time, until the server answers (the old composer's rule, which optimistic sends rely on).
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const content = text.trim();
      let spans: Span[] = parseMessageWithMentions(content, userMentions, channelMentions, aliasMentions, emojiMentions);
      if (spans.length === 0) spans = [{ type: SpanType.PLAINTEXT, text: '' }];
      // The send puts its pending row in the list at once (before it waits for the server): the field and the tray
      // clear now, as the old composer's do, and are never touched again by this send. What the reader types while
      // it waits for the server stays, whatever the answer.
      const sent = send(content, spans, selected);
      if (keepUntilSent) {
        // A thread shows no pending row: the words and files stay until the server has the reply. Then only what
        // was sent goes: the sent words (what was typed after them stays, so it is never sent twice) and the sent
        // files (files added meanwhile stay queued).
        mentionHook.close();
        const done = await sent;
        if (done === true) {
          const now = textRef.current;
          const lead = now.length - now.trimStart().length;
          if (now.trim() === content) clearDraft();
          else if (now.slice(lead).startsWith(content)) setText(now.slice(lead + content.length).trimStart());
          files.removeFiles(selected);
        }
        return;
      }
      clearDraft();
      files.clearFiles();
      mentionHook.close();
      // "Typing" ends with the send, not with the server's answer: a slow answer must not leave "is typing" up
      // for a message already in the list, nor cut off the indicator for the next message being typed.
      sendTypingStop();
      await sent;
    } catch (error) {
      logger.error('Failed to send message:', error);
      onError('Failed to send message. Please try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [files, text, userMentions, channelMentions, aliasMentions, emojiMentions, send, sendTypingStop, clearDraft, setText, mentionHook, onError, keepUntilSent]);

  const { handleKeyPress } = useComposerKeys({
    inputRef: inputRef as RefObject<HTMLInputElement | null>,
    text,
    setText,
    selectedFiles: files.selectedFiles,
    isTouchDevice: touch,
    isChannel: true,
    mentionHook,
    dmMentionState: NO_DM_MENTIONS,
    setDmMentionState: () => undefined,
    handleDmInsertMention: () => undefined,
    closeDmMentions: () => undefined,
    handleMentionSelect,
    handleSend,
    onCancelReply,
  });

  const onChange = useCallback(
    (value: string) => {
      setText(value);
      emitTyping();
      updateCursorPosition();
    },
    [setText, emitTyping, updateCursorPosition],
  );

  const addFiles = useCallback(
    (picked: File[]) => {
      if (!canAttach) {
        onError(attachUnavailableText);
        return;
      }
      files.handleFileDrop(picked);
    },
    [canAttach, attachUnavailableText, files, onError],
  );

  const mentions: MentionListView | null =
    canCompose && mentionHook.state.isOpen
      ? {
          suggestions: mentionHook.state.suggestions,
          activeIndex: mentionHook.state.selectedIndex,
          loading: mentionHook.state.isLoading,
          pick: handleMentionSelect,
        }
      : null;

  return {
    text,
    onChange,
    /** The caret moved (keys, a tap, a selection): the mention list follows it. */
    onCaretMove: updateCursorPosition,
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      handleKeyPress(event);
      // The mention list takes its keys on the native event: tell the kit composer the key is taken.
      if (event.nativeEvent.defaultPrevented && !event.defaultPrevented) event.preventDefault();
    },
    send: handleSend,
    sending,
    canSend: text.trim() !== '' || files.selectedFiles.length > 0,
    notice: composerNotice(availability),
    channelName: availability.channelName,
    attach: {
      allowed: canAttach,
      unavailableText: attachUnavailableText,
      /** The hidden file input (the attach button clicks it). */
      inputRef: files.fileInputRef,
      onPicked: files.handleFileSelect,
      add: addFiles,
      queued,
      remove: files.handleRemoveFile,
    },
    mentions,
  };
}

export type ChannelComposer = ReturnType<typeof useChannelComposer>;
