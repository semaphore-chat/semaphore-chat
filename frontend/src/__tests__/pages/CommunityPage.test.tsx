import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
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
let mockChannelList: Record<string, unknown>[] = [];
let mockCommunityStatus: number | null = null;

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  communityControllerFindOneOptions: () => ({
    queryKey: ['community', 'community-1'],
    queryFn: () =>
      mockCommunityStatus ? Promise.reject({ statusCode: mockCommunityStatus }) : Promise.resolve(mockCommunityData),
  }),
  channelsControllerFindAllForCommunityOptions: () => ({
    queryKey: ['channels', 'community-1'],
    queryFn: () => Promise.resolve(mockChannelList),
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

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, isLoading: false, isError: false, error: null }),
}));

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null }),
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

vi.mock('../../components/Voice', () => ({
  VideoTiles: () => <div data-testid="video-tiles" />,
}));

vi.mock('../../components/Voice/VoiceChannelPreJoin', () => ({
  VoiceChannelPreJoin: ({ channel }: { channel: { name: string } }) => (
    <div data-testid="voice-prejoin">{channel.name}</div>
  ),
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

const LocationProbe = () => <div data-testid="location">{useLocation().pathname}</div>;

function renderCommunityPage(initialEntry: string) {
  return renderWithProviders(
    <>
    <LocationProbe />
    <Routes>
      <Route path="/community/:communityId" element={<CommunityPage />} />
      <Route path="/community/:communityId/channel/:channelId" element={<CommunityPage />} />
    </Routes>
    </>,
    { routerProps: { initialEntries: [initialEntry] } },
  );
}

describe('CommunityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityData = { id: 'community-1', name: 'Test Community', avatar: null };
    mockChannelData = null;
    mockChannelList = [];
    mockCommunityStatus = null;
    localStorage.clear();
    mockVoiceState = { isConnected: false, currentChannelId: null, channelName: null };
  });

  it('renders VideoTiles and not the pre-join screen when connected to this voice channel', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: true, currentChannelId: 'channel-1', channelName: 'General Voice' };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(await screen.findByTestId('video-tiles')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-prejoin')).not.toBeInTheDocument();
  });

  it('renders the pre-join screen when not connected to this voice channel', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: false, currentChannelId: null, channelName: null };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(await screen.findByTestId('voice-prejoin')).toHaveTextContent('General Voice');
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
  });

  it('renders the pre-join screen when connected to a different voice channel', async () => {
    mockChannelData = { id: 'channel-1', type: ChannelType.VOICE, name: 'General Voice' };
    mockVoiceState = { isConnected: true, currentChannelId: 'other-channel', channelName: 'Other Voice' };

    renderCommunityPage('/community/community-1/channel/channel-1');

    expect(await screen.findByTestId('voice-prejoin')).toBeInTheDocument();
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
  });

  describe('opening a community with no channel selected', () => {
    const textChannel = (id: string, position: number) => ({ id, name: id, type: ChannelType.TEXT, position });

    it('redirects to the first visible text channel when there is no history', async () => {
      mockChannelList = [{ id: 'voice', name: 'voice', type: ChannelType.VOICE, position: 0 }, textChannel('t2', 2), textChannel('t1', 1)];
      mockChannelData = { id: 't1', type: ChannelType.TEXT, name: 't1' };

      renderCommunityPage('/community/community-1');

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/community/community-1/channel/t1'),
      );
    });

    it('redirects to the last-visited channel of that community', async () => {
      localStorage.setItem('lastChannel:user-1:community-1', 't2');
      mockChannelList = [textChannel('t1', 1), textChannel('t2', 2)];
      mockChannelData = { id: 't2', type: ChannelType.TEXT, name: 't2' };

      renderCommunityPage('/community/community-1');

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/community/community-1/channel/t2'),
      );
    });

    it('remembers the text channel being viewed', async () => {
      mockChannelData = { id: 'channel-1', type: ChannelType.TEXT, name: 'general' };

      renderCommunityPage('/community/community-1/channel/channel-1');

      await waitFor(() => expect(localStorage.getItem('lastChannel:user-1:community-1')).toBe('channel-1'));
    });

    it('keeps the placeholder when the community has no visible text channels', async () => {
      mockChannelList = [{ id: 'voice', name: 'voice', type: ChannelType.VOICE, position: 0 }];

      renderCommunityPage('/community/community-1');

      expect(await screen.findByText('Select a channel from the sidebar to get started')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/community\/community-1$/);
    });
  });

  describe('community load failures', () => {
    it.each([
      [403, "You don't have access to this community", false],
      [404, 'This community no longer exists', false],
      [500, "Couldn't load this community", true],
    ])('%i shows the full-page error state', async (status, title, retry) => {
      mockCommunityStatus = status;

      renderCommunityPage('/community/community-1/channel/channel-1');

      expect(await screen.findByRole('alert')).toHaveTextContent(title);
      expect(screen.queryByRole('button', { name: /try again/i }) !== null).toBe(retry);
      expect(screen.queryByText('Error loading community data')).not.toBeInTheDocument();
    });
  });
});
