/**
 * Render counts for the community left island (review I5): channel rows and voice room cards are memoised, so an
 * unread change re-renders the one row it touched, a presence event no channel row, and a speaking change in your
 * room only that room's card. Real data hooks (useCommunityPresence included) on MSW, the real socket handlers; the
 * kit's ListRow and AvatarStack are wrapped to count renders (by channel name / first person).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, createChannel } from '../../test-utils';
import { createTestHubWrapper } from '../../test-utils/wrappers';
import { createEventBus } from '../../../socket-hub/emitter';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const counts = vi.hoisted(() => ({ rows: new Map<string, number>(), stacks: new Map<string, number>() }));
vi.mock('../../../kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../kit')>();
  const { createElement } = await import('react');
  return {
    ...kit,
    ListRow: (props: Parameters<typeof kit.ListRow>[0]) => {
      counts.rows.set(props.primary, (counts.rows.get(props.primary) ?? 0) + 1);
      return createElement(kit.ListRow, props);
    },
    AvatarStack: (props: Parameters<typeof kit.AvatarStack>[0]) => {
      const key = props.people[0]?.name ?? '';
      counts.stacks.set(key, (counts.stacks.get(key) ?? 0) + 1);
      return createElement(kit.AvatarStack, props);
    },
  };
});

// The actions are stable, as the voice context's are.
const voice = vi.hoisted(() => ({ state: {} as Record<string, unknown>, actions: { joinVoiceChannel: () => Promise.resolve(), leaveVoiceChannel: () => undefined } }));
vi.mock('../../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: voice.state, actions: voice.actions }),
}));
vi.mock('../../../data/callBar', () => ({ useCallBarModel: () => null }));
vi.mock('../../../data/voiceNotice', () => ({ useVoiceNotice: () => null }));
vi.mock('../../../features/roles/useUserPermissions', () => ({ useCanPerformAction: () => false }));
vi.mock('../../../hooks/useChannelPermissions', () => ({ useChannelPermissions: () => ({ can: () => true }) }));
vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u-alexk', username: 'alexk', displayName: null, avatarUrl: null, status: null } }),
}));
vi.mock('../../../hooks/useAuthenticatedImage', () => ({ useAuthenticatedImage: () => ({ blobUrl: null }) }));
vi.mock('../../../features/users/userApiHelpers', () => ({ getUserInfo: vi.fn(async () => ({ avatarUrl: null })) }));

import { KitProvider } from '../../../kit';
import { SpeakingContext } from '../../../contexts/SpeakingContextDef';
import { userControllerGetProfileQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { handleNewMessage } from '../../../socket-hub/handlers/messageHandlers';
import { handleUserOnline, resetCommunityPresenceThrottle } from '../../../socket-hub/handlers/presenceHandlers';
import { CommunityLeft } from '../../../shell/lounge/pieces/community/CommunityLeft';

const BASE = 'http://localhost:3000';
const AT = '2026-01-01T00:00:00.000Z';
const general = createChannel({ id: 'ch-general', name: 'general', communityId: 'c-1', position: 0, createdAt: AT });
const clips = createChannel({ id: 'ch-clips', name: 'clips', communityId: 'c-1', position: 1, createdAt: AT });
const lfg = createChannel({ id: 'ch-lfg', name: 'lfg', communityId: 'c-1', position: 2, createdAt: AT });
const squad = createChannel({ id: 'vc-squad', name: 'Squad Up', type: 'VOICE', communityId: 'c-1', position: 0, createdAt: AT });
const afk = createChannel({ id: 'vc-afk', name: 'AFK', type: 'VOICE', communityId: 'c-1', position: 1, createdAt: AT });

const presenceUser = (id: string, name: string) => ({
  id,
  username: name,
  displayName: name,
  avatarUrl: null,
  joinedAt: AT,
  isDeafened: false,
  isServerMuted: false,
});

let unread: unknown[] = [];
let online: string[] = ['u-dropbear'];

function serve() {
  server.use(
    http.get(`${BASE}/api/community/c-1`, () => HttpResponse.json({ id: 'c-1', name: 'Couch Co-op', description: null, avatar: null, banner: null, createdAt: AT })),
    http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([general, clips, lfg, squad, afk])),
    http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(unread)),
    http.get(`${BASE}/api/presence/community/c-1`, () =>
      HttpResponse.json({ onlineUserIds: online, onlineCount: online.length, memberCount: 9 }),
    ),
    http.get(`${BASE}/api/channels/vc-afk/voice-presence`, () =>
      HttpResponse.json({ channelId: 'vc-afk', users: [presenceUser('u-kwam3', 'kwam3')], count: 1 }),
    ),
    http.get(`${BASE}/api/channels/vc-squad/voice-presence`, () => HttpResponse.json({ channelId: 'vc-squad', users: [], count: 0 })),
  );
}

/** A LiveKit room as far as useVoiceRoomPeople reads it: you and dropbear. */
function fakeRoom() {
  return {
    localParticipant: { identity: 'u-alexk', name: 'alexk', metadata: undefined },
    remoteParticipants: new Map([['u-dropbear', { identity: 'u-dropbear', name: 'dropbear' }]]),
    on: () => undefined,
    off: () => undefined,
  };
}

let setSpeaking: (map: Map<string, boolean>) => void = () => undefined;
function Speaking({ children }: { children: ReactNode }) {
  const [map, set] = useState(new Map<string, boolean>());
  setSpeaking = set;
  return <SpeakingContext.Provider value={{ speakingMap: map, isSpeaking: (id) => !!map.get(id) }}>{children}</SpeakingContext.Provider>;
}

function renderLeft() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'u-alexk', username: 'alexk' } as never);
  const Hub = createTestHubWrapper({ queryClient, eventBus: createEventBus() });
  render(
    <Hub>
      <MemoryRouter initialEntries={['/community/c-1']}>
        <ThemeProvider theme={createTheme()}>
          <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
            <Speaking>
              <nav aria-label="Community">
                <CommunityLeft communityId="c-1" channelId="ch-general" />
              </nav>
            </Speaking>
          </KitProvider>
        </ThemeProvider>
      </MemoryRouter>
    </Hub>,
  );
  return { queryClient };
}

beforeEach(() => {
  resetCommunityPresenceThrottle();
  counts.rows.clear();
  counts.stacks.clear();
  unread = [];
  online = ['u-dropbear'];
  voice.state = { isConnected: false, isConnecting: false, currentChannelId: null, room: null };
});

describe('CommunityLeft render counts', () => {
  it('one unread change re-renders only that channel row', async () => {
    serve();
    const { queryClient } = renderLeft();
    await screen.findByRole('link', { name: 'lfg' });
    await screen.findByText('1 around');
    counts.rows.clear();
    unread = [{ channelId: 'ch-lfg', communityId: 'c-1', channelType: 'TEXT', unreadCount: 1, mentionCount: 0 }];
    await act(async () => {
      await handleNewMessage({ message: { id: 'm-1', channelId: 'ch-lfg', directMessageGroupId: null, authorId: 'u-x' } as never }, queryClient);
    });
    await screen.findByRole('link', { name: 'lfg, unread' });
    expect(counts.rows.get('lfg')).toBeGreaterThanOrEqual(1);
    expect(counts.rows.get('general') ?? 0).toBe(0);
    expect(counts.rows.get('clips') ?? 0).toBe(0);
  });

  it('a presence change updates "N around" and re-renders no channel row', async () => {
    serve();
    const { queryClient } = renderLeft();
    await screen.findByText('1 around');
    counts.rows.clear();
    online = ['u-dropbear', 'u-aiko'];
    act(() => handleUserOnline({ userId: 'u-aiko' } as never, queryClient));
    await screen.findByText('2 around');
    expect([...counts.rows.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('a speaking change in your room re-renders that room card only', async () => {
    voice.state = { isConnected: true, isConnecting: false, currentChannelId: 'vc-squad', room: fakeRoom() };
    serve();
    renderLeft();
    await screen.findByText('You and dropbear');
    await screen.findByText('kwam3');
    counts.stacks.clear();
    counts.rows.clear();
    act(() => setSpeaking(new Map([['u-dropbear', true]])));
    await screen.findByText('dropbear is talking');
    // Squad Up's stack starts with you (alexk); AFK's with kwam3
    expect(counts.stacks.get('alexk')).toBeGreaterThanOrEqual(1);
    expect(counts.stacks.get('kwam3') ?? 0).toBe(0);
    expect([...counts.rows.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('sanity', () => {
  it('the wrapped kit still renders real rows', async () => {
    serve();
    renderLeft();
    await waitFor(() => expect(screen.getAllByRole('link').length).toBe(3));
  });
});
