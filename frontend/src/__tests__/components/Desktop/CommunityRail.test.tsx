import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils';
import CommunityToggle from '../../../components/CommunityList/CommunityToggle';
import { RAIL_EXPANDED_WIDTH, SIDEBAR_WIDTH, VOICE_BAR_HEIGHT } from '../../../constants/layout';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockUnread = 0;
let mockCommunities: ({ id: string; name: string } | null)[] = [];
const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/logger', () => ({ logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), log: vi.fn() } }));
vi.mock('../../../api-client/@tanstack/react-query.gen', () => ({
  communityControllerFindAllMineOptions: () => ({
    queryKey: ['test-communities'],
    queryFn: async () => mockCommunities,
  }),
  notificationsControllerGetUnreadCountOptions: () => ({
    queryKey: ['test-unread', mockUnread],
    queryFn: async () => ({ count: mockUnread }),
  }),
}));

vi.mock('../../../components/CommunityList/CommunityListItem', () => ({
  default: ({ community }: { community: { name: string } }) => <div>{community.name}</div>,
}));
vi.mock('../../../components/Desktop/RailUserMenu', () => ({
  RailUserMenu: () => <button>Account menu</button>,
}));
let mockCanCreate = true;
vi.mock('../../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: () => mockCanCreate,
}));
let mockDmUnread = 0;
vi.mock('../../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ totalDmUnreadCount: mockDmUnread }),
}));

function renderRail(props: Partial<React.ComponentProps<typeof CommunityToggle>> = {}) {
  const onToggleExpanded = vi.fn();
  const onOpenNotifications = vi.fn();
  const utils = renderWithProviders(
    <CommunityToggle
      isExpanded={false}
      onToggleExpanded={onToggleExpanded}
      onOpenNotifications={onOpenNotifications}
      voiceConnected={false}
      user={undefined}
      {...props}
    />,
  );
  return { ...utils, onToggleExpanded, onOpenNotifications };
}

const railPaper = () => document.querySelector('.MuiDrawer-paper') as HTMLElement;

describe('Desktop community rail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnread = 0;
    mockDmUnread = 0;
    mockCanCreate = true;
    mockCommunities = [{ id: 'c1', name: 'Nightowl Collective' }];
  });

  it('puts Direct Messages, then the notification inbox, at the top', async () => {
    const { user, onOpenNotifications } = renderRail();
    const dm = screen.getByRole('button', { name: 'Direct Messages' });
    const inbox = screen.getByRole('button', { name: 'Notifications, 0 unread' });
    expect(dm.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText('Nightowl Collective')).toBeInTheDocument();

    await user.click(dm);
    expect(mockNavigate).toHaveBeenCalledWith('/direct-messages');
    await user.click(inbox);
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  it('shows the unread notification count on the inbox (capped at 99+)', async () => {
    mockUnread = 150;
    renderRail();
    const inbox = await screen.findByRole('button', { name: 'Notifications, 150 unread' });
    expect(inbox).toHaveTextContent('99+');
  });

  it('has the expand toggle and the account menu at the foot', async () => {
    const { user, onToggleExpanded } = renderRail();
    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const account = screen.getByRole('button', { name: 'Account menu' });
    expect(toggle.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(toggle);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it('expands into a 160px labelled list', () => {
    renderRail({ isExpanded: true });
    expect(railPaper()).toHaveStyle({ width: `${RAIL_EXPANDED_WIDTH}px` });
    expect(screen.getByText('Messages')).toBeVisible();
    expect(screen.getByText('Notifications')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('is 80px collapsed, full height with no app bar above it', () => {
    renderRail();
    expect(railPaper()).toHaveStyle({ width: `${SIDEBAR_WIDTH}px`, top: '0px' });
  });

  it('stops above the voice bar in a call', () => {
    // jsdom drops calc(var(...)) values, so read the emitted CSS.
    const cssText = () => Array.from(document.querySelectorAll('style')).map((el) => el.textContent).join('\n');
    renderRail({ voiceConnected: true });
    expect(cssText()).toContain(`height:calc(var(--full-dvh) - ${VOICE_BAR_HEIGHT}px)`);
  });

  it('skips a null community entry (and logs it) instead of crashing', async () => {
    mockCommunities = [null, { id: 'c1', name: 'Nightowl Collective' }];
    renderRail();
    expect(await screen.findByText('Nightowl Collective')).toBeInTheDocument();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('skipped 1 null community'));
  });

  describe('with no communities', () => {
    beforeEach(() => {
      mockCommunities = [];
    });

    it('relies on the create button when the user may create one', async () => {
      renderRail();
      expect(await screen.findByRole('button', { name: /create/i })).toBeInTheDocument();
      expect(screen.queryByText(/no communities/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Not in any communities yet' })).not.toBeInTheDocument();
    });

    it('shows an icon with a label in the collapsed rail when the user cannot create one', async () => {
      mockCanCreate = false;
      renderRail();
      expect(await screen.findByRole('img', { name: 'Not in any communities yet' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
    });

    it('shows readable text in the expanded rail when the user cannot create one', async () => {
      mockCanCreate = false;
      renderRail({ isExpanded: true });
      expect(await screen.findByText('No communities yet')).toBeInTheDocument();
    });
  });
});
