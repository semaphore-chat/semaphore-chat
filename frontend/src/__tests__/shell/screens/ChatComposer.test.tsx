/**
 * The new shell chat's composer (PR 10c-2a) on the shared composer model: send (with the reply's id), Enter on a
 * keyboard only and never while an input method composes, the reply banner and Escape, mentions with the combobox
 * wiring (at the caret), queued files, and the notices that replace the field.
 */
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { KitProvider, personColour } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChatComposer } from '../../../shell/lounge/screens/chat/ChatComposer';
import {
  aliasGroupsControllerGetCommunityAliasGroupsQueryKey,
  channelsControllerGetMentionableChannelsQueryKey,
  customEmojiControllerListCommunityEmojisQueryKey,
  userControllerGetUserByIdQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import type { ComposerAvailability } from '../../../hooks/useComposerAvailability';
import { clearComposerDrafts } from '../../../hooks/useComposerDraft';
import { SpanType, type Message } from '../../../types/message.type';
import { createMessage, createTestQueryClient, renderWithProviders } from '../../test-utils';

/**
 * The server's acknowledgement, held until a test answers it (as a real send, which settles only on the ack or a
 * timeout). `acks.answer()` settles the oldest send; `acks.refuse()` rejects it.
 */
const acks = vi.hoisted(() => {
  const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
  return {
    waiting,
    answer: () => waiting.shift()?.resolve(),
    refuse: () => waiting.shift()?.reject(new Error('refused')),
  };
});
const sendSpy = vi.hoisted(() =>
  vi.fn(
    (..._args: unknown[]) =>
      new Promise<void>((resolve, reject) => {
        acks.waiting.push({ resolve, reject });
      }),
  ),
);
vi.mock('../../../hooks/useMessageFileUpload', () => ({ useMessageFileUpload: () => ({ handleSendMessage: sendSpy }) }));
const availability = vi.hoisted(() => ({ current: { state: 'ok', channelName: 'lobby', canAttach: true } as ComposerAvailability }));
vi.mock('../../../hooks/useComposerAvailability', () => ({ useComposerAvailability: () => availability.current }));
const typing = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../../../hooks/useTypingEmitter', () => ({ useTypingEmitter: () => ({ handleKeyPress: typing.start, sendTypingStop: typing.stop }) }));
vi.mock('../../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: () => ({
    data: [
      { user: { id: 'u-alice', username: 'alice', displayName: 'Alice' } },
      { user: { id: 'u-alan', username: 'alan', displayName: 'Alan' } },
    ],
    isLoading: false,
  }),
}));
const touch = vi.hoisted(() => ({ current: false }));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => touch.current }));

function setup({ replyTo = null as Message | null } = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(aliasGroupsControllerGetCommunityAliasGroupsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(channelsControllerGetMentionableChannelsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(customEmojiControllerListCommunityEmojisQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'u-aiko' } }), { id: 'u-aiko', username: 'aiko', displayName: 'Aiko' });
  const onCancelReply = vi.fn();
  const inputRef = createRef<HTMLTextAreaElement>();
  const view = renderWithProviders(
    <FileCacheProvider>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <ChatComposer communityId="c-1" channelId="ch-1" me="me" inputRef={inputRef} replyTo={replyTo} onCancelReply={onCancelReply} />
      </KitProvider>
    </FileCacheProvider>,
    { queryClient },
  );
  const field = () => screen.getByRole('textbox', { name: 'Message #lobby' }) as HTMLTextAreaElement;
  return { ...view, field, onCancelReply, inputRef };
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('ChatComposer', () => {
  beforeEach(() => {
    sendSpy.mockClear();
    acks.waiting.length = 0;
    typing.start.mockClear();
    typing.stop.mockClear();
    touch.current = false;
    availability.current = { state: 'ok', channelName: 'lobby', canAttach: true };
    clearComposerDrafts();
  });

  it('Enter sends the trimmed text as spans, says typing stopped and clears the field', async () => {
    const { user, field, inputRef } = setup();
    expect(inputRef.current).toBe(field());
    await user.type(field(), '  hello there ');
    expect(typing.start).toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    expect(sendSpy).toHaveBeenCalledWith('hello there', [{ type: SpanType.PLAINTEXT, text: 'hello there' }], [], undefined);
    expect(field().value).toBe('');
    // Typing stops once the server has the message.
    await act(async () => acks.answer());
    expect(typing.stop).toHaveBeenCalled();
  });

  it('the field clears as soon as the send is under way; what is typed while it waits is never touched', async () => {
    const { user, field } = setup();
    await user.type(field(), 'on my way{Enter}');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    // The pending row is in the list: the field is empty at once, Send is busy.
    expect(field().value).toBe('');
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveAttribute('aria-busy', 'true');
    // Typing stopped with the send, before the server answered.
    expect(typing.stop).toHaveBeenCalledTimes(1);
    await user.type(field(), 'next one');
    await act(async () => acks.answer());
    // The answer does not stop the typing of the next message.
    expect(typing.stop).toHaveBeenCalledTimes(1);
    expect(field().value).toBe('next one');
    expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveAttribute('aria-busy');
  });

  it('a refused send leaves the field alone (the failed row offers Retry) and says it failed', async () => {
    const { user, field } = setup();
    await user.type(field(), 'on my way{Enter}');
    await user.type(field(), 'still typing');
    await act(async () => acks.refuse());
    expect(field().value).toBe('still typing');
    expect(await screen.findByText('Failed to send message. Please try again.')).toBeInTheDocument();
  });

  it('Enter while an input method composes never sends (the IME guard of useComposerKeys)', async () => {
    const { user, field } = setup();
    await user.type(field(), 'konnichiwa');
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(field().value).toBe('konnichiwa');
  });

  it('on touch Enter is a new line; Send sends', async () => {
    touch.current = true;
    const { user, field } = setup();
    await user.type(field(), 'one{Enter}two');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(field().value).toBe('one\ntwo');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
  });

  it('a reply shows its banner; Escape cancels it; a send carries the reply’s id', async () => {
    const replyTo = createMessage({ id: 'm-9', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'the original' }] });
    const { user, field, onCancelReply } = setup({ replyTo });
    expect(screen.getByText('Replying to Aiko')).toBeInTheDocument();
    expect(screen.getByText('the original')).toBeInTheDocument();
    field().focus();
    await user.keyboard('{Escape}');
    expect(onCancelReply).toHaveBeenCalledTimes(1);
    await user.type(field(), 'agreed{Enter}');
    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith('agreed', expect.any(Array), [], 'm-9'));
  });

  it('typing @ opens the mention list as the field’s combobox; ↓ and Enter insert the mention', async () => {
    const { user, field } = setup();
    await user.type(field(), 'hi @al');
    const list = await screen.findByRole('listbox', { name: 'Mention suggestions' });
    const options = screen.getAllByRole('option');
    expect(field()).toHaveAttribute('aria-autocomplete', 'list');
    expect(field()).toHaveAttribute('aria-controls', list.id);
    expect(field()).toHaveAttribute('aria-activedescendant', options[0].id);
    await user.keyboard('{ArrowDown}');
    const highlighted = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;
    expect(field()).toHaveAttribute('aria-activedescendant', highlighted.id);
    const name = highlighted.textContent?.startsWith('alan') ? 'alan' : 'alice';
    await user.keyboard('{Enter}');
    expect(field().value).toBe(`hi @${name} `);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });

  it("a person in the mention list wears personColour(their id)", async () => {
    const { user, field } = setup();
    await user.type(field(), 'hi @al');
    await screen.findByRole('listbox', { name: 'Mention suggestions' });
    const faces = screen.getAllByText('AL');
    const colours = faces.map((face) => getComputedStyle(face).backgroundColor);
    expect(colours).toEqual(expect.arrayContaining([hexToRgb(personColour('u-alice')!), hexToRgb(personColour('u-alan')!)]));
  });

  it('a mention picked by a tap after moving the caret goes in at the caret', async () => {
    const { user, field } = setup();
    await user.type(field(), 'hi there');
    await user.keyboard('{ArrowLeft>5/}');
    await user.keyboard('@alan');
    const option = await screen.findByRole('option', { name: /alan/ });
    await user.click(option);
    expect(field().value).toBe('hi @alan there');
    expect(field()).toHaveFocus();
  });

  it('picked files queue in the tray with Remove; a file over the limit is refused with a toast', async () => {
    const { user, field } = setup();
    const input = screen.getByTestId('chat-composer-file-input') as HTMLInputElement;
    const pick = (files: File[]) => fireEvent.change(input, { target: { files } });
    pick([new File(['a'], 'notes.txt', { type: 'text/plain' }), new File(['b'], 'plan.pdf', { type: 'application/pdf' })]);
    expect(screen.getByRole('group', { name: /^notes\.txt/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    expect(screen.queryByRole('group', { name: /^notes\.txt/ })).toBeNull();
    // Only files to send: Send is available.
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith('', expect.any(Array), [expect.objectContaining({ name: 'plan.pdf' })], undefined));
    expect(field().value).toBe('');

    const huge = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 * 1024 });
    pick([huge]);
    expect(await screen.findByText(/File "huge.zip" exceeds/)).toBeInTheDocument();
  });

  it.each([
    [{ state: 'no-permission', channelName: 'lobby' }, "You can't send messages in #lobby"],
    [{ state: 'timed-out', remainingMs: 4 * 60_000, reason: 'spam' }, 'Timed out, 4 min left Reason: spam'],
    [{ state: 'read-only', channelName: 'news', postingRoleNames: ['Moderator', 'Admin'] }, '#news is read-only. Only Moderator and Admin can post.'],
  ] as const)('a notice replaces the field: %o', (state, text) => {
    availability.current = state as ComposerAvailability;
    setup();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('attaching turned off: the button reads as unavailable and opens no picker', async () => {
    availability.current = { state: 'ok', channelName: 'lobby', canAttach: false };
    const { user } = setup();
    const attach = screen.getByRole('button', { name: 'Attach a file' });
    expect(attach).toHaveAttribute('aria-disabled', 'true');
    const input = screen.getByTestId('chat-composer-file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(attach);
    expect(click).not.toHaveBeenCalled();
  });
});
