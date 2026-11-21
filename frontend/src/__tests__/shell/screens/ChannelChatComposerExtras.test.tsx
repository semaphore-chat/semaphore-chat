/**
 * The new shell chat's composer extras (PR 10d-C), on a faked conversation: the emoji picker inserts at the caret,
 * More reactions reacts through the same picker, a GIF pick sends at once, a pasted or dropped file goes to the
 * tray, ↑ in the empty field edits the reader's last message, and an edit in place shows Discord's hint.
 * (The setup is ChannelChatWrite.test.tsx's.)
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { forgetVoiceChannels } from '../../../shell/voiceChannelMemory';
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
  instanceControllerGetPublicSettingsQueryKey,
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
const sent = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('../../../hooks/useMessageFileUpload', () => ({ useMessageFileUpload: () => ({ handleSendMessage: sent.send }) }));
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

/** The community's channel list as the screen finds it: the channel's type, missing from it, loading, or failed. */
type ListState = 'TEXT' | 'VOICE' | 'missing' | 'pending' | 'error' | 'forbidden' | 'notFound';

let activeClient: ReturnType<typeof createTestQueryClient> | undefined;
// A request still in flight when the test ends would be aborted after MSW answered it (an unhandled InterceptorError).
afterEach(async () => {
  await activeClient?.cancelQueries();
  activeClient?.clear();
  activeClient = undefined;
});

function setup(messages: Message[], list: ListState = 'TEXT', isPrivate = false, gifs = true) {
  conversation.current = makeConversation(messages);
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
  queryClient.setQueryData(instanceControllerGetPublicSettingsQueryKey(), { gifSearchEnabled: gifs } as never);
  server.use(http.get('*/api/instance/settings/public', () => HttpResponse.json({ gifSearchEnabled: gifs })));
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

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message #lobby' });
const GIF = { id: 'g1', title: 'cat typing', url: 'https://media.tenor.com/cat.gif', previewUrl: 'https://media.tenor.com/cat-s.gif', mediumUrl: 'https://media.tenor.com/cat-m.gif', width: 200, height: 150 };

beforeEach(() => {
  resetFactoryCounter();
  clearComposerDrafts();
  rowRenders.clear();
  vi.clearAllMocks();
  forgetVoiceChannels();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});

describe('ChannelChat composer extras', () => {
  it('the emoji picker inserts at the caret, closes and gives the field its focus back', async () => {
    const { user } = setup([theirs()]);
    await user.type(field(), 'ab');
    field().setSelectionRange(1, 1);
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add emoji' });
    // A keyboard reader goes straight to the search.
    await waitFor(() => expect(within(sheet).getByRole('searchbox', { name: 'Search emoji' })).toHaveFocus());
    await user.keyboard('fire');
    await user.click(within(sheet).getAllByRole('button', { name: 'fire' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add emoji' })).toBeNull());
    expect(field()).toHaveValue('a🔥b');
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field().selectionStart).toBe(1 + '🔥'.length);
  });

  it('says so when no emoji matches, and keeps what was picked as recently used', async () => {
    const { user } = setup([theirs()]);
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add emoji' });
    await user.type(within(sheet).getByRole('searchbox', { name: 'Search emoji' }), 'zzzz');
    expect(within(sheet).getByText('No emoji found')).toBeInTheDocument();
    await user.clear(within(sheet).getByRole('searchbox', { name: 'Search emoji' }));
    await user.click(within(sheet).getAllByRole('button', { name: 'party' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));
    const again = await screen.findByRole('dialog', { name: 'Add emoji' });
    expect(within(within(again).getByRole('group', { name: 'Recently used' })).getByRole('button', { name: 'party' })).toBeInTheDocument();
  });

  it('More reactions opens the picker on the message and reacts with the pick; focus returns to the row', async () => {
    const { user } = setup([theirs()]);
    const row = rowOf('their words');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    const actionsSheet = await screen.findByRole('dialog');
    await user.click(within(actionsSheet).getByRole('button', { name: 'More reactions' }));
    const picker = await screen.findByRole('dialog', { name: 'Add reaction' });
    await user.type(within(picker).getByRole('searchbox', { name: 'Search emoji' }), 'fire');
    await user.click(within(picker).getAllByRole('button', { name: 'fire' })[0]);
    await waitFor(() => expect(actions.react).toHaveBeenCalledWith('🔥'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('a GIF pick sends its medium rendition at once, leaving the draft alone', async () => {
    server.use(http.get('*/api/gifs/featured', () => HttpResponse.json({ results: [GIF], next: '' })));
    const { user } = setup([theirs()]);
    await user.type(field(), 'half typed');
    await user.click(screen.getByRole('button', { name: 'Send a GIF' }));
    const sheet = await screen.findByRole('dialog', { name: 'GIFs' });
    await user.click(await within(sheet).findByRole('button', { name: 'cat typing' }));
    await waitFor(() => expect(sent.send).toHaveBeenCalledWith(GIF.mediumUrl, [{ type: SpanType.PLAINTEXT, text: GIF.mediumUrl }], [], undefined));
    expect(field()).toHaveValue('half typed');
  });

  it('the GIF picker says when GIF search fails, with Try again', async () => {
    server.use(http.get('*/api/gifs/featured', () => HttpResponse.json({ statusCode: 503 }, { status: 503 })));
    const { user } = setup([theirs()]);
    await user.click(screen.getByRole('button', { name: 'Send a GIF' }));
    const sheet = await screen.findByRole('dialog', { name: 'GIFs' });
    expect(await within(sheet).findByText("Couldn't load GIFs", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers no GIF button when the server has GIF search off', () => {
    setup([theirs()], 'TEXT', false, false);
    expect(screen.queryByRole('button', { name: 'Send a GIF' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeInTheDocument();
  });

  it('a pasted picture goes to the tray', async () => {
    setup([theirs()]);
    const picture = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(field(), { clipboardData: { items: [{ kind: 'file', getAsFile: () => picture }] } });
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
  });

  it('files dropped on the conversation go to the tray, with the drop look while dragging', async () => {
    setup([theirs()]);
    const pane = field().closest('[data-chat-pane-drop]') as HTMLElement;
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.dragEnter(pane, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByText('Drop files to attach them')).toBeInTheDocument();
    fireEvent.drop(pane, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.queryByText('Drop files to attach them')).toBeNull();
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
  });

  it('↑ in the empty field edits the last message of mine, with the hint in place of a Save button', async () => {
    const { user } = setup([mine(), theirs()]);
    field().focus();
    await user.keyboard('{ArrowUp}');
    const editor = await screen.findByRole('textbox', { name: 'Edit message' });
    expect(editor).toHaveValue('my words');
    const row = rowOf('my words');
    expect(within(row).getByText('escape to')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Save changes' })).toHaveTextContent('save');
    await user.click(within(row).getByRole('button', { name: 'Cancel editing' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull());
  });

  it('↑ with words in the field moves the caret as usual, edits nothing', async () => {
    const { user } = setup([mine()]);
    await user.type(field(), 'draft');
    await user.keyboard('{ArrowUp}');
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });
});
