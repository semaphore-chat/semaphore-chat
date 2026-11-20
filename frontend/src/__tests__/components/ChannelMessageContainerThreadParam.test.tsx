import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderWithProviders, createChannel } from '../test-utils';
import ChannelMessageContainer from '../../components/Channel/ChannelMessageContainer';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';
import { useThreadPanel } from '../../contexts/ThreadPanelContext';
import { DEVICE_BREAKPOINTS } from '../../utils/breakpoints';
import type { Message } from '../../types/message.type';

const env = vi.hoisted(() => ({ electron: false, phone: true }));
const parent = vi.hoisted(() => ({ id: 'parent-1' }) as unknown as Message);
const other = vi.hoisted(() => ({ id: 'parent-2' }) as unknown as Message);
const loaded = vi.hoisted(() => ({ messages: [] as Message[] }));

vi.mock('../../utils/platform', () => ({
  isElectron: () => env.electron,
}));
vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string) =>
    env.phone && query === `(max-width: ${DEVICE_BREAKPOINTS.PHONE - 1}px)`,
}));

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel'],
    queryFn: async () => createChannel({ id: 'ch-1', name: 'general' }),
  }),
  channelsControllerGetMentionableChannelsOptions: () => ({ queryKey: ['mentionable'], queryFn: async () => [] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned'], queryFn: async () => [] }),
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));
vi.mock('../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: () => ({ data: [] }),
}));
vi.mock('../../hooks/useAutoMarkNotificationsRead', () => ({
  useAutoMarkNotificationsRead: vi.fn(),
}));
vi.mock('../../hooks/useMessageFileUpload', () => ({
  useMessageFileUpload: () => ({ handleSendMessage: vi.fn() }),
}));
vi.mock('../../hooks/useJumpToMessage', () => ({
  useJumpToMessage: () => ({ isJumpPending: false, isLoading: false, highlightMessageId: undefined, messages: loaded.messages }),
}));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: false }),
  VoiceSessionType: { Channel: 'channel', Dm: 'dm' },
}));


const handlerIdentities = vi.hoisted(() => ({ seen: new Set<unknown>() }));
function Probe({ fn }: { fn: unknown }) {
  handlerIdentities.seen.add(fn);
  return null;
}
vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: ({ onOpenThread }: { onOpenThread: (m: Message) => void }) => (
    <>
      <Probe fn={onOpenThread} />
      <button onClick={() => onOpenThread(parent)}>open thread</button>
      <button onClick={() => onOpenThread(other)}>open other thread</button>
    </>
  ),
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Message/MessageSearch', () => ({
  default: () => null,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));
vi.mock('../../components/Thread', () => ({
  ThreadPanel: ({ parentMessage }: { parentMessage: Message }) => {
    const { closeThread } = useThreadPanel();
    return (
      <div data-testid="thread-panel" data-parent={parentMessage.id}>
        <button onClick={closeThread}>close thread</button>
      </div>
    );
  },
}));
vi.mock('../../components/Channel/ChannelNotificationMenu', () => ({
  default: () => null,
}));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

/**
 * `?thread=<id>` is the shared contract for an open thread (the new shell writes it; links carry it). The classic
 * chat opens that thread once its parent is loaded, and closing it drops the param.
 */
describe('ChannelMessageContainer and ?thread=', () => {
  beforeEach(() => {
    env.electron = false;
    env.phone = false;
    loaded.messages = [parent, other];
  });

  it('opening another thread drops the param (a reload must not reopen the first)', async () => {
    const { user } = renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
        <Where />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=parent-1'] } },
    );
    await waitFor(() => expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-1'));
    await user.click(screen.getByRole('button', { name: 'open other thread', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-2'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/community\/c1\/channel\/ch-1$/));
  });

  it('a link to a thread whose parent is not loaded gives up: it does not open out of the blue later', async () => {
    loaded.messages = [other];
    const view = renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=parent-1'] } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Much later the parent turns up in the window (scrolling back): no thread pops open.
    loaded.messages = [parent, other];
    view.rerender(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
      </ThreadPanelProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('thread-panel')).toBeNull();
  });

  it('opens the thread the URL names, and closing it drops only the param', async () => {
    const { user } = renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
        <Where />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=parent-1'] } },
    );
    await waitFor(() => expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-1'));
    await user.click(screen.getByRole('button', { name: 'close thread' }));
    await waitFor(() => expect(screen.queryByTestId('thread-panel')).toBeNull());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/community\/c1\/channel\/ch-1$/);
  });

  it('a thread param that is not an id is ignored', async () => {
    renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=%3Cscript%3E'] } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('thread-panel')).toBeNull();
  });

  it('following a link to another thread while one is open keeps the new ?thread=', async () => {
    function Go() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/community/c1/channel/ch-1?thread=parent-2')}>follow link</button>;
    }
    const { user } = renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
        <Where />
        <Go />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=parent-1'] } },
    );
    await waitFor(() => expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-1'));
    await user.click(screen.getByRole('button', { name: 'follow link', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-2'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('where')).toHaveTextContent('?thread=parent-2');
  });

  it('a ?thread= naming a thread reply opens nothing', async () => {
    loaded.messages = [{ id: 'parent-1', parentMessageId: 'root' } as unknown as Message, other];
    renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1?thread=parent-1'] } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('thread-panel')).toBeNull();
  });

  it('the open-thread handler keeps its identity when the search changes', async () => {
    function Go() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/community/c1/channel/ch-1?highlight=x')}>set highlight</button>;
    }
    handlerIdentities.seen.clear();
    const { user } = renderWithProviders(
      <ThreadPanelProvider>
        <ChannelMessageContainer channelId="ch-1" communityId="c1" />
        <Go />
      </ThreadPanelProvider>,
      { routerProps: { initialEntries: ['/community/c1/channel/ch-1'] } },
    );
    await user.click(screen.getByRole('button', { name: 'set highlight' }));
    expect(handlerIdentities.seen.size).toBe(1);
  });
});
