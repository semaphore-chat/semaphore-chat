import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import DirectMessagesPage from '../../pages/DirectMessagesPage';
import { VoiceSessionType } from '../../contexts/VoiceContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

let mockDmGroupData: Record<string, unknown> | null = {
  id: 'dm-1',
  isGroup: false,
  name: null,
  members: [],
};

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  directMessagesControllerFindDmGroupOptions: () => ({
    queryKey: ['dm-group', 'dm-1'],
    queryFn: () => Promise.resolve(mockDmGroupData),
  }),
  friendsControllerGetPendingRequestsOptions: () => ({
    queryKey: ['pending-requests'],
    queryFn: () => Promise.resolve({ received: [] }),
  }),
}));

let mockVoiceState: Record<string, unknown> = {
  isConnected: false,
  contextType: null,
  currentDmGroupId: null,
};

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoice: () => mockVoiceState,
  };
});

const mockUseStagePresence = vi.fn();
vi.mock('../../hooks/useStagePresence', () => ({
  useStagePresence: (active: boolean) => mockUseStagePresence(active),
}));

let mockIsMobile = false;
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: mockIsMobile }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'current-user' } }),
}));

vi.mock('../../components/Voice', () => ({
  VideoTiles: () => <div data-testid="video-tiles" />,
}));

vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: ({ dmGroupId }: { dmGroupId: string }) => (
    <div data-testid="direct-message-container" data-dm-group-id={dmGroupId} />
  ),
}));

vi.mock('../../components/DirectMessages/DirectMessageList', () => ({
  default: () => <div data-testid="dm-list" />,
}));

vi.mock('../../components/DirectMessages/DMChatHeader', () => ({
  DMChatHeader: () => <div data-testid="dm-chat-header" />,
}));

vi.mock('../../components/Friends', () => ({
  FriendsPanel: () => <div data-testid="friends-panel" />,
}));

function renderDmPage(initialEntry: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/direct-messages/:dmGroupId" element={<DirectMessagesPage />} />
    </Routes>,
    { routerProps: { initialEntries: [initialEntry] } },
  );
}

describe('DirectMessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmGroupData = { id: 'dm-1', isGroup: false, name: null, members: [] };
    mockVoiceState = { isConnected: false, contextType: null, currentDmGroupId: null };
    mockIsMobile = false;
  });

  it('renders StageSplit with VideoTiles + DirectMessageContainer when connected to the selected DM', async () => {
    mockVoiceState = {
      isConnected: true,
      contextType: VoiceSessionType.Dm,
      currentDmGroupId: 'dm-1',
    };

    renderDmPage('/direct-messages/dm-1');

    expect(await screen.findByTestId('video-tiles')).toBeInTheDocument();
    expect(screen.getByTestId('direct-message-container')).toHaveAttribute('data-dm-group-id', 'dm-1');
    expect(screen.getByTestId('stage-split-container')).toBeInTheDocument();
    expect(mockUseStagePresence).toHaveBeenCalledWith(true);
  });

  it('renders plain chat (no StageSplit) when connected to a different DM group', async () => {
    mockVoiceState = {
      isConnected: true,
      contextType: VoiceSessionType.Dm,
      currentDmGroupId: 'dm-2',
    };

    renderDmPage('/direct-messages/dm-1');

    expect(await screen.findByTestId('direct-message-container')).toHaveAttribute('data-dm-group-id', 'dm-1');
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-split-container')).not.toBeInTheDocument();
    expect(mockUseStagePresence).toHaveBeenCalledWith(false);
  });

  it('renders plain chat (no StageSplit) when connected to a Channel-type voice session', async () => {
    mockVoiceState = {
      isConnected: true,
      contextType: VoiceSessionType.Channel,
      currentDmGroupId: null,
    };

    renderDmPage('/direct-messages/dm-1');

    expect(await screen.findByTestId('direct-message-container')).toHaveAttribute('data-dm-group-id', 'dm-1');
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-split-container')).not.toBeInTheDocument();
    expect(mockUseStagePresence).toHaveBeenCalledWith(false);
  });

  it('never renders StageSplit on the mobile branch, even when connected to the selected DM', async () => {
    mockIsMobile = true;
    mockVoiceState = {
      isConnected: true,
      contextType: VoiceSessionType.Dm,
      currentDmGroupId: 'dm-1',
    };

    renderDmPage('/direct-messages/dm-1');

    expect(await screen.findByTestId('direct-message-container')).toHaveAttribute('data-dm-group-id', 'dm-1');
    expect(screen.queryByTestId('video-tiles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-split-container')).not.toBeInTheDocument();
    // isDmStage is gated by `&& !isMobile` before reaching useStagePresence.
    expect(mockUseStagePresence).toHaveBeenCalledWith(false);
  });
});
