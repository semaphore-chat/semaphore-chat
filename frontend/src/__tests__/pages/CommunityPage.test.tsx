import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import CommunityPage from '../../pages/CommunityPage';
import { ChannelType } from '../../types/channel.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

let mockCommunityData: Record<string, unknown> | null = {
  id: 'community-1',
  name: 'Test Community',
  avatar: null,
};
let mockChannelData: Record<string, unknown> | null = null;

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  communityControllerFindOneOptions: () => ({
    queryKey: ['community', 'community-1'],
    queryFn: () => Promise.resolve(mockCommunityData),
  }),
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel', 'channel-1'],
    queryFn: () => Promise.resolve(mockChannelData),
  }),
}));

let mockVoiceState: Record<string, unknown> = {
  isConnected: false,
  currentChannelId: null,
  channelName: null,
};

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({ state: mockVoiceState, actions: {} })),
}));

const mockUseStagePresence = vi.fn();
vi.mock('../../hooks/useStagePresence', () => ({
  useStagePresence: (active: boolean) => mockUseStagePresence(active),
}));

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null }),
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

vi.mock('../../components/Voice', () => ({
  VideoTiles: () => <div data-testid="video-tiles" />,
  VoiceChannelUserList: () => <div data-testid="voice-user-list" />,
}));

vi.mock('../../components/Channel/ChannelList', () => ({
  default: () => <div data-testid="channel-list" />,
}));

vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));

vi.mock('../../components/Community/EditCommunityButton', () => ({
  default: () => <div data-testid="edit-community-button" />,
}));

function renderCommunityPage(initialEntry: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/community/:communityId/channel/:channelId" element={<CommunityPage />} />
    </Routes>,
    { routerProps: { initialEntries: [initialEntry] } },
  );
}

describe('CommunityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityData = { id: 'community-1', name: 'Test Community', avatar: null };
    mockChannelData = null;
    mockVoiceState = { isConnected: false, currentChannelId: null, channelName: null };
  });

  it('renders VideoTiles and not VoiceChannelUserList when connected to this voice channel', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: true, currentChannelId: 'channel-1', channelName: 'General Voice' };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(await screen.findByTestId('video-tiles')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-user-list')).not.toBeInTheDocument();
  });

  it('renders join prompt and VoiceChannelUserList when not connected', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: false, currentChannelId: null, channelName: null };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(
      await screen.findByText('Click on this voice channel in the sidebar to join')
    ).toBeInTheDocument();
    expect(screen.getByTestId('voice-user-list')).toBeInTheDocument();
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
  });

  it('renders the connected-elsewhere warning when connected to a different voice channel', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: true, currentChannelId: 'other-channel', channelName: 'Other Voice' };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(
      await screen.findByText(/You're currently connected to "Other Voice"/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('voice-user-list')).toBeInTheDocument();
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
  });
});
