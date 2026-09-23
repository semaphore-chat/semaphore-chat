import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import ChannelMessageContainer from '../../components/Channel/ChannelMessageContainer';
import type { Channel } from '../../types/channel.type';

let mockChannel: Partial<Channel> | undefined;

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel'],
    queryFn: async () => mockChannel,
  }),
  channelsControllerGetMentionableChannelsOptions: () => ({ queryKey: ['mentionable'], enabled: false }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned'], enabled: false }),
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
  useJumpToMessage: () => ({ isJumpPending: false, highlightMessageId: undefined }),
}));
vi.mock('../../contexts/ThreadPanelContext', () => ({
  useThreadPanel: () => ({ openThreadId: null, openThread: vi.fn(), closeThread: vi.fn() }),
}));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: false }),
  VoiceSessionType: { Channel: 'channel', Dm: 'dm' },
}));
vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: () => <div data-testid="message-container" />,
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Message/MessageSearch', () => ({
  default: () => null,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => null,
}));
vi.mock('../../components/Thread', () => ({
  ThreadPanel: () => null,
}));
vi.mock('../../components/Channel/ChannelNotificationMenu', () => ({
  default: () => null,
}));

const renderHeader = () =>
  renderWithProviders(<ChannelMessageContainer channelId="ch-1" communityId="c1" />, {
    routerProps: { initialEntries: ['/community/c1/channel/ch-1'] },
  });

describe('ChannelMessageContainer header', () => {
  beforeEach(() => {
    mockChannel = undefined;
  });

  it('shows a lock next to the name of a private channel', async () => {
    mockChannel = createChannel({ id: 'ch-1', name: 'secret', isPrivate: true });
    renderHeader();
    expect(await screen.findByText('# secret')).toBeInTheDocument();
    expect(screen.getByLabelText('Private channel')).toBeInTheDocument();
  });

  it('shows no lock for a public channel', async () => {
    mockChannel = createChannel({ id: 'ch-1', name: 'general', isPrivate: false });
    renderHeader();
    expect(await screen.findByText('# general')).toBeInTheDocument();
    expect(screen.queryByLabelText('Private channel')).not.toBeInTheDocument();
  });

  it('keeps a long name on one line so it truncates with an ellipsis', async () => {
    const longName = 'x'.repeat(32);
    mockChannel = createChannel({ id: 'ch-1', name: longName, isPrivate: true });
    renderHeader();
    const title = await screen.findByText(`# ${longName}`);
    expect(title).toHaveClass('MuiTypography-noWrap');
    // The title's flex wrapper must be allowed to shrink below its content width.
    expect(title.parentElement).toHaveStyle({ minWidth: '0' });
  });
});
