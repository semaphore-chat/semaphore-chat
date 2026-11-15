/**
 * The new shell's dock shows the same numbers as the classic app for the same cache state: one query
 * client, the classic community rail (its Direct Messages badge) and the classic channel rows (their
 * mention badges and unread marks) rendered beside the Lounge dock, compared before and after live
 * socket events.
 *
 * The rules (design PA-5, PA-6):
 * - a community's dock count = the sum of the classic mention badges of its channels;
 * - its new-messages dot = a classic unread mark on one of its channels while it has no mention;
 * - the Inbox = the classic Direct Messages badge + every classic channel mention badge.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createChannel, createTestQueryClient, renderWithProviders } from '../../test-utils';
import { AppFrame, KitProvider } from '../../../kit';
import { VoiceProvider } from '../../../contexts/VoiceProvider';
import { RoomContext } from '../../../contexts/RoomContextDef';
import { BottomChromeProvider } from '../../../contexts/BottomChromeContext';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import CommunityToggle from '../../../components/CommunityList/CommunityToggle';
import { ChannelRow } from '../../../components/Channel/ChannelRow';
import { ShellDockConnected } from '../../../shell/lounge/pieces/ShellDock';
import { handleNewMessage, handleReadReceiptUpdated } from '../../../socket-hub/handlers/messageHandlers';
import { handleNewNotification } from '../../../socket-hub/handlers/notificationHandlers';
import { userControllerGetProfileQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { NotificationType } from '../../../types/notification.type';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
// The account menu at the rail's foot is not part of the badge rule.
vi.mock('../../../components/Desktop/RailUserMenu', () => ({ RailUserMenu: () => null }));

const BASE = 'http://localhost:3000';

const CHANNELS = {
  'c-1': [createChannel({ id: 'ch-couch-general', name: 'general', type: 'TEXT', communityId: 'c-1' }), createChannel({ id: 'ch-couch-clips', name: 'clips', type: 'TEXT', communityId: 'c-1' })],
  'c-2': [createChannel({ id: 'ch-lumen-general', name: 'general', type: 'TEXT', communityId: 'c-2' }), createChannel({ id: 'ch-lumen-design', name: 'design', type: 'TEXT', communityId: 'c-2' })],
  'c-3': [createChannel({ id: 'ch-lan-lfg', name: 'lfg', type: 'TEXT', communityId: 'c-3' })],
} as const;

const NAMES = { 'c-1': 'Couch Co-op', 'c-2': 'Lumen Studio', 'c-3': 'Friday LAN' } as const;
type CommunityId = keyof typeof NAMES;
const IDS = Object.keys(NAMES) as CommunityId[];

const COUNTS = [
  { channelId: 'ch-couch-general', communityId: 'c-1', unreadCount: 0, mentionCount: 0 },
  { channelId: 'ch-couch-clips', communityId: 'c-1', unreadCount: 0, mentionCount: 0 },
  { channelId: 'ch-lumen-general', communityId: 'c-2', unreadCount: 6, mentionCount: 2 },
  { channelId: 'ch-lumen-design', communityId: 'c-2', unreadCount: 1, mentionCount: 1 },
  { channelId: 'ch-lan-lfg', communityId: 'c-3', unreadCount: 4, mentionCount: 0 },
  { directMessageGroupId: 'dm-aiko', unreadCount: 3, mentionCount: 3 },
  { directMessageGroupId: 'dm-kwam3', unreadCount: 2, mentionCount: 0 },
];

function renderBoth() {
  server.use(
    http.get(`${BASE}/api/community/mine`, () =>
      HttpResponse.json(IDS.map((id) => ({ id, name: NAMES[id], description: null, avatar: null, banner: null, createdAt: '2026-01-01T00:00:00Z' }))),
    ),
    http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(COUNTS)),
    http.get(`${BASE}/api/users/profile`, () => HttpResponse.json({ id: 'me', username: 'alexk' })),
  );
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'alexk' } as never);
  return renderWithProviders(
    <FileCacheProvider>
    <BottomChromeProvider>
      <VoiceProvider>
        <RoomContext.Provider value={{ room: null, setRoom: () => undefined, getRoom: () => null }}>
          <section aria-label="classic">
            <CommunityToggle isExpanded={false} onToggleExpanded={() => undefined} onOpenNotifications={() => undefined} voiceConnected={false} user={undefined} />
            {IDS.map((id) => (
              <ul key={id} aria-label={`classic channels of ${id}`}>
                {CHANNELS[id].map((channel) => (
                  <li key={channel.id}>
                    <ChannelRow channel={channel} communityId={id} selected={false} variant="touch" />
                  </li>
                ))}
              </ul>
            ))}
          </section>
          <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
            <AppFrame>
              <ShellDockConnected current={{ kind: 'community', id: 'c-1' }} onOpenAll={() => undefined} />
            </AppFrame>
          </KitProvider>
        </RoomContext.Provider>
      </VoiceProvider>
    </BottomChromeProvider>
    </FileCacheProvider>,
    { queryClient, routerProps: { initialEntries: ['/'] } },
  );
}

/** What the classic app shows. */
function classic() {
  const rail = screen.getByRole('button', { name: 'Direct Messages' });
  const dmBadge = Number(rail.parentElement?.querySelector('.MuiBadge-badge')?.textContent || 0);
  const perCommunity = Object.fromEntries(
    IDS.map((id) => {
      const list = screen.getByRole('list', { name: `classic channels of ${id}` });
      const mentions = within(list)
        .queryAllByTestId('mention-badge')
        .reduce((sum, badge) => sum + Number(badge.textContent), 0);
      const unreadMarks = within(list).queryAllByTestId('unread-indicator').length;
      return [id, { mentions, unreadMarks }];
    }),
  ) as Record<CommunityId, { mentions: number; unreadMarks: number }>;
  return { dmBadge, perCommunity };
}

/** What the Lounge dock shows (its accessible names carry exactly what is drawn). */
function lounge() {
  const nav = screen.getByRole('navigation', { name: 'Communities' });
  const inboxName = within(nav).getByRole('button', { name: /^Inbox/ }).getAttribute('aria-label') ?? '';
  const inbox = Number(/(\d+) unread/.exec(inboxName)?.[1] ?? 0);
  const perCommunity = Object.fromEntries(
    IDS.map((id) => {
      const item = nav.querySelector<HTMLElement>(`a[href="#/community/${id}"]`);
      const name = item?.getAttribute('aria-label') ?? '';
      return [id, { count: Number(/(\d+) mentions?/.exec(name)?.[1] ?? 0), dot: name.endsWith('new messages'), drawnDot: item?.querySelector('[data-kit-new-messages]') != null }];
    }),
  ) as Record<CommunityId, { count: number; dot: boolean; drawnDot: boolean }>;
  return { inbox, perCommunity };
}

function expectSame() {
  const old = classic();
  const now = lounge();
  for (const id of IDS) {
    expect(now.perCommunity[id].count, `${NAMES[id]} count`).toBe(old.perCommunity[id].mentions);
    const dot = old.perCommunity[id].mentions === 0 && old.perCommunity[id].unreadMarks > 0;
    expect(now.perCommunity[id].dot, `${NAMES[id]} dot`).toBe(dot);
    expect(now.perCommunity[id].drawnDot, `${NAMES[id]} drawn dot`).toBe(dot);
  }
  const allMentions = IDS.reduce((sum, id) => sum + old.perCommunity[id].mentions, 0);
  expect(now.inbox, 'Inbox').toBe(old.dmBadge + allMentions);
  return { old, now };
}

describe('dock badges against the classic app, one query client', () => {
  it('agree on the loaded counts, and after live socket events', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { queryClient } = renderBoth();
    await waitFor(() => expect(lounge().perCommunity['c-2'].count).toBe(3));
    await waitFor(() => expect(classic().perCommunity['c-2'].mentions).toBe(3));
    const first = expectSame();
    // The numbers themselves, so a rule that is wrong on both sides cannot pass
    expect(first.old.dmBadge).toBe(5);
    expect(first.now.inbox).toBe(8);
    expect(first.now.perCommunity['c-3'].dot).toBe(true);

    // A message in a quiet community, a mention in another, a read in a third
    await act(async () => {
      await handleNewMessage({ message: { id: 'm-1', channelId: 'ch-couch-clips', directMessageGroupId: null, authorId: 'pri' } as never }, queryClient);
      handleNewNotification(
        {
          notificationId: 'n-1',
          type: NotificationType.USER_MENTION,
          messageId: 'm-2',
          channelId: 'ch-lan-lfg',
          communityId: 'c-3',
          channelName: 'lfg',
          directMessageGroupId: null,
          authorId: 'kwam3',
          author: { id: 'kwam3', username: 'kwam3', displayName: null, avatarUrl: null },
          message: { id: 'm-2', channelId: 'ch-lan-lfg', directMessageGroupId: null, spans: [] },
          createdAt: '2026-11-15T00:00:00Z',
          read: false,
        } as never,
        queryClient,
      );
      handleReadReceiptUpdated({ channelId: 'ch-lumen-design', directMessageGroupId: null, lastReadMessageId: 'm-8' } as never, queryClient);
    });
    await waitFor(() => expect(lounge().perCommunity['c-3'].count).toBe(1));
    const second = expectSame();
    expect(second.now.perCommunity['c-1'].dot).toBe(true);
    expect(second.now.perCommunity['c-2'].count).toBe(2);
    expect(second.now.inbox).toBe(5 + 2 + 1);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
