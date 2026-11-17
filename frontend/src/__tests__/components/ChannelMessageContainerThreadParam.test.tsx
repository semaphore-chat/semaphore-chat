import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, createChannel } from '../test-utils';
import ChannelMessageContainer from '../../components/Channel/ChannelMessageContainer';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';
import { useThreadPanel } from '../../contexts/ThreadPanelContext';
import { DEVICE_BREAKPOINTS } from '../../utils/breakpoints';
import type { Message } from '../../types/message.type';

const env = vi.hoisted(() => ({ electron: false, phone: true }));
const parent = vi.hoisted(() => ({ id: 'parent-1' }) as unknown as Message);

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
  useJumpToMessage: () => ({ isJumpPending: false, highlightMessageId: undefined, messages: [parent] }),
}));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: false }),
  VoiceSessionType: { Channel: 'channel', Dm: 'dm' },
}));


vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: ({ onOpenThread }: { onOpenThread: (m: Message) => void }) => (
    <button onClick={() => onOpenThread(parent)}>open thread</button>
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
});
