/**
 * The new shell chat's write side (PR 10c-2a), on a faked conversation: a message's actions Sheet (who sees what,
 * quick reactions, Delete behind the confirmation, focus back to the row), editing in place, Retry and Delete on a
 * failed send, Escape from the list to the composer, and that typing in the composer re-renders no row.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { forgetVoiceChannels, knownVoiceChannels } from '../../../shell/voiceChannelMemory';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChannelChat } from '../../../shell/lounge/screens/chat/ChannelChat';
import { LoungeLinksContext } from '../../../shell/lounge/links';
import { FIXTURE_LINKS } from '../../../shell/lounge/screens/fixtureLinks';
import { mockViewport, WIDTH } from '../../kit/layout/matchMedia';
import { getLastChannelId } from '../../../utils/lastChannel';
import { NO_SCREEN_CHROME, ScreenChromeContext } from '../../../shell/lounge/screen';
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

// The API client against MSW (the channel list's pending and failed cases are served per test).
vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
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
// Touch-first by default: a message's actions are the Sheet (the Menu has its own tests, `touch.current = false`).
const touch = vi.hoisted(() => ({ current: true }));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => touch.current }));

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

/** The community's channel list as the screen finds it: the channel's type, missing from it, loading, or failed. */
type ListState = 'TEXT' | 'VOICE' | 'missing' | 'pending' | 'error' | 'forbidden' | 'notFound';

let activeClient: ReturnType<typeof createTestQueryClient> | undefined;
beforeEach(() => {
  touch.current = true;
});

// A request still in flight when the test ends would be aborted after MSW answered it (an unhandled InterceptorError).
afterEach(async () => {
  await activeClient?.cancelQueries();
  activeClient?.clear();
  activeClient = undefined;
});

const keyboardFocus = vi.hoisted(() => ({ value: true }));
// jsdom does not tell a keyboard focus from a mouse press (`:focus-visible`): the helper that asks is faked per test.
vi.mock('../../../shell/lounge/screens/chat/focusRules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shell/lounge/screens/chat/focusRules')>()),
  hasKeyboardFocus: () => keyboardFocus.value,
}));
/** Focuses its first link or button as it mounts (what a press, or an opened layer, did before the entry's frame). */
function FocusOnMount({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => ref.current?.querySelector<HTMLElement>('a, button')?.focus(), []);
  return <span ref={ref} style={{ display: 'contents' }}>{children}</span>;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function setup(
  messages: Message[],
  list: ListState = 'TEXT',
  isPrivate = false,
  options: { extra?: React.ReactNode; entry?: string; conversation?: Partial<Conversation> } = {},
) {
  conversation.current = { ...makeConversation(messages), ...options.conversation };
  const queryClient = createTestQueryClient();
  activeClient = queryClient;
  // The channel capabilities are not what these tests are about: serve them as an error (the screen fails open), so the
  // request is answered by MSW and never reaches the network.
  server.use(http.get('*/api/channels/community/c-1/permissions/me', () => HttpResponse.json({ statusCode: 500 }, { status: 500 })));
  if (list === 'TEXT' || list === 'VOICE' || list === 'missing') {
    queryClient.setQueryData(
      channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }),
      list === 'missing' ? [] : [createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1', type: list, isPrivate })],
    );
  } else {
    server.use(
      http.get('*/api/channels/community/c-1', () =>
        list === 'pending'
          ? new Promise<never>(() => undefined)
          : HttpResponse.json({ statusCode: list === 'forbidden' ? 403 : list === 'notFound' ? 404 : 500 }, { status: list === 'forbidden' ? 403 : list === 'notFound' ? 404 : 500 }),
      ),
    );
  }
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
          <ScreenChromeContext value={{ ...NO_SCREEN_CHROME, rightOpen: false, setRightOpen: () => undefined }}>
            {options.extra}
            <ChannelChat params={{ communityId: 'c-1', channelId: 'ch-1' }} />
          </ScreenChromeContext>
        </LoungeLinksContext>
      </KitProvider>
    </FileCacheProvider>
  );
  const view = renderWithProviders(ui(), { queryClient, routerProps: { initialEntries: [options.entry ?? '/__lounge/community/c-1/channel/ch-1'] } });
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
const QUICK = ['React with thumbs up', 'React with heart', 'React with laughing', 'React with surprised', 'React with sad', 'React with party', 'More reactions'];

async function openActionsWithEnter(text: string) {
  const row = rowOf(text);
  act(() => row.focus());
  fireEvent.keyDown(row, { key: 'Enter' });
  return screen.findByRole('dialog');
}

describe('ChannelChat writes only to a channel known to be a text channel (I1)', () => {
  // Built for a phone (Back).
  beforeEach(() => mockViewport(WIDTH.phone));

  afterEach(() => forgetVoiceChannels());

  it('TEXT: the composer, reactions and the actions sheet', async () => {
    setup([theirs()], 'TEXT');
    expect(composerField()).toBeInTheDocument();
    expect(await openActionsWithEnter('their words')).toBeInTheDocument();
  });

  it('the list still loading: skeleton rows with Back, no conversation, no composer', () => {
    setup([theirs()], 'pending');
    expect(screen.getByText('Loading messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the community' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('the list failed: the load-error state with Try again (asks again), no composer', async () => {
    setup([theirs()], 'error');
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 });
    expect(screen.getByRole('heading', { name: "Couldn't load the channel" })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    let asked = 0;
    server.use(
      http.get('*/api/channels/community/c-1', () => {
        asked += 1;
        return HttpResponse.json([createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1' })]);
      }),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(asked).toBe(1));
    expect(await screen.findByRole('textbox', { name: 'Message #lobby' })).toBeInTheDocument();
  });

  it.each([
    ['forbidden', "You don't have access to this channel"],
    ['notFound', 'Channel not found'],
  ] as const)('the list answering %s: the messages error face with Go to the community, no Try again', async (list, title) => {
    setup([theirs()], list);
    expect(await screen.findByRole('heading', { name: title }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the community' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('heading', { name: "Couldn't load the channel" })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('VOICE: a plain "Voice channel" state with Back, no chat; the chat notes the id for the shell', () => {
    setup([theirs()], 'VOICE');
    expect(screen.getByRole('heading', { level: 1, name: 'lobby' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Voice channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the community' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the community' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(knownVoiceChannels().has('ch-1')).toBe(true);
  });

  it('a private voice channel keeps the lock in its header; a public one and an unknown one (loading) show none', () => {
    const first = setup([theirs()], 'VOICE', true);
    expect(screen.getByRole('heading', { name: 'Voice channel' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Private channel' })).toBeInTheDocument();
    first.unmount();
    const second = setup([theirs()], 'VOICE', false);
    expect(screen.queryByRole('img', { name: 'Private channel' })).toBeNull();
    second.unmount();
    setup([theirs()], 'pending');
    expect(screen.getByText('Loading messages')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Private channel' })).toBeNull();
  });

  it('a channel missing from the list (no access, deleted): reads without a composer, actions or reactions', () => {
    setup([theirs()], 'missing');
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    const row = rowOf('their words');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a channel missing from the list: reaction chips are read-only, a press sends nothing', () => {
    const withReaction = createMessage({
      id: 'm-r',
      authorId: 'u-aiko',
      spans: [{ type: SpanType.PLAINTEXT, text: 'their words' }],
      reactions: [{ emoji: '👍', userIds: ['u-aiko'] }],
    });
    setup([withReaction], 'missing');
    const chip = within(rowOf('their words')).getByRole('button', { name: /reaction, 1/ });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(chip);
    expect(actions.react).not.toHaveBeenCalled();
  });
});

describe('ChannelChat write side', () => {
  beforeEach(() => {
    // Built for a phone (Back); the wider widths have their own cases.
    mockViewport(WIDTH.phone);
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
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Reply in thread', 'Edit message', 'Copy message content', 'Delete message']);
  });

  it('someone else’s message: no Edit, Pin or Delete', async () => {
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Reply in thread', 'Copy message content']);
  });

  it('a moderator may pin and delete someone else’s message', async () => {
    perms.moderator = true;
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual([...QUICK, 'Reply', 'Reply in thread', 'Pin message', 'Copy message content', 'Delete message']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pin message' }));
    expect(actions.pin).toHaveBeenCalledTimes(1);
  });

  it('without the right to react there are no quick reactions', async () => {
    perms.canReact = false;
    setup([theirs()]);
    const sheet = await openActionsWithEnter('their words');
    expect(sheetActions(sheet)).toEqual(['Reply', 'Reply in thread', 'Copy message content']);
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
    const held: { view?: ReturnType<typeof setup> } = {};
    // As the real retry: the message is pending again at once, and the promise settles on the server's answer.
    retry.retry.mockImplementation(() => {
      held.view!.show([{ ...failedMsg, sendStatus: 'pending' }]);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const view = setup([failedMsg]);
    held.view = view;
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

describe('ChannelChat at wide (PR 10e)', () => {
  beforeEach(() => {
    touch.current = false;
    mockViewport(WIDTH.wide);
    resetFactoryCounter();
    vi.clearAllMocks();
    perms.moderator = false;
    perms.canReact = true;
    rowRenders.clear();
    clearComposerDrafts();
    localStorage.clear();
  });

  it('the composer takes focus on entry (B4), and there is no Back', async () => {
    setup([mine()]);
    const field = await screen.findByRole('textbox', { name: 'Message #lobby' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByRole('button', { name: 'Back to the community' })).toBeNull();
  });

  describe('B4: what the entry focus leaves alone', () => {
    it('keyboard focus on a left-island link keeps its place', async () => {
      keyboardFocus.value = true;
      setup([mine()], 'TEXT', false, { extra: <nav><FocusOnMount><a href="#general">general</a></FocusOnMount></nav> });
      const link = screen.getByRole('link', { name: 'general' });
      await screen.findByRole('textbox', { name: 'Message #lobby' });
      await settle();
      expect(link).toHaveFocus();
    });

    it('a mouse press on a left-island link does not: the composer takes focus', async () => {
      keyboardFocus.value = false;
      setup([mine()], 'TEXT', false, { extra: <nav><FocusOnMount><a href="#general">general</a></FocusOnMount></nav> });
      const field = await screen.findByRole('textbox', { name: 'Message #lobby' });
      await waitFor(() => expect(field).toHaveFocus());
    });

    it('an open dialog keeps focus', async () => {
      keyboardFocus.value = false;
      setup([mine()], 'TEXT', false, {
        extra: (
          <div role="dialog" aria-label="Settings">
            <FocusOnMount>
              <button type="button">in dialog</button>
            </FocusOnMount>
          </div>
        ),
      });
      const inside = screen.getByRole('button', { name: 'in dialog' });
      await screen.findByRole('textbox', { name: 'Message #lobby' });
      await settle();
      expect(inside).toHaveFocus();
    });

    it('an open menu (the header’s More) keeps focus', async () => {
      keyboardFocus.value = false;
      setup([mine()], 'TEXT', false, { extra: <FocusOnMount><button type="button" role="menuitem">a menu item</button></FocusOnMount> });
      const item = screen.getByRole('menuitem', { name: 'a menu item' });
      await screen.findByRole('textbox', { name: 'Message #lobby' });
      await settle();
      expect(item).toHaveFocus();
    });

    it('a thread open with the chat leaves focus alone', async () => {
      setup([mine()], 'TEXT', false, { entry: '/__lounge/community/c-1/channel/ch-1?thread=m-mine' });
      await screen.findByRole('textbox', { name: 'Message #lobby' });
      await settle();
      expect(composerField()).not.toHaveFocus();
    });

    it('a resize into wide after the entry at compact does not take focus', async () => {
      const viewport = mockViewport(WIDTH.compact);
      setup([mine()]);
      await screen.findByRole('textbox', { name: 'Message #lobby' });
      await settle();
      await viewport.setWidth(WIDTH.wide);
      await settle();
      expect(composerField()).not.toHaveFocus();
    });
  });

  it('the channel becomes the community’s last, so either shell opens it next', async () => {
    setup([mine()]);
    await screen.findByRole('textbox', { name: 'Message #lobby' });
    await waitFor(() => expect(getLastChannelId('me', 'c-1')).toBe('ch-1'));
  });

  it.each([
    ['cannot be read (403)', { error: Object.assign(new Error('Forbidden'), { status: 403 }) }],
    ['are gone (404)', { error: Object.assign(new Error('Not found'), { status: 404 }) }],
    ['are still loading', { isLoading: true }],
  ] as const)('a listed text channel is not remembered as the last while its messages %s', async (_, state) => {
    localStorage.clear();
    setup([], 'TEXT', false, { conversation: state });
    await screen.findByRole('heading', { name: '# lobby', level: 1 });
    await settle();
    // Else the home at compact and wide would send "Go to the community" straight back here.
    expect(getLastChannelId('me', 'c-1')).toBeNull();
  });

  it('on a phone the composer does not take focus (no keyboard raised on navigation)', async () => {
    mockViewport(WIDTH.phone);
    setup([mine()]);
    const field = await screen.findByRole('textbox', { name: 'Message #lobby' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).not.toBe(field);
  });
});

describe('ChannelChat desktop input (PR 10e: wide, with a mouse)', () => {
  beforeEach(() => {
    touch.current = false;
    mockViewport(WIDTH.wide);
    resetFactoryCounter();
    vi.clearAllMocks();
    perms.moderator = false;
    perms.canReact = true;
    clearComposerDrafts();
  });

  const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
  const openMenuWithEnter = async (text: string) => {
    const row = rowOf(text);
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    await screen.findByRole('menu');
    return row;
  };

  it('Enter on a row opens a Menu, not the Sheet, with the same actions; Escape closes it and focus is back on the row', async () => {
    setup([mine()]);
    const row = await openMenuWithEnter('my words');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu')).toHaveAccessibleName("Actions for Me's message");
    expect(menuItems()).toEqual(['Reply', 'Reply in thread', 'Add reaction', 'Edit message', 'Copy message content', 'Delete message']);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('someone else’s message: no Edit or Delete; a moderator may pin and delete it', async () => {
    setup([theirs()]);
    await openMenuWithEnter('their words');
    expect(menuItems()).toEqual(['Reply', 'Reply in thread', 'Add reaction', 'Copy message content']);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    perms.moderator = true;
    const { unmount } = setup([createMessage({ id: 'm-mod', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'moderated words' }] })]);
    await openMenuWithEnter('moderated words');
    expect(menuItems()).toEqual(['Reply', 'Reply in thread', 'Add reaction', 'Pin message', 'Copy message content', 'Delete message']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin message' }));
    expect(actions.pin).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('Delete from the Menu still asks first', async () => {
    setup([mine()]);
    await openMenuWithEnter('my words');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
    const confirm = (await screen.findByText('Delete this message?')).closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')!;
    expect(actions.del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(actions.del).toHaveBeenCalledTimes(1));
  });

  it('a right-click opens the Menu (at the pointer); a choice closes it and focus is back on the row', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    fireEvent.pointerDown(row, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    await screen.findByRole('menu');
    expect(screen.queryByRole('dialog')).toBeNull();
    const paper = screen.getByRole('menu').closest<HTMLElement>('.MuiPaper-root')!;
    expect(paper.style.top).toBe('60px');
    expect(paper.style.left).toBe('40px');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(await screen.findByText(/Replying to/)).toBeInTheDocument();
  });

  it('a right-click Menu closed with Escape returns focus to the row', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    act(() => row.focus());
    fireEvent.pointerDown(row, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    await screen.findByRole('menu');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('a second right-click away from the open cursor Menu closes it (the browser menu stays hidden)', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    fireEvent.pointerDown(row, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    await screen.findByRole('menu');
    const backdrop = document.querySelector<HTMLElement>('.MuiBackdrop-root')!;
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.contextMenu(backdrop, { clientX: 300, clientY: 300 })).toBe(false);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('Cancel on the Menu’s Delete confirm returns focus to the row, deleting nothing', async () => {
    setup([mine()]);
    const row = await openMenuWithEnter('my words');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
    const confirm = (await screen.findByText('Delete this message?')).closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')!;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete this message?')).toBeNull());
    expect(actions.del).not.toHaveBeenCalled();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('a touch long press (a touch pointer, then the context menu) on a non-touch-first device gives the Sheet', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 40, clientY: 60 });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Message from Aiko');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a touch device at wide keeps the Sheet', async () => {
    touch.current = true;
    setup([theirs()]);
    const row = rowOf('their words');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Message from Aiko');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('rows have the toolbar: Add reaction, Reply, Reply in thread and More actions, which opens the Menu', async () => {
    setup([theirs()]);
    const row = rowOf('their words');
    const toolbar = within(row).getByRole('toolbar', { hidden: true });
    const names = within(toolbar)
      .getAllByRole('button', { hidden: true })
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Add reaction', 'Reply', 'Reply in thread', 'More actions']);
    fireEvent.click(toolbar.querySelector<HTMLElement>('[aria-label="More actions"]')!);
    await screen.findByRole('menu');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('without the right to react the toolbar has no Add reaction', async () => {
    perms.canReact = false;
    setup([theirs()]);
    const toolbar = within(rowOf('their words')).getByRole('toolbar', { hidden: true });
    expect(toolbar.querySelector('[aria-label="Add reaction"]')).toBeNull();
    expect(toolbar.querySelector('[aria-label="More actions"]')).not.toBeNull();
  });

  it('touch-first rows have no toolbar', async () => {
    touch.current = true;
    setup([theirs()]);
    expect(within(rowOf('their words')).queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('a reaction says who reacted on hover', async () => {
    setup([
      createMessage({
        id: 'm-r2',
        authorId: 'u-aiko',
        spans: [{ type: SpanType.PLAINTEXT, text: 'their words' }],
        reactions: [{ emoji: '👍', userIds: ['me', 'u-aiko'] }],
      }),
    ]);
    const chip = within(rowOf('their words')).getByRole('button', { name: /reaction, 2/ });
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('You and Aiko reacted with 👍');
  });
});
