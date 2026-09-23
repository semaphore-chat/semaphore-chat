import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createChannel, resetFactoryCounter } from '../test-utils';
import ChannelCategoryList from '../../components/Channel/ChannelCategoryList';
import type { Channel } from '../../types/channel.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null, showVideoTiles: false },
    actions: { joinVoiceChannel: vi.fn(), revealVideoTiles: vi.fn() },
  }),
}));

vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: ({ channel }: { channel: { id: string } }) => (
    <div data-testid="voice-user-list" data-channel-id={channel.id} />
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

const mockCanPerformAction = vi.fn((..._args: unknown[]) => false);
vi.mock('../../features/roles/useUserPermissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanPerformAction: (...args: unknown[]) => mockCanPerformAction(...args),
}));

vi.mock('../../components/Community/CreateChannelDialog', () => ({
  default: ({ open, communityId }: { open: boolean; communityId: string }) =>
    open ? <div role="dialog" aria-label="Create channel dialog" data-community-id={communityId} /> : null,
}));

const textChannel = createChannel({ id: 'ch-1', name: 'general', type: 'TEXT', position: 0 });
const voiceChannel = createChannel({ id: 'ch-2', name: 'voice-chat', type: 'VOICE', position: 0 });
const privateChannel = createChannel({ id: 'ch-3', name: 'secret', type: 'TEXT', isPrivate: true, position: 1 });

describe('ChannelCategoryList', () => {
  const defaultProps = {
    channels: [] as Channel[],
    communityId: 'c1',
    onChannelSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetFactoryCounter();
    mockUnreadCount.mockReturnValue(0);
    mockMentionCount.mockReturnValue(0);
    mockCanPerformAction.mockReturnValue(false);
  });

  it('renders "No channels yet" for empty channels array', () => {
    renderWithProviders(<ChannelCategoryList {...defaultProps} channels={[]} />);

    expect(screen.getByText('No channels yet')).toBeInTheDocument();
  });

  it('renders Text Channels and Voice Channels category headers', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel, voiceChannel] as Channel[]}
      />,
    );

    expect(screen.getByText('TEXT CHANNELS')).toBeInTheDocument();
    expect(screen.getByText('VOICE CHANNELS')).toBeInTheDocument();
  });

  it('renders channel names in correct categories', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel, voiceChannel] as Channel[]}
      />,
    );

    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('voice-chat')).toBeInTheDocument();
  });

  it('calls onChannelSelect with channel id when channel clicked', async () => {
    const onChannelSelect = vi.fn();
    const { user } = renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        onChannelSelect={onChannelSelect}
        channels={[textChannel] as Channel[]}
      />,
    );

    await user.click(screen.getByText('general'));

    expect(onChannelSelect).toHaveBeenCalledWith('ch-1');
  });

  it('collapses category when category header clicked', async () => {
    const { user } = renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel] as Channel[]}
      />,
    );

    // Channel is visible initially (category starts expanded)
    expect(screen.getByText('general')).toBeVisible();

    // Click the category header to collapse
    await user.click(screen.getByText('TEXT CHANNELS'));

    // Channel should no longer be visible after collapse
    expect(screen.queryByText('general')).not.toBeVisible();
  });

  it('sorts channels by position', () => {
    const channelPos2 = createChannel({ id: 'ch-a', name: 'third', type: 'TEXT', position: 2 });
    const channelPos0 = createChannel({ id: 'ch-b', name: 'first', type: 'TEXT', position: 0 });
    const channelPos1 = createChannel({ id: 'ch-c', name: 'second', type: 'TEXT', position: 1 });

    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[channelPos2, channelPos0, channelPos1] as Channel[]}
      />,
    );

    const channelNames = screen.getAllByText(/first|second|third/);
    expect(channelNames[0]).toHaveTextContent('first');
    expect(channelNames[1]).toHaveTextContent('second');
    expect(channelNames[2]).toHaveTextContent('third');
  });

  it('shows lock icon for private channels', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[privateChannel] as Channel[]}
      />,
    );

    // The lock icon should be rendered via MUI LockIcon (has data-testid="LockIcon")
    expect(screen.getByTestId('LockIcon')).toBeInTheDocument();
  });

  it('does not show lock icon for public channels', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel] as Channel[]}
      />,
    );

    expect(screen.queryByTestId('LockIcon')).not.toBeInTheDocument();
  });

  it('does not render empty categories', () => {
    // Only text channels provided - Voice Channels header should not appear
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel] as Channel[]}
      />,
    );

    expect(screen.getByText('TEXT CHANNELS')).toBeInTheDocument();
    expect(screen.queryByText('VOICE CHANNELS')).not.toBeInTheDocument();
  });

  it('applies Mui-selected class to the selected channel', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel] as Channel[]}
        selectedChannelId="ch-1"
      />,
    );

    // The ListItemButton wrapping the channel text should have the selected class
    const channelButton = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(channelButton).toHaveClass('Mui-selected');
  });

  it('renders unread and mention badges from read receipts', () => {
    mockUnreadCount.mockImplementation((id) => (id === 'ch-1' ? 5 : 0));
    mockMentionCount.mockImplementation((id) => (id === 'ch-1' ? 2 : 0));
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel, privateChannel] as Channel[]}
      />,
    );

    expect(screen.getByText('general')).toHaveStyle({ fontWeight: 700 });
    expect(screen.getByTestId('mention-badge')).toHaveTextContent('2');
    expect(screen.getByText('secret')).not.toHaveStyle({ fontWeight: 700 });
  });

  it('renders voice participants under voice channels', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel, voiceChannel] as Channel[]}
      />,
    );

    const lists = screen.getAllByTestId('voice-user-list');
    expect(lists).toHaveLength(1);
    expect(lists[0]).toHaveAttribute('data-channel-id', 'ch-2');
  });

  it('uses touch-sized rows', () => {
    renderWithProviders(
      <ChannelCategoryList {...defaultProps} channels={[textChannel] as Channel[]} />,
    );
    const row = screen.getByText('general').closest('.MuiListItemButton-root');
    expect(row).toHaveAttribute('data-variant', 'touch');
  });

  it('shows a skeleton while loading instead of the empty state', () => {
    renderWithProviders(<ChannelCategoryList {...defaultProps} isLoading />);

    expect(screen.getByTestId('channel-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No channels yet')).not.toBeInTheDocument();
  });

  it('shows an error with a working retry button', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ChannelCategoryList {...defaultProps} error={new Error('500')} onRetry={onRetry} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load channels/i);
    expect(screen.queryByText('No channels yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps showing stale channels when a refetch fails', () => {
    renderWithProviders(
      <ChannelCategoryList
        {...defaultProps}
        channels={[textChannel] as Channel[]}
        error={new Error('500')}
        onRetry={vi.fn()}
      />,
    );
    // Stale channels still show; the error only replaces an empty list.
    expect(screen.getByText('general')).toBeInTheDocument();
  });

  it('hides the create-channel action without CREATE_CHANNEL permission', () => {
    mockCanPerformAction.mockReturnValue(false);
    renderWithProviders(<ChannelCategoryList {...defaultProps} channels={[]} />);

    expect(screen.getByText('No channels yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create channel/i })).not.toBeInTheDocument();
  });

  it('offers "Create channel" in the empty state when the user may create channels', async () => {
    mockCanPerformAction.mockImplementation(
      (type, id, action) => type === 'COMMUNITY' && id === 'c1' && action === 'CREATE_CHANNEL',
    );
    const { user } = renderWithProviders(<ChannelCategoryList {...defaultProps} channels={[]} />);

    await user.click(screen.getByRole('button', { name: /create channel/i }));

    expect(screen.getByRole('dialog', { name: 'Create channel dialog' })).toHaveAttribute(
      'data-community-id',
      'c1',
    );
  });
});
