import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { Channel } from '../../components/Channel/Channel';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockJoinVoiceChannel = vi.fn();
const mockRevealVideoTiles = vi.fn();
const mockLeaveVoiceChannel = vi.fn();

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: {
      isConnected: false,
      currentChannelId: null,
      showVideoTiles: false,
    },
    actions: {
      joinVoiceChannel: mockJoinVoiceChannel,
      revealVideoTiles: mockRevealVideoTiles,
      leaveVoiceChannel: mockLeaveVoiceChannel,
    },
  })),
}));

vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: () => <div data-testid="voice-user-list" />,
}));

const mockUnreadCount = vi.fn((_id?: string) => 0);
const mockMentionCount = vi.fn((_id?: string) => 0);
vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    unreadCount: mockUnreadCount,
    mentionCount: mockMentionCount,
    hasUnread: (id?: string) => mockUnreadCount(id) > 0,
    lastReadMessageId: () => undefined,
    allUnreadCounts: [],
  }),
}));

const mockNavigate = vi.fn();
let mockParams: Record<string, string> = { communityId: 'c1', channelId: 'other' };
vi.mock('../../hooks/useSound', () => ({
  playSound: vi.fn(),
  Sounds: { error: 'error' },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

const mockIsElectron = vi.fn(() => false);
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => mockIsElectron(),
}));

/** Make every media query match (touch device, any width). */
function stubTouchMediaQueries() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Import after mocking
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');

describe('Channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = { communityId: 'c1', channelId: 'other' };
    mockIsElectron.mockReturnValue(false);
    mockUnreadCount.mockReturnValue(0);
    mockMentionCount.mockReturnValue(0);
    vi.unstubAllGlobals();
    // Reset useVoiceConnection to default (test overrides persist through clearAllMocks)
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: {
        isConnected: false,
        currentChannelId: null,
        showVideoTiles: false,
      } as never,
      actions: {
        joinVoiceChannel: mockJoinVoiceChannel,
        revealVideoTiles: mockRevealVideoTiles,
        leaveVoiceChannel: mockLeaveVoiceChannel,
      } as never,
    });
  });

  it('renders text channel with tag icon and name', () => {
    const channel = createChannel({ name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.getByText('general')).toBeInTheDocument();
    // TagIcon is rendered (MUI renders as svg with data-testid)
    expect(screen.getByTestId('TagIcon')).toBeInTheDocument();
  });

  it('shows a lock icon for private channels', () => {
    const channel = createChannel({ name: 'secret', type: 'TEXT', isPrivate: true });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.getByTestId('LockIcon')).toBeInTheDocument();
    expect(screen.getByLabelText('Private channel')).toBeInTheDocument();
  });

  it('does not show a lock icon for public channels', () => {
    const channel = createChannel({ name: 'general', type: 'TEXT', isPrivate: false });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.queryByTestId('LockIcon')).not.toBeInTheDocument();
  });

  it('keeps a long channel name on one line so it truncates', () => {
    const longName = 'a-very-long-channel-name-no-spaces'.slice(0, 32);
    const channel = createChannel({ name: longName, type: 'TEXT', isPrivate: true });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    const name = screen.getByText(longName);
    expect(name).toHaveClass('MuiTypography-noWrap');
    // ListItemText must be allowed to shrink so the lock icon stays visible.
    expect(name.closest('.MuiListItemText-root')).toHaveStyle({ minWidth: '0' });
    expect(screen.getByLabelText('Private channel')).toBeInTheDocument();
  });

  it('renders voice channel with volume icon and name', () => {
    const channel = createChannel({ name: 'voice-room', type: 'VOICE' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.getByText('voice-room')).toBeInTheDocument();
    expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
  });

  it('navigates to channel route on text channel click', async () => {
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT', communityId: 'c1' });
    const { user } = renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    await user.click(screen.getByText('general'));

    expect(mockNavigate).toHaveBeenCalledWith('/community/c1/channel/ch-1');
  });

  it('joins voice channel when not connected', async () => {
    const channel = createChannel({ id: 'vc-1', name: 'voice', type: 'VOICE', communityId: 'c1' });
    mockJoinVoiceChannel.mockResolvedValue(undefined);

    const { user } = renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    await user.click(screen.getByText('voice'));

    await waitFor(() => {
      expect(mockJoinVoiceChannel).toHaveBeenCalledWith(
        'vc-1', 'voice', 'c1', false, expect.any(String)
      );
    });
  });

  it('reveals video tiles (show + un-collapse) when clicking already-connected voice channel', async () => {
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: {
        isConnected: true,
        currentChannelId: 'vc-1',
        showVideoTiles: false,
      } as never,
      actions: {
        joinVoiceChannel: mockJoinVoiceChannel,
        revealVideoTiles: mockRevealVideoTiles,
        leaveVoiceChannel: mockLeaveVoiceChannel,
      } as never,
    });

    const channel = createChannel({ id: 'vc-1', name: 'voice', type: 'VOICE', communityId: 'c1' });
    const { user } = renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    await user.click(screen.getByText('voice'));

    expect(mockRevealVideoTiles).toHaveBeenCalled();
  });

  it('shows error notification when voice join fails', async () => {
    mockJoinVoiceChannel.mockRejectedValue(new Error('Connection failed'));

    const channel = createChannel({ id: 'vc-1', name: 'voice', type: 'VOICE', communityId: 'c1' });
    const { user } = renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    await user.click(screen.getByText('voice'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to join voice channel. Please try again.'
    );
  });

  it('renders VoiceChannelUserList for voice channels', () => {
    const channel = createChannel({ type: 'VOICE' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.getByTestId('voice-user-list')).toBeInTheDocument();
  });

  it('does not render VoiceChannelUserList for text channels', () => {
    const channel = createChannel({ type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.queryByTestId('voice-user-list')).not.toBeInTheDocument();
  });

  it('shows bold text for text channels with unread messages', () => {
    mockUnreadCount.mockReturnValue(5);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    const channelName = screen.getByText('general');
    expect(channelName).toBeInTheDocument();
    // The channel name should be rendered with bold styling (fontWeight: 700)
    expect(channelName).toHaveStyle({ fontWeight: 700 });
  });

  it('shows mention count badge when mentions exist', () => {
    mockUnreadCount.mockReturnValue(3);
    mockMentionCount.mockReturnValue(2);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.getByTestId('mention-badge')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('hides mention badge when count is zero', () => {
    mockUnreadCount.mockReturnValue(3);
    mockMentionCount.mockReturnValue(0);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    expect(screen.queryByTestId('mention-badge')).not.toBeInTheDocument();
  });

  it('hides all indicators when channel is selected', () => {
    mockUnreadCount.mockReturnValue(5);
    mockMentionCount.mockReturnValue(2);
    mockParams = { communityId: 'c1', channelId: 'ch-1' };
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/ch-1'] },
    });

    // No mention badge when selected
    expect(screen.queryByTestId('mention-badge')).not.toBeInTheDocument();
    // Channel name should not be bold when selected
    const channelName = screen.getByText('general');
    expect(channelName).not.toHaveStyle({ fontWeight: 700 });
  });

  it('does not show indicators for voice channels', () => {
    mockUnreadCount.mockReturnValue(10);
    mockMentionCount.mockReturnValue(3);
    const channel = createChannel({ id: 'vc-1', name: 'voice', type: 'VOICE' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    // Voice channels should not display any mention badge
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('uses the compact desktop row on non-touch layouts', () => {
    const channel = createChannel({ name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'desktop');
  });

  it('uses the touch row on touch layouts', () => {
    stubTouchMediaQueries();
    const channel = createChannel({ name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'touch');
  });

  it('stays on the desktop row in Electron even when media queries say touch', () => {
    stubTouchMediaQueries();
    mockIsElectron.mockReturnValue(true);
    const channel = createChannel({ name: 'general', type: 'TEXT' });
    renderWithProviders(<Channel channel={channel} />, {
      routerProps: { initialEntries: ['/community/c1/channel/other'] },
    });

    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'desktop');
  });
});
