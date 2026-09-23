import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MemberList, { type MemberData } from '../../components/Message/MemberList';
import UserAvatar from '../../components/Common/UserAvatar';

// Mock UserProfileContext. openProfile must be referentially stable across
// renders (like the real useCallback-backed context value) — otherwise
// React.memo(MemberRow) can never bail out, since a fresh function reference
// on every render would fail the shallow prop comparison regardless of
// whether `member` changed.
const { mockOpenProfile } = vi.hoisted(() => ({ mockOpenProfile: vi.fn() }));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    openProfile: mockOpenProfile,
  }),
}));

// Mock Moderation component
vi.mock('../../components/Moderation', () => ({
  UserModerationMenu: () => null,
}));

// Mock UserAvatar to avoid FileCacheProvider dependency. Wrapped in vi.fn()
// so tests can inspect exactly which member ids re-rendered — UserAvatar is
// only invoked when its parent MemberRow's function body actually runs, so
// call counts are a reliable proxy for row re-renders.
vi.mock('../../components/Common/UserAvatar', () => ({
  default: vi.fn(() => <div data-testid="user-avatar" />),
}));

function createMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: overrides.id ?? `user-${Math.random().toString(36).slice(2)}`,
    username: overrides.username ?? 'testuser',
    displayName: overrides.displayName ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    isOnline: overrides.isOnline ?? false,
    status: overrides.status ?? null,
    displayRole: overrides.displayRole ?? undefined,
  };
}

describe('MemberList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders grouped sections by role with headers', () => {
    const members: MemberData[] = [
      createMember({ username: 'admin1', displayName: 'Admin One', isOnline: true, displayRole: { id: 'role-admin', name: 'Community Admin', position: 10 } }),
      createMember({ username: 'admin2', displayName: 'Admin Two', isOnline: false, displayRole: { id: 'role-admin', name: 'Community Admin', position: 10 } }),
      createMember({ username: 'mod1', displayName: 'Mod One', isOnline: true, displayRole: { id: 'role-mod', name: 'Moderator', position: 20 } }),
      createMember({ username: 'user1', displayName: 'User One', isOnline: true }),
      createMember({ username: 'user2', displayName: 'User Two', isOnline: false }),
    ];

    renderWithProviders(
      <MemberList members={members} title="Members" />,
    );

    // Check role section headers appear
    expect(screen.getByText(/Community Admin/)).toBeInTheDocument();
    expect(screen.getByText(/Moderator/)).toBeInTheDocument();
    expect(screen.getByText(/Online/)).toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('renders role sections in order of position (lowest first)', () => {
    const members: MemberData[] = [
      createMember({ username: 'mod1', displayRole: { id: 'role-mod', name: 'Moderator', position: 20 }, isOnline: true }),
      createMember({ username: 'admin1', displayRole: { id: 'role-admin', name: 'Community Admin', position: 10 }, isOnline: true }),
    ];

    renderWithProviders(
      <MemberList members={members} title="Members" />,
    );

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    const texts = items.map(item => item.textContent);

    // "Community Admin" header should appear before "Moderator" header
    const adminHeaderIndex = texts.findIndex(t => t?.includes('Community Admin'));
    const modHeaderIndex = texts.findIndex(t => t?.includes('Moderator'));
    expect(adminHeaderIndex).toBeLessThan(modHeaderIndex);
  });

  it('renders ungrouped members in Online/Offline sections', () => {
    const members: MemberData[] = [
      createMember({ username: 'online_user', displayName: 'Online User', isOnline: true }),
      createMember({ username: 'offline_user', displayName: 'Offline User', isOnline: false }),
    ];

    renderWithProviders(
      <MemberList members={members} title="Members" />,
    );

    // Should have Online and Offline section headers
    expect(screen.getByText(/Online — 1/)).toBeInTheDocument();
    expect(screen.getByText(/Offline — 1/)).toBeInTheDocument();
    expect(screen.getByText('Online User')).toBeInTheDocument();
    expect(screen.getByText('Offline User')).toBeInTheDocument();
  });

  it('shows loading skeletons when isLoading is true', () => {
    renderWithProviders(
      <MemberList members={[]} isLoading={true} title="Members" />,
    );

    // Loading state should show skeleton elements, not any section headers
    expect(screen.queryByText(/Online/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('shows error state with a retry, keeping the panel header', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <MemberList members={[]} error={new Error('fail')} title="Members" onRetry={onRetry} />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.queryByText('No members')).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no members', () => {
    renderWithProviders(
      <MemberList members={[]} title="Members" />,
    );

    expect(screen.getByText('No members')).toBeInTheDocument();
  });

  it('displays member count in title', () => {
    const members: MemberData[] = [
      createMember({ username: 'user1', isOnline: true }),
      createMember({ username: 'user2', isOnline: false }),
    ];

    renderWithProviders(
      <MemberList members={members} title="Members" />,
    );

    // Title should include count
    expect(screen.getByText(/Members — 2/)).toBeInTheDocument();
  });

  it('renders section header counts correctly', () => {
    const members: MemberData[] = [
      createMember({ username: 'admin1', displayRole: { id: 'r1', name: 'Admin', position: 10 }, isOnline: true }),
      createMember({ username: 'admin2', displayRole: { id: 'r1', name: 'Admin', position: 10 }, isOnline: true }),
      createMember({ username: 'user1', isOnline: true }),
    ];

    renderWithProviders(
      <MemberList members={members} title="Members" />,
    );

    // Admin section should show count of 2
    expect(screen.getByText(/Admin — 2/)).toBeInTheDocument();
    // Online section should show count of 1
    expect(screen.getByText(/Online — 1/)).toBeInTheDocument();
  });

  describe('MemberRow memoization', () => {
    it('re-renders only the member row whose object identity changed, not the whole list', () => {
      const memberA = createMember({ id: 'user-a', username: 'alice', displayName: 'Alice', isOnline: false });
      const memberB = createMember({ id: 'user-b', username: 'bob', displayName: 'Bob', isOnline: false });
      const memberC = createMember({ id: 'user-c', username: 'carol', displayName: 'Carol', isOnline: false });

      const { rerender } = renderWithProviders(
        <MemberList members={[memberA, memberB, memberC]} title="Members" />,
      );

      const renderCount = (id: string) =>
        vi.mocked(UserAvatar).mock.calls.filter((call) => call[0].userId === id).length;

      expect(renderCount('user-a')).toBe(1);
      expect(renderCount('user-b')).toBe(1);
      expect(renderCount('user-c')).toBe(1);

      // Simulate the identity-preserving merge: only member A gets a new
      // object (as an online-status change would produce); B and C keep the
      // exact same references they had before.
      const updatedMemberA = { ...memberA, isOnline: true };

      rerender(<MemberList members={[updatedMemberA, memberB, memberC]} title="Members" />);

      // Row A re-rendered (its underlying UserAvatar mock was invoked again)...
      expect(renderCount('user-a')).toBe(2);
      // ...but rows B and C, whose member objects are referentially
      // unchanged, were skipped entirely by React.memo(MemberRow).
      expect(renderCount('user-b')).toBe(1);
      expect(renderCount('user-c')).toBe(1);
    });
  });
});
