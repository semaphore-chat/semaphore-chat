/**
 * Phone voice channel screen (not connected): shows who is already in the
 * channel, like the desktop sidebar does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack: vi.fn(), navigateToSearch: vi.fn() }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null } }),
}));

let mockIsMobile = true;
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: true, isMobile: mockIsMobile }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

const voiceChannel = createChannel({ id: 'vc-1', name: 'Hangout', type: 'VOICE', communityId: 'c1' });
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel', 'vc-1'],
    queryFn: async () => voiceChannel,
  }),
  directMessagesControllerFindDmGroupOptions: () => ({ queryKey: ['dm-group'], enabled: false }),
  directMessagesControllerFindUserDmGroupsOptions: () => ({ queryKey: ['dm-groups'] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: ({ channel }: { channel: { id: string } }) => (
    <div data-testid="voice-user-list" data-channel-id={channel.id} />
  ),
}));
vi.mock('../../components/Voice/VoiceChannelJoinButton', () => ({
  VoiceChannelJoinButton: () => <button>Join voice</button>,
}));
vi.mock('../../components/Voice/VideoTiles', () => ({
  VideoTiles: () => <div data-testid="video-tiles" />,
}));
vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: (props: { title: string }) => <div data-testid="mobile-app-bar">{props.title}</div>,
}));
vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));
vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: () => <div data-testid="direct-message-container" />,
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));

describe('MobileChatPanel voice channel (not connected)', () => {
  beforeEach(() => {
    mockIsMobile = true;
  });

  it('lists the participants already in the channel under the join button', async () => {
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="vc-1" />);

    expect(await screen.findByRole('button', { name: 'Join voice' })).toBeInTheDocument();
    expect(screen.getByTestId('voice-user-list')).toHaveAttribute('data-channel-id', 'vc-1');
  });

  it('leaves the participant list to the sidebar on tablet', async () => {
    mockIsMobile = false;
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="vc-1" />);

    expect(await screen.findByRole('button', { name: 'Join voice' })).toBeInTheDocument();
    expect(screen.queryByTestId('voice-user-list')).not.toBeInTheDocument();
  });
});
