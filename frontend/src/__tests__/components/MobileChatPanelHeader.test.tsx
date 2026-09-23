import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createDmGroupMember } from '../test-utils';
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
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({ queryKey: ['channel', ''], enabled: false }),
  directMessagesControllerFindDmGroupOptions: () => ({
    queryKey: ['dm-group'],
    queryFn: async () => mockDmGroup,
  }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: (props: {
    title: string;
    showMembers?: boolean;
    onMoreClick?: (e: React.MouseEvent<HTMLElement>) => void;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="mobile-app-bar">
      <span data-testid="app-bar-title">{props.title}</span>
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
