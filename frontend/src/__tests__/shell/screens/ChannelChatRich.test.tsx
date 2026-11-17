/**
 * The new shell chat's rich rows (PR 10d-A), on a faked conversation: link preview cards, a lone GIF link drawn as
 * the GIF (and its fallback), the picture viewer, video and audio that play in place only after Play, who reacted
 * (from a chip and from the actions), and a failed send that names the reader's time-out.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
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
import { createChannel, createMessage, createTestQueryClient, renderWithProviders } from '../../test-utils';
import { SpanType, type Message } from '../../../types/message.type';
import { formatClockTime } from '../../../utils/messageTime';

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
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => false }));

// Files: every fetch answers at once with a blob address named after the file (thumbnail or whole).
const files = vi.hoisted(() => ({ asked: [] as string[], fail: new Set<string>() }));
vi.mock('../../../hooks/useAuthenticatedFile', () => ({
  useAuthenticatedFile: (id: string | null, options: { fetchThumbnail?: boolean } = {}) => {
    if (id !== null) files.asked.push(`${id}${options.fetchThumbnail ? ':thumb' : ''}`);
    if (id !== null && files.fail.has(id)) return { blobUrl: null, error: new Error('nope'), isLoading: false };
    return { blobUrl: id === null ? null : `blob:${id}${options.fetchThumbnail ? '-thumb' : ''}`, error: null, isLoading: false };
  },
  useAuthenticatedImage: () => ({ blobUrl: null }),
}));
const timeout = vi.hoisted(() => ({ until: undefined as Date | undefined }));
vi.mock('../../../hooks/useChannelPermissions', () => ({ useChannelPermissions: () => ({ timedOutUntil: timeout.until }) }));

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

function setup(messages: Message[]) {
  conversation.current = makeConversation(messages);
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1', type: 'TEXT' }),
  ]);
  for (const [id, name] of [
    ['u-aiko', 'Aiko'],
    ['u-bo', 'Bo'],
    ['me', 'Me'],
  ]) {
    queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id } }), { id, username: name.toLowerCase(), displayName: name });
  }
  queryClient.setQueryData(customEmojiControllerListCommunityEmojisQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(aliasGroupsControllerGetCommunityAliasGroupsQueryKey({ path: { communityId: 'c-1' } }), []);
  queryClient.setQueryData(channelsControllerGetMentionableChannelsQueryKey({ path: { communityId: 'c-1' } }), []);
  return renderWithProviders(
    <FileCacheProvider>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <LoungeLinksContext value={FIXTURE_LINKS}>
          <ScreenChromeContext value={{ rightOpen: false, setRightOpen: () => undefined }}>
            <ChannelChat params={{ communityId: 'c-1', channelId: 'ch-1' }} />
          </ScreenChromeContext>
        </LoungeLinksContext>
      </KitProvider>
    </FileCacheProvider>,
    { queryClient, routerProps: { initialEntries: ['/__lounge/community/c-1/channel/ch-1'] } },
  );
}

const rowOf = (text: string) => screen.getAllByRole('article').find((row) => row.textContent?.includes(text))!;
const words = (text: string) => [{ type: SpanType.PLAINTEXT, text }];
const file = (id: string, filename: string, mimeType: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename,
  mimeType,
  fileType: mimeType.startsWith('image/') ? 'IMAGE' : mimeType.startsWith('video/') ? 'VIDEO' : mimeType.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT',
  size: 2048,
  hasThumbnail: false,
  width: null,
  height: null,
  ...extra,
});

describe('ChannelChat rich rows', () => {
  it('a link preview is a card: one link to the page, new tab, its pictures without a Referer', () => {
    setup([
      createMessage({
        id: 'm-1',
        authorId: 'u-aiko',
        spans: words('look https://example.com/a'),
        linkPreviews: [{ url: 'https://example.com/a', title: 'An article', siteName: 'Example', imageUrl: 'https://cdn.example.com/b.jpg' }],
      }),
    ]);
    const card = within(rowOf('look')).getByRole('link', { name: 'An article, Example, opens in a new tab' });
    expect(card).toHaveAttribute('href', 'https://example.com/a');
    expect(card.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('a lone GIF link is the GIF (no words, no card); one that fails falls back to the words and the card', () => {
    const gif = 'https://media.giphy.com/media/abc/giphy.gif';
    setup([
      createMessage({
        id: 'm-gif',
        authorId: 'u-aiko',
        spans: words(gif),
        linkPreviews: [{ url: gif, title: 'A GIF page', siteName: 'GIPHY' }],
      }),
    ]);
    const row = screen.getAllByRole('article')[0];
    const tile = within(row).getByRole('button', { name: 'Open image GIF' });
    const img = tile.querySelector('img')!;
    expect(img).toHaveAttribute('src', gif);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(within(row).queryByText(gif)).toBeNull();
    expect(within(row).queryByRole('link', { name: /A GIF page/ })).toBeNull();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(tile);
    expect(open).toHaveBeenCalledWith(gif, '_blank', 'noopener,noreferrer');
    open.mockRestore();
    fireEvent.error(img);
    expect(within(row).queryByRole('button', { name: 'Open image GIF' })).toBeNull();
    expect(within(row).getByRole('link', { name: /A GIF page/ })).toBeInTheDocument();
    expect(row.textContent).toContain('giphy.gif');
  });

  it("a picture opens the viewer at it, steps through the message's pictures, and Escape brings focus back", async () => {
    const { user } = setup([
      createMessage({
        id: 'm-pics',
        authorId: 'u-aiko',
        spans: words('pictures'),
        attachments: [file('f-1', 'one.png', 'image/png'), file('f-doc', 'notes.txt', 'text/plain'), file('f-2', 'two.png', 'image/png')] as never,
      }),
    ]);
    const second = screen.getByRole('button', { name: 'Open image two.png' });
    await user.click(second);
    const viewer = await screen.findByRole('dialog', { name: 'two.png' });
    expect(viewer).toHaveTextContent('2 of 2');
    expect(within(viewer).getByRole('img', { name: 'two.png' })).toHaveAttribute('src', 'blob:f-2');
    await user.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'one.png' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download one.png' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(second);
  });

  it('video and audio fetch nothing until Play, then play in place', async () => {
    files.asked = [];
    const { user } = setup([
      createMessage({
        id: 'm-media',
        authorId: 'u-aiko',
        spans: words('media'),
        attachments: [
          file('f-v', 'clip.mp4', 'video/mp4', { hasThumbnail: true, width: 1920, height: 1080 }),
          file('f-a', 'song.ogg', 'audio/ogg'),
        ] as never,
      }),
    ]);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(files.asked).not.toContain('f-a');
    const play = screen.getByRole('button', { name: 'Play video clip.mp4, 2 KB' });
    expect(play.querySelector('img')).toHaveAttribute('src', 'blob:f-v-thumb');
    await user.click(play);
    expect(document.querySelector('video')?.getAttribute('src')).toMatch(/\/file\/f-v$/);
    await user.click(screen.getByRole('button', { name: 'Play audio song.ogg, 2 KB' }));
    expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:f-a');
  });

  it('audio that cannot be fetched becomes its download row', async () => {
    files.fail.add('f-bad');
    const { user } = setup([
      createMessage({ id: 'm-bad', authorId: 'u-aiko', spans: words('bad'), attachments: [file('f-bad', 'bad.ogg', 'audio/ogg')] as never }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Play audio bad.ogg, 2 KB' }));
    expect(screen.getByRole('button', { name: 'Download bad.ogg, 2 KB' })).toBeInTheDocument();
    files.fail.delete('f-bad');
  });

  it('who reacted: a right-click on a chip opens its people first; the actions offer See reactions', async () => {
    setup([
      createMessage({
        id: 'm-r',
        authorId: 'u-aiko',
        spans: words('react to me'),
        reactions: [
          { emoji: '👍', userIds: ['me'] },
          { emoji: '😂', userIds: ['u-aiko', 'u-bo'] },
        ] as never,
      }),
    ]);
    const chip = screen.getByRole('button', { name: '😂 reaction, 2' });
    fireEvent.contextMenu(chip);
    const sheet = await screen.findByRole('dialog', { name: 'Reactions' });
    const groups = within(sheet).getAllByRole('region');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['😂, 2', '👍, 1']);
    expect(within(groups[0]).getByText('Aiko')).toBeInTheDocument();
    expect(within(groups[0]).getByText('Bo')).toBeInTheDocument();
    expect(within(groups[1]).getByText('Me')).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const row = rowOf('react to me');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    const actionsSheet = await screen.findByRole('dialog');
    fireEvent.click(within(actionsSheet).getByRole('button', { name: 'See reactions' }));
    expect(await screen.findByRole('dialog', { name: 'Reactions' })).toBeInTheDocument();
  });

  it("a failed send names the time-out the reader is under, else the server's reason", () => {
    timeout.until = new Date('2026-11-16T14:05:00');
    setup([createMessage({ id: 'm-f', authorId: 'me', spans: words('blocked'), sendStatus: 'failed', sendError: 'Forbidden' } as never)]);
    expect(rowOf('blocked')).toHaveTextContent(`Timed out until ${formatClockTime(timeout.until)}`);
    timeout.until = undefined;
  });
});
