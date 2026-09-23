/**
 * Task 17 — MobileChatPanel on tablet: the back button can be hidden (the
 * sidebar is visible), and the member list is closed by default and opens as
 * an overlay drawer from the app bar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack: vi.fn(), navigateToSearch: vi.fn() }),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null } }),
}));
// Stage presence needs a VoiceProvider; not under test here.
vi.mock('../../hooks/useStagePresence', () => ({ useStagePresence: vi.fn() }));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel', 'ch-1'],
    queryFn: () => ({ id: 'ch-1', name: 'general', type: 'TEXT', communityId: 'c-1' }),
  }),
  directMessagesControllerFindDmGroupOptions: () => ({ queryKey: ['dm', ''], enabled: false }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));
vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));
vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: () => <div data-testid="direct-message-container" />,
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));

describe('MobileChatPanel on tablet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a back button by default (phone)', () => {
    renderWithProviders(<MobileChatPanel communityId="c-1" channelId="ch-1" />);
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });

  it('hides the back button with hideBack (tablet, sidebar visible)', () => {
    renderWithProviders(<MobileChatPanel communityId="c-1" channelId="ch-1" hideBack />);
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  it('keeps the member list closed by default and opens it as an overlay', async () => {
    const { user } = renderWithProviders(
      <MobileChatPanel communityId="c-1" channelId="ch-1" hideBack />,
    );
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Show members' }));

    const drawer = await screen.findByRole('presentation');
    expect(within(drawer).getByTestId('member-list')).toBeInTheDocument();
  });
});
