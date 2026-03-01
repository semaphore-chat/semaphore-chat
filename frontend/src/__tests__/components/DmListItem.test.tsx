import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createDmGroupMember } from '../test-utils';
import DmListItem from '../../components/DirectMessages/DmListItem';

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ user }: { user: unknown }) => (
    <div data-testid="user-avatar">
      {(user as { username?: string })?.username || 'unknown'}
    </div>
  ),
}));

const CURRENT_USER_ID = 'current-user';

const currentMember = createDmGroupMember({
  id: 'member-current',
  userId: CURRENT_USER_ID,
  user: {
    id: CURRENT_USER_ID,
    username: 'me',
    displayName: 'Current User',
    avatarUrl: null,
  },
});

const otherMember = createDmGroupMember({
  id: 'member-other',
  userId: 'other-user',
  user: {
    id: 'other-user',
    username: 'alice',
    displayName: 'Alice Smith',
    avatarUrl: null,
  },
});

const thirdMember = createDmGroupMember({
  id: 'member-third',
  userId: 'third-user',
  user: {
    id: 'third-user',
    username: 'bob',
    displayName: 'Bob Jones',
    avatarUrl: null,
  },
});

describe('DmListItem', () => {
  let onClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClick = vi.fn();
  });

  it('renders display name for 1:1 DM (other user displayName)', () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders display name for group DM with custom name', () => {
    const group = createDmGroup({
      name: 'Team Chat',
      isGroup: true,
      members: [currentMember, otherMember, thirdMember],
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    expect(screen.getByText('Team Chat')).toBeInTheDocument();
  });

  it('shows "No messages yet" when lastMessage is null', () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
      lastMessage: null,
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('shows last message text from PLAINTEXT span', () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
      lastMessage: {
        id: 'msg-1',
        authorId: 'other-user',
        spans: [{ type: 'PLAINTEXT', text: 'Hey there!' }],
        sentAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    expect(screen.getByText('Hey there!')).toBeInTheDocument();
  });

  it('calls onClick when item is clicked', async () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
    });

    const { user } = renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    await user.click(screen.getByText('Alice Smith'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders UserAvatar for 1:1 DM', () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    const avatar = screen.getByTestId('user-avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent('alice');
  });

  it('renders group icon for group DM', () => {
    const group = createDmGroup({
      isGroup: true,
      members: [currentMember, otherMember, thirdMember],
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        onClick={onClick}
      />,
    );

    // Group DM should not render UserAvatar
    expect(screen.queryByTestId('user-avatar')).not.toBeInTheDocument();
    // GroupIcon renders inside an MUI Avatar; verify the SVG icon is present
    expect(screen.getByTestId('GroupIcon')).toBeInTheDocument();
  });

  it('applies Mui-selected class when isSelected is true', () => {
    const group = createDmGroup({
      isGroup: false,
      members: [currentMember, otherMember],
    });

    renderWithProviders(
      <DmListItem
        group={group}
        currentUserId={CURRENT_USER_ID}
        isSelected
        onClick={onClick}
      />,
    );

    const button = screen.getByRole('button');
    expect(button).toHaveClass('Mui-selected');
  });

  describe('unread indicators', () => {
    it('shows unread badge when unreadCount > 0', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          unreadCount={3}
        />,
      );

      expect(screen.getByTestId('unread-badge')).toBeInTheDocument();
    });

    it('shows mention count in badge when mentionCount > 0', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          unreadCount={5}
          mentionCount={2}
        />,
      );

      const badge = screen.getByTestId('unread-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.querySelector('.MuiBadge-badge')).toHaveTextContent('2');
    });

    it('shows dot badge when unread but no mentions', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          unreadCount={3}
          mentionCount={0}
        />,
      );

      const badge = screen.getByTestId('unread-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.querySelector('.MuiBadge-dot')).toBeInTheDocument();
    });

    it('does not show badge when unreadCount is 0', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          unreadCount={0}
        />,
      );

      expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
    });

    it('does not show badge when item is selected even if unread', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          isSelected
          onClick={onClick}
          unreadCount={5}
          mentionCount={2}
        />,
      );

      expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
    });

    it('bolds DM name when unread', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          unreadCount={3}
        />,
      );

      const nameElement = screen.getByText('Alice Smith');
      expect(nameElement).toHaveStyle({ fontWeight: 700 });
    });
  });
});
