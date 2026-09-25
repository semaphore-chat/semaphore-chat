import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';

// Mock mobile navigation context
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({
    goBack: vi.fn(),
  }),
}));

// Mock voice connection hook
vi.mock('../../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null },
  }),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null },
  }),
}));

// Mock API client for TanStack Query options
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({ queryKey: ['channel', ''], enabled: false }),
  directMessagesControllerFindDmGroupOptions: () => ({ queryKey: ['dm', ''], enabled: false }),
  directMessagesControllerFindUserDmGroupsOptions: () => ({ queryKey: ['dm-groups'] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

// Track which container gets rendered
const mockChannelMessageContainer = vi.fn((_props: Record<string, unknown>) => <div data-testid="channel-message-container" />);
const mockDirectMessageContainer = vi.fn((_props: Record<string, unknown>) => <div data-testid="direct-message-container" />);

vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: (props: Record<string, unknown>) => {
    mockChannelMessageContainer(props);
    return <div data-testid="channel-message-container" data-channel-id={props.channelId} data-community-id={props.communityId} />;
  },
}));

vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: (props: Record<string, unknown>) => {
    mockDirectMessageContainer(props);
    return <div data-testid="direct-message-container" data-dm-group-id={props.dmGroupId} />;
  },
}));

vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: () => <div data-testid="mobile-app-bar" />,
}));

vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));

vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));

describe('MobileChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ChannelMessageContainer for channel messages', () => {
    renderWithProviders(
      <MobileChatPanel communityId="community-1" channelId="channel-1" />
    );

    expect(screen.getByTestId('channel-message-container')).toBeInTheDocument();
    expect(screen.queryByTestId('direct-message-container')).not.toBeInTheDocument();
  });

  it('passes communityId prop to ChannelMessageContainer', () => {
    renderWithProviders(
      <MobileChatPanel communityId="community-1" channelId="channel-1" />
    );

    const container = screen.getByTestId('channel-message-container');
    expect(container).toHaveAttribute('data-community-id', 'community-1');
  });

  it('renders DirectMessageContainer for DM messages', () => {
    renderWithProviders(
      <MobileChatPanel dmGroupId="dm-group-1" />
    );

    expect(screen.getByTestId('direct-message-container')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-message-container')).not.toBeInTheDocument();
  });

  it('passes dmGroupId to DirectMessageContainer', () => {
    renderWithProviders(
      <MobileChatPanel dmGroupId="dm-group-1" />
    );

    const container = screen.getByTestId('direct-message-container');
    expect(container).toHaveAttribute('data-dm-group-id', 'dm-group-1');
  });
});
