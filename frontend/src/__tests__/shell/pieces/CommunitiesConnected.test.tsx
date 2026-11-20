/**
 * The connected dock and "All communities" sheet: the server's list for this user (null entries
 * skipped, server order), badges from the one unread query, live updates by firing the real socket
 * handlers on the query client, a first-load error (Inbox and All, a toast with Try again), the
 * create permission through the classic check (`/api/roles/my/instance`), the call's community, the
 * instance heading, and the remembered row for Back from the old shell.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState, type ReactNode } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, renderWithProviders } from '../../test-utils';
import { AppFrame, KitProvider } from '../../../kit';
import { VoiceProvider } from '../../../contexts/VoiceProvider';
import { VoiceActionType, useVoiceDispatch } from '../../../contexts/VoiceContext';
import { ShellDockConnected, type DockCurrent } from '../../../shell/lounge/pieces/ShellDock';
import { AllCommunitiesSheetConnected } from '../../../shell/lounge/pieces/AllCommunitiesSheet';
import { SignOutConfirmHost } from '../../../shell/lounge/pieces/signOutConfirm';
import { forgetRouteMemory, rememberedRow } from '../../../shell/routeMemory';
import { handleNewMessage, handleReadReceiptUpdated } from '../../../socket-hub/handlers/messageHandlers';
import { handleNewNotification } from '../../../socket-hub/handlers/notificationHandlers';
import { handleMemberAddedToCommunity } from '../../../socket-hub/handlers/communityHandlers';
import { userControllerGetProfileQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { NotificationType } from '../../../types/notification.type';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Sign out: the app's one sequence is tested with useLogout; here only that the sheet asks, then calls it once.
const signOut = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../data/session', () => ({ useSignOut: () => ({ signOut: signOut.fn }) }));

const BASE = 'http://localhost:3000';

/** A matchMedia answering the kit's width queries for `width` (a phone below 600). Returns the restore. */
function installWidth(width: number): () => void {
  const original = window.matchMedia;
  const min = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  window.matchMedia = ((query: string) =>
    ({
      matches: width >= min(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const COMMUNITIES = [
  { id: 'c-1', name: 'Couch Co-op', description: null, avatar: null, banner: null, createdAt: '2026-01-01T00:00:00Z' },
  null,
  { id: 'c-2', name: 'Lumen Studio', description: null, avatar: null, banner: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'c-3', name: 'Friday LAN', description: null, avatar: null, banner: null, createdAt: '2026-01-01T00:00:00Z' },
];

const COUNTS = [
  { channelId: 'ch-general', communityId: 'c-1', unreadCount: 0, mentionCount: 0 },
  { channelId: 'ch-studio', communityId: 'c-2', unreadCount: 4, mentionCount: 2 },
  { channelId: 'ch-lan', communityId: 'c-3', unreadCount: 3, mentionCount: 0 },
  { directMessageGroupId: 'dm-1', unreadCount: 5, mentionCount: 5 },
];

const CREATE_ROLE = { id: 'r-1', name: 'Member', position: 0, isDefault: true, createdAt: '2026-01-01T00:00:00Z', actions: ['CREATE_COMMUNITY'] };

function serve({
  communities = COMMUNITIES as unknown[],
  counts = COUNTS as unknown[],
  instanceActions = true,
}: { communities?: unknown[]; counts?: unknown[]; instanceActions?: boolean } = {}) {
  server.use(
    http.get(`${BASE}/api/community/mine`, () => HttpResponse.json(communities)),
    http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)),
    http.get(`${BASE}/api/roles/my/instance`, () =>
      HttpResponse.json({ resourceType: 'INSTANCE', userId: 'me', resourceId: null, roles: instanceActions ? [CREATE_ROLE] : [] }),
    ),
    http.get(`${BASE}/api/instance/settings/public`, () => HttpResponse.json({ name: 'moss.social' })),
  );
}

const voice: { dispatch?: ReturnType<typeof useVoiceDispatch>['dispatch'] } = {};
function VoiceHandle() {
  voice.dispatch = useVoiceDispatch().dispatch;
  return null;
}

function Pieces({ current }: { current: DockCurrent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ShellDockConnected current={current} onOpenAll={() => setOpen(true)} allOpen={open} />
      <AllCommunitiesSheetConnected
        open={open}
        onClose={() => setOpen(false)}
        currentId={current?.kind === 'community' ? current.id : null}
      />
    </>
  );
}

function renderPieces(current: DockCurrent = { kind: 'community', id: 'c-1' }, extra?: ReactNode) {
  const queryClient = createTestQueryClient();
  server.use(http.get(`${BASE}/api/users/profile`, () => HttpResponse.json({ id: 'me', username: 'alexk' })));
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'alexk' } as never);
  return renderWithProviders(
    <VoiceProvider>
      <VoiceHandle />
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        {/* AppFrame holds the toast region */}
        <AppFrame>
          {/* The frame's one sign-out question. */}
          <SignOutConfirmHost>
            <Pieces current={current} />
          </SignOutConfirmHost>
          {extra}
        </AppFrame>
      </KitProvider>
    </VoiceProvider>,
    { queryClient, routerProps: { initialEntries: ['/__lounge/community/c-1'] } },
  );
}

const dock = () => screen.getByRole('navigation', { name: 'Communities' });
const dockNames = () => [...dock().querySelectorAll('a, button')].map((element) => element.getAttribute('aria-label'));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  forgetRouteMemory();
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('ShellDockConnected', () => {
  it("shows the server's list in its order, skipping null entries, with the mention count, the dot and the inbox count", async () => {
    serve();
    renderPieces();
    await waitFor(() =>
      expect(dockNames()).toEqual([
        // DM unread 5 + channel mentions 2 (the DM's own mention is not counted twice: PA-6, F5)
        'Inbox, 7 unread',
        'Couch Co-op, current',
        'Lumen Studio, 2 mentions',
        'Friday LAN, new messages',
        'All communities',
      ]),
    );
  });

  it('updates live from the real socket handlers: a new message, a mention, a read receipt, a new membership', async () => {
    serve();
    const { queryClient } = renderPieces();
    await screen.findByRole('link', { name: 'Couch Co-op, current' });

    await act(async () => {
      await handleNewMessage(
        { message: { id: 'm-1', channelId: 'ch-general', directMessageGroupId: null, authorId: 'aiko' } as never },
        queryClient,
      );
    });
    expect(await screen.findByRole('link', { name: 'Couch Co-op, current, new messages' })).toBeInTheDocument();

    // The mention handler refetches the counts (#817): the server has both the message and the mention by now.
    serve({
      counts: COUNTS.map((c) => (c.channelId === 'ch-general' ? { ...c, unreadCount: 1, mentionCount: 1 } : c)),
    });
    act(() => {
      handleNewNotification(
        {
          notificationId: 'n-1',
          type: NotificationType.USER_MENTION,
          messageId: 'm-2',
          channelId: 'ch-general',
          communityId: 'c-1',
          channelName: 'general',
          directMessageGroupId: null,
          authorId: 'dropbear',
          author: { id: 'dropbear', username: 'dropbear', displayName: null, avatarUrl: null },
          message: { id: 'm-2', channelId: 'ch-general', directMessageGroupId: null, spans: [] },
          createdAt: '2026-11-15T00:00:00Z',
          read: false,
        } as never,
        queryClient,
      );
    });
    expect(await screen.findByRole('link', { name: 'Couch Co-op, current, 1 mention' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inbox, 8 unread' })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.getByRole('link', { name: 'Couch Co-op, current, 1 mention' })).toBeInTheDocument();

    act(() => {
      handleReadReceiptUpdated({ channelId: 'ch-studio', directMessageGroupId: null, lastReadMessageId: 'm-9' } as never, queryClient);
    });
    expect(await screen.findByRole('link', { name: 'Lumen Studio' })).toBeInTheDocument();

    serve({ communities: [...COMMUNITIES, { ...COMMUNITIES[0], id: 'c-4', name: 'Wavelength' }] });
    act(() => {
      handleMemberAddedToCommunity({ communityId: 'c-4' } as never, queryClient);
    });
    expect(await screen.findByRole('link', { name: 'Wavelength' })).toHaveAttribute('href', '#/community/c-4');
  });

  it('a first load that fails: Inbox and All only, and a toast that tries again', async () => {
    serve();
    server.use(http.get(`${BASE}/api/community/mine`, () => HttpResponse.json({ message: 'no' }, { status: 500 })));
    const { user } = renderPieces();
    const toast = await screen.findByText("Couldn't load your communities");
    expect(dockNames()).toEqual(['Inbox, 7 unread', 'All communities']);
    serve();
    const region = toast.closest('[role="status"], [role="alert"], [data-kit-toast]') ?? document.body;
    await user.click(within(region as HTMLElement).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Couch Co-op, current' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Couldn't load your communities")).toBeNull());
  });

  it('remembers the community chosen, so Back from its (old-shell) screen lands on its dock item', async () => {
    serve();
    const { user } = renderPieces();
    await user.click(await screen.findByRole('link', { name: 'Lumen Studio, 2 mentions' }));
    expect(rememberedRow('/__lounge/community/c-1')).toBe('dock:c-2');
  });
});

describe('AllCommunitiesSheetConnected', () => {
  it('opens from All with the instance heading, every community and its state, and Create when the instance role allows it', async () => {
    serve();
    const { user } = renderPieces();
    await user.click(await screen.findByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    expect(await within(sheet).findByText('moss.social')).toBeInTheDocument();
    expect(within(sheet).getByText('as alexk')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /^Couch Co-op/ })).toHaveAttribute('aria-current', 'page');
    expect(within(sheet).getByRole('link', { name: /^Lumen Studio/ })).toHaveTextContent('2 mentions');
    expect(within(sheet).getByRole('link', { name: /^Friday LAN/ })).toHaveTextContent('New messages');
    expect(await within(sheet).findByRole('link', { name: 'Create a community' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All communities', hidden: true })).toHaveAttribute('aria-expanded', 'true');
  });

  it('without CREATE_COMMUNITY on the instance: no Create row', async () => {
    serve({ instanceActions: false });
    const { user, queryClient } = renderPieces();
    await user.click(await screen.findByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    await within(sheet).findByRole('link', { name: /^Couch Co-op/ });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(within(sheet).queryByRole('link', { name: 'Create a community' })).toBeNull();
  });

  it("says \"You're in a call here\" on the community of the user's call", async () => {
    serve();
    const { user } = renderPieces();
    await screen.findByRole('link', { name: 'Couch Co-op, current' });
    act(() => {
      voice.dispatch!({
        type: VoiceActionType.SetConnected,
        payload: { channelId: 'v-1', channelName: 'Squad Up', communityId: 'c-3', isPrivate: false, createdAt: '2026-01-01T00:00:00Z' },
      });
    });
    await user.click(screen.getByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    expect(await within(sheet).findByRole('link', { name: /^Friday LAN/ })).toHaveTextContent("You're in a call here");
  });

  it('choosing a community closes the sheet and remembers its dock item; Escape closes it too', async () => {
    serve();
    const { user } = renderPieces();
    await user.click(await screen.findByRole('button', { name: 'All communities' }));
    let sheet = await screen.findByRole('dialog', { name: 'All communities' });
    await user.click(await within(sheet).findByRole('link', { name: /^Friday LAN/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'All communities' })).toBeNull());
    expect(rememberedRow('/__lounge/community/c-1')).toBe('dock:c-3');

    await user.click(screen.getByRole('button', { name: 'All communities' }));
    sheet = await screen.findByRole('dialog', { name: 'All communities' });
    await within(sheet).findByRole('link', { name: /^Couch Co-op/ });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'All communities' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'All communities' })).toHaveFocus());
  });

  it('on a phone, Sign out at the foot asks first: confirming signs out once, and the sheet stays under the question', async () => {
    const restore = installWidth(390);
    try {
      signOut.fn.mockClear();
      serve();
      const { user } = renderPieces();
      await user.click(await screen.findByRole('button', { name: 'All communities' }));
      const sheet = await screen.findByRole('dialog', { name: 'All communities' });
      await user.click(await within(sheet).findByRole('button', { name: 'Sign out…' }));
      const question = await screen.findByRole('dialog', { name: 'Sign out?' });
      expect(signOut.fn).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'All communities', hidden: true })).toBeInTheDocument();
      await user.click(within(question).getByRole('button', { name: 'Sign out' }));
      await waitFor(() => expect(signOut.fn).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  it('on a phone, Cancel on the sign-out question does nothing, and focus is back on the Sign out row', async () => {
    const restore = installWidth(390);
    try {
      signOut.fn.mockClear();
      serve();
      const { user } = renderPieces();
      await user.click(await screen.findByRole('button', { name: 'All communities' }));
      const sheet = await screen.findByRole('dialog', { name: 'All communities' });
      await user.click(await within(sheet).findByRole('button', { name: 'Sign out…' }));
      const question = await screen.findByRole('dialog', { name: 'Sign out?' });
      await user.click(within(question).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out?' })).toBeNull());
      expect(signOut.fn).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'All communities' })).toBeInTheDocument();
      await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Sign out…' })).toHaveFocus());
    } finally {
      restore();
    }
  });

  it('at tablet and desktop width the sheet has no Sign out (the user card has it)', async () => {
    serve();
    const { user, queryClient } = renderPieces();
    await user.click(await screen.findByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    await within(sheet).findByRole('link', { name: /^Couch Co-op/ });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(within(sheet).queryByRole('button', { name: 'Sign out…' })).toBeNull();
  });

  it('no communities: the empty state, with Create', async () => {
    serve({ communities: [] });
    const { user } = renderPieces(null);
    await waitFor(() => expect(dockNames()).toEqual(['Inbox, 7 unread', 'All communities']));
    await user.click(screen.getByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    expect(await within(sheet).findByText(/You're not in any community yet/)).toBeInTheDocument();
    expect(await within(sheet).findByRole('link', { name: 'Create a community' })).toBeInTheDocument();
  });

  it('a refresh that fails while the sheet is open raises the load pattern\'s toast; while closed it raises none', async () => {
    serve();
    const { user, queryClient } = renderPieces();
    await screen.findByRole('link', { name: 'Couch Co-op, current' });
    const refreshFailing = async () => {
      server.use(http.get(`${BASE}/api/community/mine`, () => HttpResponse.json({ message: 'no' }, { status: 500 })));
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
      });
    };
    // Closed: the failed refresh keeps the list and says nothing
    await refreshFailing();
    // (the toast and the announcer's live region both carry the text once shown)
    expect(screen.queryAllByText("Couldn't refresh. Try again.")).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Couch Co-op, current' })).toBeInTheDocument();

    serve();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
    });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await user.click(screen.getByRole('button', { name: 'All communities' }));
    const sheet = await screen.findByRole('dialog', { name: 'All communities' });
    await within(sheet).findByRole('link', { name: /^Couch Co-op/ });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    // Open: the same failure is the pattern's notify, and the rows stay
    await refreshFailing();
    expect((await screen.findAllByText("Couldn't refresh. Try again.", undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole('link', { name: /^Couch Co-op/ })).toBeInTheDocument();
  });

  it('a filter typed before the frame closes the sheet by itself is gone on the next open (M6)', async () => {
    serve({ communities: Array.from({ length: 12 }, (_, index) => ({ ...COMMUNITIES[0], id: `c-${index + 1}`, name: `Community ${index + 1}` })) });
    const tree = (open: boolean) => (
      <VoiceProvider>
        <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
          <AppFrame>
            <SignOutConfirmHost>
              <AllCommunitiesSheetConnected open={open} onClose={() => undefined} currentId={null} />
            </SignOutConfirmHost>
          </AppFrame>
        </KitProvider>
      </VoiceProvider>
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'alexk' } as never);
    const { user, rerender } = renderWithProviders(tree(true), { queryClient });
    const field = await screen.findByRole('searchbox', { name: 'Find a community' });
    await user.type(field, '12');
    rerender(tree(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true));
    expect(await screen.findByRole('searchbox', { name: 'Find a community' })).toHaveValue('');
  });
});

describe('ShellDockConnected, zero communities', () => {
  it('a user in no community whose background refetch fails sees no load error (M2)', async () => {
    serve({ communities: [] });
    const { queryClient } = renderPieces(null);
    await waitFor(() => expect(dockNames()).toEqual(['Inbox, 7 unread', 'All communities']));
    server.use(http.get(`${BASE}/api/community/mine`, () => HttpResponse.json({ message: 'no' }, { status: 500 })));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
    });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryAllByText("Couldn't load your communities")).toHaveLength(0);
    expect(dockNames()).toEqual(['Inbox, 7 unread', 'All communities']);
  });
});
