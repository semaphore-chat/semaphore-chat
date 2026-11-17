/**
 * The chat composer in a thread (PR 10d-B): the thread's own draft and send (`useThreadReplySend`), mentions as in
 * the channel, no typing line, and the words stay until the server has the reply (a thread shows no pending row).
 */
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChatComposer } from '../../../shell/lounge/screens/chat/ChatComposer';
import {
  aliasGroupsControllerGetCommunityAliasGroupsQueryKey,
  channelsControllerGetMentionableChannelsQueryKey,
  customEmojiControllerListCommunityEmojisQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import type { ComposerAvailability } from '../../../hooks/useComposerAvailability';
import { clearComposerDrafts, composerDraftStorageKey } from '../../../hooks/useComposerDraft';
import { SpanType } from '../../../types/message.type';
import type { ThreadReplyOutcome } from '../../../hooks/useSendThreadReply';
import { createTestQueryClient, renderWithProviders } from '../../test-utils';

const replies = vi.hoisted(() => {
  const waiting: ((outcome: ThreadReplyOutcome | null) => void)[] = [];
  return { waiting, answer: (outcome: ThreadReplyOutcome | null) => waiting.shift()?.(outcome) };
});
const sendReply = vi.hoisted(() =>
  vi.fn((_request: unknown) => new Promise<ThreadReplyOutcome | null>((resolve) => replies.waiting.push(resolve))),
);
vi.mock('../../../hooks/useSendThreadReply', () => ({ useSendThreadReply: () => ({ sendReply }) }));
const channelSend = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useMessageFileUpload', () => ({ useMessageFileUpload: () => ({ handleSendMessage: channelSend }) }));
const availabilityArgs = vi.hoisted(() => [] as unknown[]);
vi.mock('../../../hooks/useComposerAvailability', () => ({
  useComposerAvailability: (args: unknown) => {
    availabilityArgs.push(args);
    return { state: 'ok', channelName: 'lobby', canAttach: true } as ComposerAvailability;
  },
}));
const typingArgs = vi.hoisted(() => [] as unknown[]);
vi.mock('../../../hooks/useTypingEmitter', () => ({
  useTypingEmitter: (args: unknown) => {
    typingArgs.push(args);
    return { handleKeyPress: vi.fn(), sendTypingStop: vi.fn() };
  },
}));
vi.mock('../../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: () => ({ data: [{ user: { id: 'u-alice', username: 'alice', displayName: 'Alice' } }], isLoading: false }),
}));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => false }));

function setup(onSent = vi.fn()) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(aliasGroupsControllerGetCommunityAliasGroupsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(channelsControllerGetMentionableChannelsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(customEmojiControllerListCommunityEmojisQueryKey({ path: { communityId: 'c-1' } }), []);
  const view = renderWithProviders(
    <FileCacheProvider>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <ChatComposer
          communityId="c-1"
          channelId="ch-1"
          me="me"
          inputRef={createRef<HTMLTextAreaElement>()}
          replyTo={null}
          onCancelReply={vi.fn()}
          thread={{ parentMessageId: 'p-1', onSent }}
        />
      </KitProvider>
    </FileCacheProvider>,
    { queryClient },
  );
  const field = () => screen.getByRole('textbox', { name: 'Reply in thread' }) as HTMLTextAreaElement;
  return { ...view, field, onSent };
}

describe('ChatComposer in a thread', () => {
  beforeEach(() => {
    sendReply.mockClear();
    channelSend.mockClear();
    replies.waiting.length = 0;
    availabilityArgs.length = 0;
    typingArgs.length = 0;
    clearComposerDrafts();
  });

  it("checks the thread's posting permission and says nothing about typing", () => {
    setup();
    expect(availabilityArgs.at(-1)).toEqual(expect.objectContaining({ thread: true, contextId: 'ch-1' }));
    expect(typingArgs.at(-1)).toEqual({ channelId: undefined });
  });

  it('sends a reply as spans; the words stay until the server has it, then clear and onSent runs', async () => {
    const { user, field, onSent } = setup();
    await user.type(field(), 'in the thread{Enter}');
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(sendReply).toHaveBeenCalledWith({ content: 'in the thread', spans: [{ type: SpanType.PLAINTEXT, text: 'in the thread' }], pendingAttachments: 0 });
    expect(channelSend).not.toHaveBeenCalled();
    expect(field().value).toBe('in the thread');
    await act(async () => replies.answer({ clear: true, messageId: 'r-1' }));
    await waitFor(() => expect(field().value).toBe(''));
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('a refused reply keeps the words and says why', async () => {
    const { user, field, onSent } = setup();
    await user.type(field(), 'too fast{Enter}');
    await act(async () => replies.answer({ clear: false, error: 'Slowmode is on' }));
    expect(await screen.findByText('Slowmode is on')).toBeInTheDocument();
    expect(field().value).toBe('too fast');
    expect(onSent).not.toHaveBeenCalled();
  });

  it('a mention resolves against the community, as in the channel', async () => {
    const { user, field } = setup();
    await user.type(field(), '@Ali');
    const option = await screen.findByRole('option', { name: /Alice/ });
    await user.click(option);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    const { spans } = sendReply.mock.calls[0][0] as { spans: { type: string; userId?: string }[] };
    expect(spans).toEqual(expect.arrayContaining([expect.objectContaining({ type: SpanType.USER_MENTION, userId: 'u-alice' })]));
  });

  it('its draft is its own: the channel draft is untouched', async () => {
    const { user, field } = setup();
    await user.type(field(), 'half typed');
    await waitFor(() => expect(sessionStorage.getItem(composerDraftStorageKey('thread:p-1'))).toBe('half typed'));
    expect(sessionStorage.getItem(composerDraftStorageKey('channel:ch-1'))).toBeNull();
  });
});
