import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { renderWithProviders, createChannel } from '../test-utils';
import { THEME_MATRIX, themeLabel } from '../test-utils/themeMatrix';
import { generateTheme } from '../../theme/themeConfig';
import { ChannelRow } from '../../components/Channel/ChannelRow';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockJoinVoiceChannel = vi.fn();
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null, showVideoTiles: false },
    actions: {
      joinVoiceChannel: mockJoinVoiceChannel,
      revealVideoTiles: vi.fn(),
    },
  }),
}));

vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: ({ channel }: { channel: { id: string } }) => (
    <div data-testid="voice-user-list" data-channel-id={channel.id}>
      participant-a
    </div>
  ),
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
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('ChannelRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnreadCount.mockReturnValue(0);
    mockMentionCount.mockReturnValue(0);
  });

  it('renders unread text channels bold with a mention badge from read receipts', () => {
    mockUnreadCount.mockImplementation((id) => (id === 'ch-1' ? 4 : 0));
    mockMentionCount.mockImplementation((id) => (id === 'ch-1' ? 3 : 0));
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });

    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="touch" />,
    );

    expect(screen.getByText('general')).toHaveStyle({ fontWeight: 700 });
    expect(screen.getByTestId('mention-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('unread-indicator')).toBeInTheDocument();
  });

  it('caps mention badges at 99+', () => {
    mockUnreadCount.mockReturnValue(250);
    mockMentionCount.mockReturnValue(120);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });

    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="touch" />,
    );

    expect(screen.getByTestId('mention-badge')).toHaveTextContent('99+');
  });

  it('shows no unread state for read channels or the selected channel', () => {
    mockUnreadCount.mockReturnValue(4);
    mockMentionCount.mockReturnValue(2);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });

    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected variant="touch" />,
    );

    expect(screen.queryByTestId('mention-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unread-indicator')).not.toBeInTheDocument();
    expect(screen.getByText('general')).not.toHaveStyle({ fontWeight: 700 });
  });

  it('marks the selected row', () => {
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected variant="touch" />,
    );

    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveClass('Mui-selected');
    expect(row).toHaveAttribute('aria-current', 'page');
  });

  it('renders voice participants under voice channels only', () => {
    const voice = createChannel({ id: 'vc-1', name: 'Hangout', type: 'VOICE' });
    const text = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });

    renderWithProviders(
      <>
        <ChannelRow channel={voice} communityId="c1" selected={false} variant="touch" />
        <ChannelRow channel={text} communityId="c1" selected={false} variant="touch" />
      </>,
    );

    const lists = screen.getAllByTestId('voice-user-list');
    expect(lists).toHaveLength(1);
    expect(lists[0]).toHaveAttribute('data-channel-id', 'vc-1');
  });

  it('renders a lock for private channels only', () => {
    const secret = createChannel({ id: 'ch-2', name: 'secret', type: 'TEXT', isPrivate: true });
    renderWithProviders(
      <ChannelRow channel={secret} communityId="c1" selected={false} variant="touch" />,
    );
    expect(screen.getByLabelText('Private channel')).toBeInTheDocument();
  });

  it('does not render a lock for public channels', () => {
    const pub = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT', isPrivate: false });
    renderWithProviders(
      <ChannelRow channel={pub} communityId="c1" selected={false} variant="touch" />,
    );
    expect(screen.queryByLabelText('Private channel')).not.toBeInTheDocument();
  });

  it('uses a 44px minimum touch target in the touch variant', () => {
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="touch" />,
    );
    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'touch');
    expect(row).toHaveStyle({ minHeight: `${TOUCH_TARGETS.MINIMUM}px` });
  });

  it('keeps the compact desktop sizing in the desktop variant', () => {
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="desktop" />,
    );
    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'desktop');
    expect(row).not.toHaveStyle({ minHeight: `${TOUCH_TARGETS.MINIMUM}px` });
  });

  it('calls onSelect instead of the default navigation when given', async () => {
    const onSelect = vi.fn();
    const channel = createChannel({ id: 'vc-1', name: 'Hangout', type: 'VOICE' });
    const { user } = renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="touch" onSelect={onSelect} />,
    );

    await user.click(screen.getByText('Hangout'));

    expect(onSelect).toHaveBeenCalledWith(channel);
    expect(mockJoinVoiceChannel).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to text channels by default', async () => {
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT' });
    const { user } = renderWithProviders(
      <ChannelRow channel={channel} communityId="c1" selected={false} variant="desktop" />,
    );

    await user.click(screen.getByText('general'));

    expect(mockNavigate).toHaveBeenCalledWith('/community/c1/channel/ch-1');
  });

  it('renders in every theme mode and intensity', () => {
    mockUnreadCount.mockReturnValue(4);
    mockMentionCount.mockReturnValue(2);
    const channel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT', isPrivate: true });

    for (const entry of THEME_MATRIX) {
      for (const variant of ['desktop', 'touch'] as const) {
        const { unmount } = renderWithProviders(
          <ThemeProvider theme={generateTheme(entry.mode, 'blue', entry.intensity)}>
            <ChannelRow channel={channel} communityId="c1" selected={false} variant={variant} />
          </ThemeProvider>,
          { withTheme: false },
        );
        expect(screen.getByText('general'), themeLabel(entry)).toBeInTheDocument();
        unmount();
      }
    }
  });
});
