/**
 * The community left island (shell/lounge/pieces/community/*): the views' states and accessible
 * names, and the connected island on MSW with the real data hooks and the real socket handlers.
 *
 * Real: the kit (KitProvider, AppFrame for toasts), useCommunity, useCommunityChannels,
 * useUnreadSummary, useVoiceRoomPeople, useJoinVoiceRoom, the socket handlers. Fake: the voice
 * context (state and actions), the call bar model, permissions, the current user, the member count
 * and authenticated images.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

const mocks = vi.hoisted(() => ({
  voiceState: {} as Record<string, unknown>,
  joinVoiceChannel: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  permissions: new Set<string>(),
  connect: true,
  callBar: null as unknown,
  aroundCount: 9 as number | null,
}));
vi.mock('../../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: mocks.voiceState,
    actions: { joinVoiceChannel: mocks.joinVoiceChannel, leaveVoiceChannel: mocks.leaveVoiceChannel },
  }),
}));
vi.mock('../../../data/callBar', () => ({ useCallBarModel: () => mocks.callBar }));
vi.mock('../../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: (_type: string, _id: string | undefined, action: string) => mocks.permissions.has(action),
}));
vi.mock('../../../hooks/useChannelPermissions', () => ({
  useChannelPermissions: () => ({ can: (capability: string) => (capability === 'connect' ? mocks.connect : true) }),
}));
vi.mock('../../../data/members', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCommunityMembers: () => ({ aroundCount: mocks.aroundCount }),
}));
vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u-alexk', username: 'alexk', displayName: null, avatarUrl: null, status: 'chilling' } }),
}));
vi.mock('../../../hooks/useAuthenticatedImage', () => ({ useAuthenticatedImage: () => ({ blobUrl: null }) }));
const mockPlaySound = vi.fn();
vi.mock('../../../hooks/useSound', () => ({ playSound: (...args: unknown[]) => mockPlaySound(...args), Sounds: { error: 'error' } }));
vi.mock('../../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AppFrame, KitProvider } from '../../../kit';
import { SpeakingContext } from '../../../contexts/SpeakingContextDef';
import { userControllerGetProfileQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { handleNewMessage } from '../../../socket-hub/handlers/messageHandlers';
import { handleVoiceUserJoined } from '../../../socket-hub/handlers/voiceHandlers';
import { CommunityLeft } from '../../../shell/lounge/pieces/community/CommunityLeft';
import { CommunityHeader } from '../../../shell/lounge/pieces/community/CommunityHeader';
import { VoiceRoomCard } from '../../../shell/lounge/pieces/community/VoiceRoomCard';
import { UserCard, UserCardConnected } from '../../../shell/lounge/pieces/community/UserCard';
import { ChannelSection } from '../../../shell/lounge/pieces/community/ChannelSection';
import { callFromModel, callState, loadController } from '../../../shell/lounge/pieces/community/lines';
import { peopleLine, talkingLine, aroundLine } from '../../../shell/lounge/pieces/community/lines';

const BASE = 'http://localhost:3000';
const CREATED = '2026-01-01T00:00:00.000Z';
const general = createChannel({ id: 'ch-general', name: 'general', communityId: 'c-1', position: 0, createdAt: CREATED });
const clips = createChannel({ id: 'ch-clips', name: 'clips', communityId: 'c-1', position: 1, createdAt: CREATED });
const lfg = createChannel({ id: 'ch-lfg', name: 'lfg', communityId: 'c-1', position: 2, createdAt: CREATED });
const mods = createChannel({ id: 'ch-mods', name: 'mods', communityId: 'c-1', position: 3, isPrivate: true, createdAt: CREATED });
const squad = createChannel({ id: 'vc-squad', name: 'Squad Up', type: 'VOICE', communityId: 'c-1', position: 0, createdAt: CREATED });

const presenceUser = (id: string, name: string) => ({
  id,
  username: name,
  displayName: name,
  avatarUrl: null,
  joinedAt: CREATED,
  isDeafened: false,
  isServerMuted: false,
});

interface ServerSetup {
  channels?: unknown[];
  counts?: unknown[];
  community?: () => Response;
  squadPeople?: ReturnType<typeof presenceUser>[];
}

function serve({
  channels = [general, clips, lfg, squad],
  counts = [{ channelId: 'ch-clips', communityId: 'c-1', unreadCount: 4, mentionCount: 2 }],
  community = () => HttpResponse.json({ id: 'c-1', name: 'Couch Co-op', description: null, avatar: null, banner: null, createdAt: CREATED }),
  squadPeople = [presenceUser('u-dropbear', 'dropbear')],
}: ServerSetup = {}) {
  server.use(
    http.get(`${BASE}/api/community/c-1`, community),
    http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json(channels)),
    http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)),
    http.get(`${BASE}/api/channels/vc-squad/voice-presence`, () =>
      HttpResponse.json({ channelId: 'vc-squad', users: squadPeople, count: squadPeople.length }),
    ),
  );
}

let location = '';
function LocationProbe(): null {
  location = useLocation().pathname;
  return null;
}

function Kit({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={createTheme()}>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        {children}
      </KitProvider>
    </ThemeProvider>
  );
}

function renderLeft(channelId: string | null = 'ch-general') {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'u-alexk', username: 'alexk' } as never);
  const Hub = createTestHubWrapper({ queryClient, eventBus: createEventBus() });
  const user = userEvent.setup();
  const result = render(
    <Hub>
      <MemoryRouter initialEntries={['/community/c-1']}>
        <Kit>
          <SpeakingContext.Provider value={{ speakingMap: new Map(), isSpeaking: () => false }}>
            <AppFrame>
              <nav aria-label="Community">
                <CommunityLeft communityId="c-1" channelId={channelId} />
              </nav>
            </AppFrame>
            <LocationProbe />
          </SpeakingContext.Provider>
        </Kit>
      </MemoryRouter>
    </Hub>,
  );
  return { queryClient, user, ...result };
}

const consoleError = vi.spyOn(console, 'error');

beforeEach(() => {
  vi.clearAllMocks();
  consoleError.mockClear();
  mocks.voiceState = { isConnected: false, isConnecting: false, currentChannelId: null, room: null };
  mocks.permissions = new Set();
  mocks.connect = true;
  mocks.callBar = null;
  mocks.aroundCount = 9;
  mocks.joinVoiceChannel.mockResolvedValue(undefined);
  location = '';
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
});

const weight = (element: HTMLElement) => Number(getComputedStyle(element).fontWeight);

describe('CommunityLeft (connected)', () => {
  it('a plain member: the header is a heading, not a button, and there is no menu', async () => {
    serve();
    renderLeft();
    const heading = await screen.findByRole('heading', { name: 'Couch Co-op', level: 2 });
    expect(heading.closest('button, a')).toBeNull();
    expect(screen.queryByRole('button', { name: /community menu/i })).toBeNull();
    expect(screen.getByText('9 around')).toBeInTheDocument();
  });

  it('only the channels the server returned: a private channel the user is not in never shows', async () => {
    serve({ channels: [general, clips, squad] });
    renderLeft();
    await screen.findByRole('link', { name: 'clips' });
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['general', 'clips']);
    expect(screen.queryByText('mods')).toBeNull();
  });

  it('with UPDATE_COMMUNITY: the menu offers Community settings, which opens the classic edit page', async () => {
    mocks.permissions = new Set(['UPDATE_COMMUNITY']);
    serve();
    const { user } = renderLeft();
    const button = await screen.findByRole('button', { name: 'Couch Co-op, community menu' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    const menu = await screen.findByRole('menu', { name: 'Couch Co-op menu' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Community settings']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Community settings' }));
    await waitFor(() => expect(location).toBe('/community/c-1/edit'));
  });

  it('channel rows: links to the channel routes, the selected one current, mentions counted, private marked', async () => {
    serve({ channels: [general, clips, mods, squad] });
    renderLeft('ch-general');
    const clipsLink = await screen.findByRole('link', { name: 'clips' });
    expect(clipsLink).toHaveAttribute('href', '#/community/c-1/channel/ch-clips');
    expect(screen.getByRole('link', { name: 'general' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('img', { name: '2 mentions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Private channel mods' })).toBeInTheDocument();
    // Unread is bold, read is not
    await waitFor(() => expect(weight(within(clipsLink).getByText('clips'))).toBeGreaterThan(weight(screen.getByText('mods'))));
  });

  it('badges count text channels only (channelType): a voice room with unread and mentions shows neither', async () => {
    serve({
      counts: [
        { channelId: 'vc-squad', communityId: 'c-1', channelType: 'VOICE', unreadCount: 5, mentionCount: 3 },
        { channelId: 'ch-clips', communityId: 'c-1', channelType: 'TEXT', unreadCount: 1, mentionCount: 1 },
      ],
    });
    renderLeft();
    expect(await screen.findByRole('img', { name: '1 mention' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /3 mentions/ })).toBeNull();
    expect(screen.getAllByRole('img', { name: /mention/ })).toHaveLength(1);
    const card = screen.getByRole('heading', { name: 'Squad Up' }).closest('div')!.parentElement!.parentElement!;
    expect(within(card).queryByText(/\b[35]\b/)).toBeNull();
  });

  it('the selected channel shows no unread or mention even with counts', async () => {
    serve();
    renderLeft('ch-clips');
    await screen.findByRole('link', { name: 'clips' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'clips' })).toHaveAttribute('aria-current', 'page'));
    expect(screen.queryByRole('img', { name: /mention/ })).toBeNull();
  });

  it('a new message (the real socket handler) bolds its channel', async () => {
    let counts: unknown[] = [];
    server.use(http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)));
    serve({ counts: [] });
    server.use(http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)));
    const { queryClient } = renderLeft();
    const lfgText = await screen.findByText('lfg');
    const readWeight = weight(lfgText);
    counts = [{ channelId: 'ch-lfg', communityId: 'c-1', unreadCount: 1, mentionCount: 0 }];
    await act(async () => {
      await handleNewMessage(
        { message: { id: 'm-1', channelId: 'ch-lfg', directMessageGroupId: null, authorId: 'u-dropbear' } as never },
        queryClient,
      );
    });
    await waitFor(() => expect(weight(screen.getByText('lfg'))).toBeGreaterThan(readWeight));
  });

  it('a voice join (the real socket handler) adds the person to the room card', async () => {
    serve();
    const { queryClient } = renderLeft();
    expect(await screen.findByText('dropbear')).toBeInTheDocument();
    act(() => {
      handleVoiceUserJoined(
        { channelId: 'vc-squad', user: { id: 'u-aiko', username: 'aiko', displayName: 'aiko', isDeafened: false, isServerMuted: false } } as never,
        queryClient,
      );
    });
    expect(await screen.findByText('dropbear and aiko')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'dropbear and aiko' })).toBeInTheDocument();
  });

  it('Join joins through the shared join and stays on the screen', async () => {
    serve();
    const { user } = renderLeft();
    await user.click(await screen.findByRole('button', { name: 'Join Squad Up' }));
    expect(mocks.joinVoiceChannel).toHaveBeenCalledWith('vc-squad', 'Squad Up', 'c-1', false, CREATED);
    expect(location).toBe('/community/c-1');
  });

  it('a failed join says so in a toast with Try again (until PR 7 shows the voice notice)', async () => {
    mocks.joinVoiceChannel.mockRejectedValue(new Error('nope'));
    serve();
    const { user } = renderLeft();
    await user.click(await screen.findByRole('button', { name: 'Join Squad Up' }));
    expect(await screen.findByText("Couldn't join Squad Up")).toBeInTheDocument();
    expect(mockPlaySound).toHaveBeenCalledWith('error');
    mocks.joinVoiceChannel.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.joinVoiceChannel).toHaveBeenCalledTimes(2));
  });

  it('no Join where the classic pre-join screen would refuse (no connect permission)', async () => {
    mocks.connect = false;
    serve();
    renderLeft();
    expect(await screen.findByText("You can't join this room")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join Squad Up' })).toBeNull();
  });

  it('in the room: the card is outlined (current) and Leave leaves', async () => {
    mocks.voiceState = { isConnected: true, isConnecting: false, currentChannelId: 'vc-squad', room: null };
    serve();
    const { user } = renderLeft();
    await user.click(await screen.findByRole('button', { name: 'Leave Squad Up' }));
    expect(mocks.leaveVoiceChannel).toHaveBeenCalled();
    expect(screen.getByText("You're here")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Squad Up' }).closest('[aria-current="true"]')).not.toBeNull();
  });

  it('the channel list is one Tab stop; Down, End and Home move along it', async () => {
    serve();
    const { user } = renderLeft('ch-clips');
    await screen.findByRole('link', { name: 'lfg' });
    const links = screen.getAllByRole('link');
    expect(links.filter((link) => link.tabIndex === 0)).toHaveLength(1);
    act(() => screen.getByRole('link', { name: 'clips' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'lfg' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('link', { name: 'general' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('link', { name: 'lfg' })).toHaveFocus();
  });

  it('not a member (403): says so and offers the way back', async () => {
    serve({ community: () => HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }) });
    const { user } = renderLeft();
    expect(await screen.findByRole('heading', { name: "You're not a member of this community" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to your communities' }));
    await waitFor(() => expect(location).toBe('/'));
  });

  it('channels that fail to load show the error with Try again, which loads them', async () => {
    let fail = true;
    serve();
    server.use(
      http.get(`${BASE}/api/channels/community/c-1`, () =>
        fail ? HttpResponse.json({ statusCode: 500 }, { status: 500 }) : HttpResponse.json([general]),
      ),
    );
    const { user } = renderLeft();
    expect(await screen.findByText("Couldn't load channels")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'general' })).toBeInTheDocument();
  });

  it('no channels: the empty state', async () => {
    serve({ channels: [] });
    renderLeft(null);
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
  });
});

describe('the pieces (views)', () => {
  const noop = () => undefined;

  it('header: loading shows no name; a null count shows no number', () => {
    const { rerender } = render(
      <Kit>
        <CommunityHeader name={null} aroundCount={null} actions={[]} onAction={noop} />
      </Kit>,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    rerender(
      <Kit>
        <CommunityHeader name="Couch Co-op" aroundCount={null} actions={[]} onAction={noop} />
      </Kit>,
    );
    expect(screen.getByRole('heading', { name: 'Couch Co-op' })).toBeInTheDocument();
    expect(screen.queryByText(/around/)).toBeNull();
    expect(aroundLine(1204)).toBe('1,204 around');
  });

  it('voice card: speaking only in your own room, named in the stack and the line', () => {
    const people = [
      { id: 'u-dropbear', name: 'dropbear' },
      { id: 'u-pri', name: 'pri' },
      { id: 'me', name: 'alexk' },
    ];
    const props = { name: 'Squad Up', people, youId: 'me', speaking: new Set(['u-dropbear']), canJoin: true, joining: false, onJoin: noop, onLeave: noop };
    const { rerender } = render(
      <Kit>
        <VoiceRoomCard {...props} youAreHere={false} />
      </Kit>,
    );
    expect(screen.queryByText(/talking/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Join Squad Up' })).toBeInTheDocument();
    rerender(
      <Kit>
        <VoiceRoomCard {...props} youAreHere />
      </Kit>,
    );
    expect(screen.getByText('dropbear is talking')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /dropbear is talking/ })).toBeInTheDocument();
    expect(screen.getByText('You, dropbear and pri')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join Squad Up' })).toBeNull();
  });

  it('voice card: empty room and a busy Join', () => {
    render(
      <Kit>
        <VoiceRoomCard name="AFK" people={[]} youId="me" speaking={new Set()} youAreHere={false} canJoin joining onJoin={noop} onLeave={noop} />
      </Kit>,
    );
    expect(screen.getByText('Nobody here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join AFK' })).toHaveAttribute('aria-busy', 'true');
  });

  it('people and talking lines', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `u-${i}`, name: `p${i}` }));
    expect(peopleLine(twelve, 'u-3')).toBe('You, p0 and 10 more');
    expect(peopleLine([{ id: 'me', name: 'alexk' }], 'me')).toBe('You');
    expect(talkingLine(twelve, new Set(['u-1', 'u-2', 'u-3', 'u-4']), 'u-4')).toBe('p1, p2 and 1 more are talking');
    expect(talkingLine(twelve, new Set(['me']), 'me')).toBeNull();
  });

  it('user card: status only, never a call control; settings always', async () => {
    const onSettings = vi.fn();
    const user = userEvent.setup();
    const card = (call: Parameters<typeof UserCard>[0]['call'], line: string | null = 'In Squad Up') => (
      <Kit>
        <UserCard name="alexk" online line={line} call={call} onSettings={onSettings} />
      </Kit>
    );
    const { rerender } = render(card(null, 'keeping it chill'));
    expect(screen.getByText('keeping it chill')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'alexk, online' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalled();
    const states: [Parameters<typeof UserCard>[0]['call'], string][] = [
      [{ mic: 'on', deafened: false }, 'Mic on'],
      [{ mic: 'muted', deafened: false }, 'Muted'],
      [{ mic: 'muted', deafened: true }, 'Deafened'],
      [{ mic: 'serverMuted', deafened: false }, 'Muted by a moderator'],
      [{ mic: 'blocked', deafened: false }, 'Listening only'],
      [{ mic: 'pushToTalk', deafened: false, keyLabel: 'V' }, 'Push to talk (V)'],
    ];
    for (const [call, text] of states) {
      rerender(card(call));
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByText('In Squad Up')).toBeInTheDocument();
      // The call controls live on the call bar: the card has only Settings
      expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Settings']);
    }
  });

  it('user card state from the call bar model: server mute, a missing SPEAK, push-to-talk, deafened', () => {
    const model = (mic: Record<string, unknown>, deafened = false) =>
      ({ mic: { on: false, serverMuted: false, blocked: false, mode: 'toggle', keyLabel: null, ...mic }, deafened }) as never;
    expect(callFromModel(model({ on: true }))).toEqual({ mic: 'on', deafened: false, keyLabel: null });
    expect(callFromModel(model({})).mic).toBe('muted');
    expect(callFromModel(model({ serverMuted: true, blocked: true })).mic).toBe('serverMuted');
    expect(callFromModel(model({ blocked: true })).mic).toBe('blocked');
    expect(callFromModel(model({ mode: 'pushToTalkKey', keyLabel: 'V' }))).toEqual({ mic: 'pushToTalk', deafened: false, keyLabel: 'V' });
    expect(callState(callFromModel(model({ on: true }, true))).text).toBe('Deafened');
  });
});

describe('200 channels', () => {
  it('render without virtualising in a measured time (reported)', () => {
    const channels = Array.from({ length: 200 }, (_, i) => ({ id: `ch-${i}`, name: `channel-${i}`, unread: i % 7 === 0, mentions: i % 13, isPrivate: i % 11 === 0 }));
    let duration = 0;
    render(
      <Kit>
        <Profiler id="channels" onRender={(_id, _phase, actual) => (duration = Math.max(duration, actual))}>
          <ChannelSection channels={channels} selectedId="ch-3" hrefFor={(id) => `#${id}`} state={loadController('success', false, () => undefined)} />
        </Profiler>
      </Kit>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(200);
    console.warn(`[channels-perf] 200 channel rows: first commit ${duration.toFixed(1)} ms`);
    expect(duration).toBeLessThan(2000);
  });
});

describe('UserCard (connected)', () => {
  it('reads the profile and the call bar model: "In <room>" and the mic state', async () => {
    mocks.callBar = {
      place: { kind: 'channel', name: 'Squad Up', channelId: 'vc-squad', communityId: 'c-1' },
      mic: { on: false, tappable: true, blocked: false, serverMuted: false, mode: 'toggle', keyLabel: null, title: 'Unmute' },
      deafened: false,
      actions: {},
    };
    const queryClient = createTestQueryClient();
    const Hub = createTestHubWrapper({ queryClient, eventBus: createEventBus() });
    render(
      <Hub>
        <MemoryRouter>
          <Kit>
            <UserCardConnected />
          </Kit>
        </MemoryRouter>
      </Hub>,
    );
    expect(await screen.findByText('alexk')).toBeInTheDocument();
    expect(screen.getByText('In Squad Up')).toBeInTheDocument();
    expect(screen.getByText('Muted')).toBeInTheDocument();
    mocks.callBar = null;
  });
});
