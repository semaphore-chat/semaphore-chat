/**
 * The new shell chat's write side (PR 10c-2a), on a faked conversation: a message's actions Sheet (who sees what,
 * quick reactions, Delete behind the confirmation, focus back to the row), editing in place, Retry and Delete on a
 * failed send, Escape from the list to the composer, and that typing in the composer re-renders no row.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChannelChat } from '../../../shell/lounge/screens/chat/ChannelChat';
import { LoungeLinksContext } from '../../../shell/lounge/links';
import { FIXTURE_LINKS } from '../../../shell/lounge/screens/fixtureLinks';
import { ScreenChromeContext } from '../../../shell/lounge/screen';
import type { Conversation } from '../../../data/chat/useConversation';
import {
  aliasGroupsControllerGetCommunityAliasGroupsQueryKey,
  channelsControllerFindAllForCommunityQueryKey,
  channelsControllerGetMentionableChannelsQueryKey,
  customEmojiControllerListCommunityEmojisQueryKey,
  userControllerGetUserByIdQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { clearComposerDrafts } from '../../../hooks/useComposerDraft';
import { createChannel, createMessage, createTestQueryClient, renderWithProviders, resetFactoryCounter } from '../../test-utils';
import { SpanType, type Message } from '../../../types/message.type';

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined, findItemIndex: () => 0, scrollSize: 0, viewportSize: 0 }), []);
      return (
        <div role={props.role as string} aria-label={props['aria-label'] as string}>
          {props.children as React.ReactNode}
        </div>
      );
    }),
  };
});

const conversation = vi.hoisted(() => ({ current: null as unknown as Conversation }));
vi.mock('../../../data/chat/useConversation', () => ({ useConversation: () => conversation.current }));

// The shared actions, faked with the edit state they keep, so the screen's wiring can be read.
const actions = vi.hoisted(() => ({
  react: vi.fn(async (_emoji: string) => undefined),
  del: vi.fn(async () => undefined),
  pin: vi.fn(async () => undefined),
  unpin: vi.fn(async () => undefined),
  save: vi.fn((_id: string, _text: string) => undefined),
}));
vi.mock('../../../data/chat/useMessageActions', async () => {
  const ReactMod = await import('react');
  return {
    useMessageActions: (message: Message) => {
      const [isEditing, setEditing] = ReactMod.useState(false);
      const [editText, setEditText] = ReactMod.useState('');
      return {
        isEditing,
        editText,
        setEditText,
        handleEditClick: () => {
          setEditText(message.spans.map((s) => s.text ?? '').join(''));
          setEditing(true);
        },
        handleEditSave: async () => {
          actions.save(message.id, editText);
          setEditing(false);
        },
        handleEditCancel: () => setEditing(false),
        handleReactionClick: actions.react,
        deleteMessage: actions.del,
        handlePin: actions.pin,
        handleUnpin: actions.unpin,
      };
    },
  };
});
const perms = vi.hoisted(() => ({ moderator: false, canReact: true }));
vi.mock('../../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: ({ message, currentUserId }: { message: Message; currentUserId?: string }) => {
    const own = message.authorId === currentUserId;
    return {
      canEdit: own,
      canDelete: own || perms.moderator,
      canPin: perms.moderator,
      canReact: perms.canReact,
      isOwnMessage: own,
    };
  },
}));
const retry = vi.hoisted(() => ({ retry: vi.fn(), remove: vi.fn() }));
vi.mock('../../../hooks/useOptimisticSendMessage', () => ({
  retryOptimisticMessage: (_client: unknown, _send: unknown, message: Message) => retry.retry(message),
  removeOptimisticRow: (_client: unknown, message: Message) => retry.remove(message),
}));
const clipboard = vi.hoisted(() => ({ write: vi.fn(async (_text: string) => undefined) }));
vi.mock('../../../utils/clipboard', () => ({ copyToClipboard: clipboard.write }));

// The composer's outside world.
vi.mock('../../../hooks/useMessageFileUpload', () => ({ useMessageFileUpload: () => ({ handleSendMessage: vi.fn() }) }));
vi.mock('../../../hooks/useComposerAvailability', () => ({ useComposerAvailability: () => ({ state: 'ok', channelName: 'lobby', canAttach: true }) }));
vi.mock('../../../hooks/useTypingEmitter', () => ({ useTypingEmitter: () => ({ handleKeyPress: vi.fn(), sendTypingStop: vi.fn() }) }));
vi.mock('../../../hooks/useAllCommunityMembers', () => ({ useAllCommunityMembers: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => false }));

// Renders of kit rows, by author: typing in the composer must draw none.
const rowRenders = vi.hoisted(() => new Map<string, number>());
vi.mock('../../../kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../kit')>();
  const MessageRow = (props: Parameters<typeof actual.MessageRow>[0]) => {
    rowRenders.set(props.author, (rowRenders.get(props.author) ?? 0) + 1);
    return actual.MessageRow(props);
  };
  return { ...actual, MessageRow };
});

function makeConversation(orderedMessages: Message[]): Conversation {
  return {
    me: 'me',
    orderedMessages,
    isLoading: false,
    error: null,
    listRef: { current: null },
    list: {
      mode: 'normal',
      isLoadingMore: false,
      unreadCount: 0,
      lastReadIndex: -1,
      resetKey: 'ch-1',
      onAtBottomChange: () => undefined,
      onVisibleRangeChange: () => undefined,
    },
    jump: { shown: false, newCount: 0, onJump: () => undefined },
    typingUserIds: [],
    announcement: '',
  };
}

const mine = () => createMessage({ id: 'm-mine', authorId: 'me', spans: [{ type: SpanType.PLAINTEXT, text: 'my words' }] });
const theirs = () => createMessage({ id: 'm-theirs', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'their words' }] });

function setup(messages: Message[]) {
  conversation.current = makeConversation(messages);
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1' }),
  ]);
  for (const [id, name] of [
    ['u-aiko', 'Aiko'],
    ['me', 'Me'],
  ]) {
    queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id } }), { id, username: name.toLowerCase(), displayName: name });
  }
  queryClient.setQueryData(customEmojiControllerListCommunityEmojisQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(aliasGroupsControllerGetCommunityAliasGroupsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(channelsControllerGetMentionableChannelsQueryKey({ path: { communityId: 'c-1' } }), []);
  const ui = () => (
    <FileCacheProvider>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <LoungeLinksContext value={FIXTURE_LINKS}>
          <ScreenChromeContext value={{ rightOpen: false, setRightOpen: () => undefined }}>
            <ChannelChat params={{ communityId: 'c-1', channelId: 'ch-1' }} />
          </ScreenChromeContext>
        </LoungeLinksContext>
      </KitProvider>
    </FileCacheProvider>
  );
  const view = renderWithProviders(ui(), { queryClient, routerProps: { initialEntries: ['/__lounge/community/c-1/channel/ch-1'] } });
  /** Shows `next` as the conversation (a status change, a row leaving and coming back). */
  const show = (next: Message[]) => {
    conversation.current = makeConversation(next);
    view.rerender(ui());
  };
  return { ...view, show };
}

const rowOf = (text: string) => screen.getAllByRole('article').find((row) => row.textContent?.includes(text))!;
const composerField = () => screen.getByRole('textbox', { name: 'Message #lobby' });
const sheetActions = (sheet: HTMLElement) =>
  within(sheet)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    .filter((name) => name !== 'Close');
const QUICK = ['React with thumbs up', 'React with heart', 'React with laughing', 'React with surprised', 'React with sad', 'React with party'];

async function openActionsWithEnter(text: string) {
  const row = rowOf(text);
  act(() => row.focus());
  fireEvent.keyDown(row, { key: 'Enter' });
  return screen.findByRole('dialog');
}

describe('ChannelChat write side', () => {
  beforeEach(() => {
    resetFactoryCounter();
    vi.clearAllMocks();
    perms.moderator = false;
    perms.canReact = true;
    rowRenders.clear();
    clearComposerDrafts();
  });

  it('Enter on your own message opens its actions: quick reactions, Reply, Edit, Copy, Delete', async () => {
    setup([mine()]);
    const sheet = await openActionsWithEnter('my words');
    expect(sheet).toHaveAccessibleName('Message from Me');
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Edit message', 'Copy message content', 'Delete message']);
  });

  it('someone else’s message: no Edit, Pin or Delete', async () => {
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Copy message content']);
  });

  it('a moderator may pin and delete someone else’s message', async () => {
    perms.moderator = true;
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Pin message', 'Copy message content', 'Delete message']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pin message' }));
    expect(actions.pin).toHaveBeenCalledTimes(1);
  });

  it('without the right to react there are no quick reactions', async () => {
    perms.canReact = false;
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual(['Reply', 'Copy message content']);
  });

  it('a right-click opens the actions too; a quick reaction toggles it and closes the sheet, focus back on the row', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    fireEvent.pointerDown(row, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'React with party' }));
    expect(actions.react).toHaveBeenCalledWith('🎉');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowOf('their words')).toHaveFocus());
  });

  it('Delete asks first, and deletes only when confirmed', async () => {
    setup([mine()]);
    const sheet = await openActionsWithEnter('my words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete message' }));
    const confirm = (await screen.findByText('Delete this message?')).closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')!;
    expect(actions.del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(actions.del).toHaveBeenCalledTimes(1));
  });

  it('Edit opens the editor in the row; Escape leaves it unchanged, Enter saves', async () => {
    setup([mine()]);
    let sheet = await openActionsWithEnter('my words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit message' }));
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    expect(editor).toHaveValue('my words');
    await waitFor(() => expect(editor).toHaveFocus());
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull());
    expect(actions.save).not.toHaveBeenCalled();
    await waitFor(() => expect(rowOf('my words')).toHaveFocus());

    sheet = await openActionsWithEnter('my words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit message' }));
    const again = await screen.findByRole('textbox', { name: 'Edit message' });
    fireEvent.change(again, { target: { value: 'better words' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith('m-mine', 'better words'));
  });

  it('Reply puts the reply banner on the composer and moves focus to it', async () => {
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reply' }));
    expect(await screen.findByText('Replying to Aiko')).toBeInTheDocument();
    await waitFor(() => expect(composerField()).toHaveFocus());
  });

  it('Retry keeps focus and shows busy while the message goes failed → pending → sent; then focus is on the row', async () => {
    const failedMsg = createMessage({ id: 'pending-1', clientId: 'pending-1', authorId: 'me', sendStatus: 'failed', spans: [{ type: SpanType.PLAINTEXT, text: 'lost words' }] });
    let finish: () => void = () => undefined;
    let view: ReturnType<typeof setup>;
    // As the real retry: the message is pending again at once, and the promise settles on the server's answer.
    retry.retry.mockImplementation(() => {
      view.show([{ ...failedMsg, sendStatus: 'pending' }]);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    view = setup([failedMsg]);
    const button = within(rowOf('lost words')).getByRole('button', { name: 'Retry' });
    act(() => button.focus());
    fireEvent.click(button);
    expect(retry.retry).toHaveBeenCalledTimes(1);
    // The same button, still focused, busy.
    const busy = within(rowOf('lost words')).getByRole('button', { name: 'Retry' });
    expect(busy).toBe(button);
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // Sent: Retry goes, focus goes to the row (the same element as before).
    const row = rowOf('lost words');
    await act(async () => {
      view.show([{ ...failedMsg, sendStatus: undefined }]);
      finish();
    });
    expect(within(rowOf('lost words')).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(rowOf('lost words')).toBe(row);
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('a failed send’s Delete removes it', () => {
    const failedMsg = createMessage({ id: 'pending-2', authorId: 'me', sendStatus: 'failed', spans: [{ type: SpanType.PLAINTEXT, text: 'lost words' }] });
    setup([failedMsg]);
    fireEvent.click(within(rowOf('lost words')).getByRole('button', { name: 'Delete' }));
    expect(retry.remove).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'failed'] as const)('a %s message offers only Copy', async (sendStatus) => {
    perms.moderator = true;
    setup([createMessage({ id: `pending-${sendStatus}`, authorId: 'me', sendStatus, spans: [{ type: SpanType.PLAINTEXT, text: 'on its way' }] })]);
    const sheet = await openActionsWithEnter('on its way');
    expect(sheetActions(sheet)).toEqual(['Copy message content']);
  });

  it('Copy says it copied only when the clipboard took it, and says so when it did not', async () => {
    setup([theirs()]);
    let sheet = await openActionsWithEnter('their words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy message content' }));
    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith('their words'));
    expect(screen.queryByText("Couldn't copy the message")).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    clipboard.write.mockRejectedValueOnce(new TypeError('no clipboard'));
    sheet = await openActionsWithEnter('their words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy message content' }));
    expect(await screen.findByText("Couldn't copy the message")).toBeInTheDocument();
  });

  it('while an input method composes, Escape does not cancel an edit and Enter does not save it', async () => {
    setup([mine()]);
    const sheet = await openActionsWithEnter('my words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit message' }));
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(editor, { key: 'Escape', keyCode: 229 });
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 });
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('an edit whose row leaves the list and comes back keeps its text and does not take focus again', async () => {
    const own = mine();
    const other = theirs();
    const { show } = setup([own, other]);
    const sheet = await openActionsWithEnter('my words');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit message' }));
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    await waitFor(() => expect(editor).toHaveFocus());
    fireEvent.change(editor, { target: { value: 'half-typed change' } });
    act(() => composerField().focus());
    // The row leaves the render window and comes back.
    show([other]);
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    show([own, other]);
    const back = await screen.findByRole('textbox', { name: 'Edit message' });
    await waitFor(() => expect(back).toHaveValue('half-typed change'));
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(composerField()).toHaveFocus();
  });

  it('Escape on a row moves focus to the composer’s field', () => {
    setup([theirs()]);
    const row = rowOf('their words');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(composerField()).toHaveFocus();
  });

  it('typing in the composer re-renders no row', async () => {
    const { user } = setup([mine(), theirs()]);
    expect(rowRenders.get('Aiko')).toBeGreaterThan(0);
    // Let the first render's own updates settle.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    rowRenders.clear();
    await user.type(composerField(), 'hello there');
    expect(Object.fromEntries(rowRenders)).toEqual({});
  });
});
