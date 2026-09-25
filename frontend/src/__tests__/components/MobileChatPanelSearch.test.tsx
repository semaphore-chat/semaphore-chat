import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createChannel, createDmGroup } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';
import type { Channel } from '../../types/channel.type';

const { mockNavigateToSearch } = vi.hoisted(() => ({ mockNavigateToSearch: vi.fn() }));

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({
    goBack: vi.fn(),
    openDrawer: vi.fn(),
    navigateToSearch: mockNavigateToSearch,
  }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null } }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

let mockChannel: Channel | undefined;
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel'],
    queryFn: async () => mockChannel,
  }),
  directMessagesControllerFindDmGroupOptions: () => ({
    queryKey: ['dm-group'],
    queryFn: async () => createDmGroup({ id: 'dm-1', isGroup: false }),
  }),
  directMessagesControllerFindUserDmGroupsOptions: () => ({ queryKey: ['dm-groups'] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: () => <div data-testid="direct-message-container" />,
}));
vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));
vi.mock('../../components/Voice/VoiceChannelJoinButton', () => ({
  VoiceChannelJoinButton: () => <button>Join</button>,
}));
// Task 6: the voice placeholder also lists participants (needs VoiceProvider)
vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: () => null,
}));

describe('MobileChatPanel search entry point', () => {
  beforeEach(() => {
    mockNavigateToSearch.mockReset();
    mockChannel = undefined;
  });

  it('shows a Search button on a text channel that opens the search screen', async () => {
    mockChannel = createChannel({ id: 'ch1', communityId: 'c1', name: 'general' });
    const { user } = renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);

    await screen.findByText('# general');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(mockNavigateToSearch).toHaveBeenCalledWith('c1', 'ch1');
  });

  it('has no Search button in a voice channel', async () => {
    mockChannel = createChannel({ id: 'v1', communityId: 'c1', name: 'lounge', type: 'VOICE' });
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="v1" />);
    await screen.findByText('🔊 lounge');
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('has no Search button in a DM (no channel search scope there)', async () => {
    renderWithProviders(<MobileChatPanel dmGroupId="dm-1" />);
    await screen.findByTestId('direct-message-container');
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
  });
});
