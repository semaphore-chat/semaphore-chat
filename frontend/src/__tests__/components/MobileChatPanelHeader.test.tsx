import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createDmGroupMember, createTestQueryClient } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';
import type { DirectMessageGroup } from '../../types/direct-message.type';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack: vi.fn() }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null } }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

let mockDmGroup: DirectMessageGroup | undefined;
// 'pending' holds the group request open forever; 'error' rejects it.
let mockDmGroupRequest: 'ok' | 'pending' | 'error' = 'ok';
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({ queryKey: ['channel', ''], enabled: false }),
  directMessagesControllerFindDmGroupOptions: () => ({
    queryKey: ['dm-group'],
    queryFn: () => {
      if (mockDmGroupRequest === 'pending') return new Promise(() => {});
      if (mockDmGroupRequest === 'error') return Promise.reject(new Error('Not found'));
      return Promise.resolve(mockDmGroup);
    },
  }),
  directMessagesControllerFindUserDmGroupsOptions: () => ({ queryKey: ['dm-groups'] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: (props: {
    title: string;
    titleLoading?: boolean;
    showMembers?: boolean;
    onMoreClick?: (e: React.MouseEvent<HTMLElement>) => void;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="mobile-app-bar">
      <span data-testid="app-bar-title">{props.title}</span>
      {props.titleLoading && <span data-testid="app-bar-title-loading" />}
      {props.showMembers && <button>members</button>}
      <button onClick={props.onMoreClick}>more</button>
      {props.actions}
    </div>
  ),
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

const me = createDmGroupMember({
  userId: 'me',
  user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null },
});
const bob = createDmGroupMember({
  userId: 'bob',
  user: { id: 'bob', username: 'bob', displayName: 'Bob Builder', avatarUrl: null },
});
const carol = createDmGroupMember({
  userId: 'carol',
  user: { id: 'carol', username: 'carol', displayName: null, avatarUrl: null },
});

describe('MobileChatPanel header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmGroup = undefined;
    mockDmGroupRequest = 'ok';
  });

  it('shows a neutral placeholder title, never "Unknown", while the DM loads', () => {
    mockDmGroupRequest = 'pending';
    renderWithProviders(<MobileChatPanel dmGroupId="dm-1" />);

    expect(screen.getByTestId('app-bar-title-loading')).toBeInTheDocument();
    expect(screen.getByTestId('app-bar-title')).toHaveTextContent('');
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it('shows the name from the cached DM list immediately, before the DM loads', () => {
    mockDmGroupRequest = 'pending';
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['dm-groups'], [
      createDmGroup({ id: 'dm-1', isGroup: false, members: [me, bob] }),
    ]);
    renderWithProviders(<MobileChatPanel dmGroupId="dm-1" />, { queryClient });

    expect(screen.getByTestId('app-bar-title')).toHaveTextContent('Bob Builder');
    expect(screen.queryByTestId('app-bar-title-loading')).not.toBeInTheDocument();
  });

  it('says the conversation is unavailable when the DM fails to load', async () => {
    mockDmGroupRequest = 'error';
    renderWithProviders(<MobileChatPanel dmGroupId="dm-1" />);

    expect(await screen.findByText('Conversation unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('app-bar-title-loading')).not.toBeInTheDocument();
  });

  it("shows the other user's name for a 1:1 DM", async () => {
    mockDmGroup = createDmGroup({ id: 'dm-1', isGroup: false, members: [me, bob] });
    renderWithProviders(<MobileChatPanel dmGroupId="dm-1" />);
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument();
    expect(screen.queryByText('Direct Message')).not.toBeInTheDocument();
  });

  it('shows member names and a members button for an unnamed group DM', async () => {
    mockDmGroup = createDmGroup({ id: 'dm-2', isGroup: true, members: [me, bob, carol] });
    renderWithProviders(<MobileChatPanel dmGroupId="dm-2" />);
    expect(await screen.findByText('Bob Builder, carol')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'members' })).toBeInTheDocument();
  });

  it('does not show a members button for a 1:1 DM', async () => {
    mockDmGroup = createDmGroup({ id: 'dm-3', isGroup: false, members: [me, bob] });
    renderWithProviders(<MobileChatPanel dmGroupId="dm-3" />);
    await screen.findByText('Bob Builder');
    expect(screen.queryByRole('button', { name: 'members' })).not.toBeInTheDocument();
  });

  it('offers View Members in the overflow menu for a group DM', async () => {
    mockDmGroup = createDmGroup({ id: 'dm-4', isGroup: true, members: [me, bob, carol] });
    const { user } = renderWithProviders(<MobileChatPanel dmGroupId="dm-4" />);
    await screen.findByText('Bob Builder, carol');
    await user.click(screen.getByRole('button', { name: 'more' }));
    expect(await screen.findByRole('menuitem', { name: 'View Members' })).toBeInTheDocument();
  });

  it('does not offer View Members in the overflow menu for a 1:1 DM', async () => {
    mockDmGroup = createDmGroup({ id: 'dm-5', isGroup: false, members: [me, bob] });
    const { user } = renderWithProviders(<MobileChatPanel dmGroupId="dm-5" />);
    await screen.findByText('Bob Builder');
    await user.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.queryByRole('menuitem', { name: 'View Members' })).not.toBeInTheDocument();
  });
});
