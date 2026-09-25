/**
 * Tablet voice channel screen (connected): the chat panel renders the stage
 * (VideoTiles), so it must report the stage as mounted — otherwise the float
 * card repeats a tile on top of it (Task 16). Phone keeps its own full-screen
 * "show tiles" sheet and doesn't report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack: vi.fn(), navigateToSearch: vi.fn() }),
}));

const voice = vi.hoisted(() => ({ isConnected: true, currentChannelId: 'vc-1' as string | null }));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: voice }),
}));

const stagePresence = vi.hoisted(() => ({ calls: [] as boolean[] }));
vi.mock('../../hooks/useStagePresence', () => ({
  useStagePresence: (active: boolean) => {
    stagePresence.calls.push(active);
  },
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

describe('MobileChatPanel stage presence', () => {
  beforeEach(() => {
    mockIsMobile = false;
    voice.isConnected = true;
    voice.currentChannelId = 'vc-1';
    stagePresence.calls = [];
  });

  it('reports the stage as mounted on tablet while connected to this voice channel', async () => {
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="vc-1" />);

    expect(await screen.findByTestId('video-tiles')).toBeInTheDocument();
    expect(stagePresence.calls[stagePresence.calls.length - 1]).toBe(true);
  });

  it('does not report the stage on tablet when connected elsewhere', async () => {
    voice.currentChannelId = 'other';
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="vc-1" />);

    expect(await screen.findByRole('button', { name: 'Join voice' })).toBeInTheDocument();
    expect(stagePresence.calls.every((c) => c === false)).toBe(true);
  });

  it('does not report the stage on phone (phone uses its own tile sheet)', async () => {
    mockIsMobile = true;
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="vc-1" />);

    expect(await screen.findByTestId('video-tiles')).toBeInTheDocument();
    expect(stagePresence.calls.every((c) => c === false)).toBe(true);
  });
});
