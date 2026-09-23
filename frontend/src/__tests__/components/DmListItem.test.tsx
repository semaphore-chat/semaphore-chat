import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createDmGroupMember } from '../test-utils';
import DmListItem from '../../components/DirectMessages/DmListItem';

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ userId, showStatus, isOnline }: { userId?: string; showStatus?: boolean; isOnline?: boolean }) => (
    <div data-testid="user-avatar" data-show-status={showStatus ? 'true' : undefined} data-is-online={isOnline ? 'true' : undefined}>
      {userId || 'unknown'}
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
  let onClick: Mock<() => void>;

  beforeEach(() => {
    onClick = vi.fn<() => void>();
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
        spans: [{ type: 'PLAINTEXT', text: 'Hey there!', userId: null, specialKind: null, communityId: null, aliasId: null }],
        sentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
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
    expect(avatar).toHaveTextContent('other-user');
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

  describe('online status indicator', () => {
    it('passes showStatus and isOnline to UserAvatar for 1:1 DM when online', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          isOnline
        />,
      );

      const avatar = screen.getByTestId('user-avatar');
      expect(avatar).toHaveAttribute('data-show-status', 'true');
      expect(avatar).toHaveAttribute('data-is-online', 'true');
    });

    it('passes showStatus but not isOnline when user is offline', () => {
      const group = createDmGroup({
        isGroup: false,
        members: [currentMember, otherMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          isOnline={false}
        />,
      );

      const avatar = screen.getByTestId('user-avatar');
      expect(avatar).toHaveAttribute('data-show-status', 'true');
      expect(avatar).not.toHaveAttribute('data-is-online');
    });

    it('does not show status indicator for group DMs', () => {
      const group = createDmGroup({
        isGroup: true,
        members: [currentMember, otherMember, thirdMember],
      });

      renderWithProviders(
        <DmListItem
          group={group}
          currentUserId={CURRENT_USER_ID}
          onClick={onClick}
          isOnline
        />,
      );

      expect(screen.queryByTestId('user-avatar')).not.toBeInTheDocument();
    });
  });

  describe('unread indicators (one indicator per state)', () => {
    const renderUnread = (props: { unreadCount?: number; mentionCount?: number; isSelected?: boolean }) => {
      const group = createDmGroup({ isGroup: false, members: [currentMember, otherMember] });
      return renderWithProviders(
        <DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={onClick} {...props} />,
      );
    };

    it('shows a dot for exactly one unread message', () => {
      renderUnread({ unreadCount: 1 });
      const badges = screen.getAllByTestId('unread-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0].querySelector('.MuiBadge-dot')).toBeInTheDocument();
      expect(badges[0]).not.toHaveTextContent(/\d/);
    });

    it('shows a count for more than one unread message (no separate dot)', () => {
      renderUnread({ unreadCount: 3 });
      const badges = screen.getAllByTestId('unread-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0].querySelector('.MuiBadge-dot')).not.toBeInTheDocument();
      expect(badges[0].querySelector('.MuiBadge-badge')).toHaveTextContent('3');
    });

    it('shows a single count when there are mentions too', () => {
      renderUnread({ unreadCount: 5, mentionCount: 2 });
      const badges = screen.getAllByTestId('unread-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0].querySelector('.MuiBadge-badge')).toHaveTextContent('5');
    });

    it('caps the count at 99+', () => {
      renderUnread({ unreadCount: 150 });
      expect(screen.getByTestId('unread-badge').querySelector('.MuiBadge-badge')).toHaveTextContent('99+');
    });

    it('does not show badge when unreadCount is 0', () => {
      renderUnread({ unreadCount: 0 });
      expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
    });

    it('does not show badge when item is selected even if unread', () => {
      renderUnread({ unreadCount: 5, mentionCount: 2, isSelected: true });
      expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
    });

    it('bolds DM name when unread', () => {
      renderUnread({ unreadCount: 3 });
      expect(screen.getByText('Alice Smith')).toHaveStyle({ fontWeight: 700 });
    });
  });

  describe('layout', () => {
    const lastMessage = {
      id: 'msg-1',
      authorId: 'other-user',
      spans: [{ type: 'PLAINTEXT' as const, text: 'Hey there!', userId: null, specialKind: null, communityId: null, aliasId: null }],
      sentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    it.each([[0], [1], [7]])('keeps the timestamp on the name row (unread=%s)', (unreadCount) => {
      const group = createDmGroup({ isGroup: false, members: [currentMember, otherMember], lastMessage });
      renderWithProviders(
        <DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={onClick} unreadCount={unreadCount} />,
      );
      const time = screen.getByTestId('dm-last-time');
      expect(time).toHaveTextContent('5m');
      expect(time.parentElement).toContainElement(screen.getByText('Alice Smith'));
    });

    it('keeps 32-character no-space and Arabic names on one line with an ellipsis', () => {
      for (const name of ['x'.repeat(32), 'عبد الرحمن بن محمد الهاشمي']) {
        const other = createDmGroupMember({
          id: `m-${name.length}`,
          userId: 'o',
          user: { id: 'o', username: 'o', displayName: name, avatarUrl: null },
        });
        const group = createDmGroup({ isGroup: false, members: [currentMember, other], lastMessage });
        const { unmount } = renderWithProviders(
          <DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={onClick} />,
        );
        expect(screen.getByText(name)).toHaveStyle({
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        });
        unmount();
      }
    });

    it('shows unnamed group DMs as "A, B + N"', () => {
      const others = Array.from({ length: 15 }, (_, i) =>
        createDmGroupMember({
          id: `gm-${i}`,
          userId: `g-${i}`,
          user: { id: `g-${i}`, username: `user${i}`, displayName: `Person ${i}`, avatarUrl: null },
        }),
      );
      const group = createDmGroup({ isGroup: true, members: [currentMember, ...others] });
      renderWithProviders(<DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={onClick} />);
      expect(screen.getByTestId('dm-name')).toHaveTextContent(/^Person 0, Person 1 \+ 13$/);
      // Only the names ellipsise; the "+ 13" count always stays visible.
      expect(screen.getByText('Person 0, Person 1')).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
      expect(screen.getByText('+ 13')).toHaveStyle({ flexShrink: '0' });
    });

    it('exposes the full group member list as a title tooltip', () => {
      const others = Array.from({ length: 5 }, (_, i) =>
        createDmGroupMember({
          id: `gm-${i}`,
          userId: `g-${i}`,
          user: { id: `g-${i}`, username: `user${i}`, displayName: `Person ${i}`, avatarUrl: null },
        }),
      );
      const group = createDmGroup({ isGroup: true, members: [currentMember, ...others] });
      renderWithProviders(<DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={onClick} />);
      expect(screen.getByTestId('dm-name')).toHaveAttribute(
        'title',
        'Person 0, Person 1, Person 2, Person 3, Person 4',
      );
    });
  });
});

describe('DmListItem theme matrix', () => {
  it('renders in every theme', async () => {
    const { renderInEveryTheme } = await import('../test-utils/themeMatrix');
    const group = createDmGroup({ isGroup: false, members: [currentMember, otherMember] });
    renderInEveryTheme(
      () => <DmListItem group={group} currentUserId={CURRENT_USER_ID} onClick={() => {}} unreadCount={4} />,
      () => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      },
    );
  });
});
