/**
 * The members button + drawer for the desktop layout in a narrow window.
 * Electron is always the desktop layout, and below 1024px there is no room
 * for the inline member column (MessageContainerMemberColumn.test.tsx), so
 * the chat headers offer the list as a drawer. Nowhere else: a browser that
 * narrow gets the phone/tablet layout with its own app bar button, and wide
 * desktop windows keep the inline column.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MemberListDrawerButton } from '../../components/Message/MemberListDrawerButton';
import { DMChatHeader } from '../../components/DirectMessages/DMChatHeader';
import { VoiceSessionType } from '../../contexts/VoiceContext';

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

const memberListProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: (props: Record<string, unknown>) => {
    memberListProps.last = props;
    return <div data-testid="member-list" />;
  },
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, contextType: null, currentDmGroupId: null },
    actions: { joinDmVoice: vi.fn(), leaveVoiceChannel: vi.fn(), toggleVideo: vi.fn(), revealVideoTiles: vi.fn() },
  }),
}));

/** matchMedia that evaluates min-/max-width queries against `width`. */
function stubViewportWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (min || max) && !query.includes('pointer') && !query.includes('hover')
          ? (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
          : false;
      return {
        matches: !!matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
}

const renderButton = () =>
  renderWithProviders(
    <MemberListDrawerButton
      contextType={VoiceSessionType.Channel}
      contextId="ch-1"
      communityId="c-1"
      isPrivate
    />,
  );

beforeEach(() => {
  platform.electron = false;
  memberListProps.last = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemberListDrawerButton', () => {
  it.each([800, 820, 1023])('in an Electron window %ipx wide, opens the member list in a drawer', async (width) => {
    platform.electron = true;
    stubViewportWidth(width);
    const { user } = renderButton();
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show members' }));

    const drawer = screen.getByTestId('member-list').closest('.MuiDrawer-paper') as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(within(drawer).getByText('Members')).toBeInTheDocument();
    expect(memberListProps.last).toMatchObject({
      contextType: VoiceSessionType.Channel,
      contextId: 'ch-1',
      communityId: 'c-1',
      isPrivate: true,
      fullWidth: true,
    });
  });

  it('closes the drawer from its close button', async () => {
    platform.electron = true;
    stubViewportWidth(820);
    const { user } = renderButton();
    await user.click(screen.getByRole('button', { name: 'Show members' }));
    await user.click(screen.getByRole('button', { name: 'Close members' }));
    await vi.waitFor(() => expect(screen.queryByTestId('member-list')).not.toBeInTheDocument());
  });

  it.each([1024, 1199, 1440])('renders nothing in an Electron window %ipx wide (inline column)', (width) => {
    platform.electron = true;
    stubViewportWidth(width);
    renderButton();
    expect(screen.queryByRole('button', { name: 'Show members' })).not.toBeInTheDocument();
  });

  it.each([390, 820, 1100, 1440])('renders nothing in a browser %ipx wide', (width) => {
    stubViewportWidth(width);
    renderButton();
    expect(screen.queryByRole('button', { name: 'Show members' })).not.toBeInTheDocument();
  });
});

describe('DMChatHeader members button', () => {
  it('is offered in a narrow Electron window, for the DM', async () => {
    platform.electron = true;
    stubViewportWidth(820);
    const { user } = renderWithProviders(<DMChatHeader dmGroupId="dm-1" dmGroupName="Bob Builder" />);
    await user.click(screen.getByRole('button', { name: 'Show members' }));
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
    expect(memberListProps.last).toMatchObject({ contextType: VoiceSessionType.Dm, contextId: 'dm-1' });
  });

  it('is not offered for an unavailable conversation', () => {
    platform.electron = true;
    stubViewportWidth(820);
    renderWithProviders(<DMChatHeader dmGroupId="dm-1" unavailable />);
    expect(screen.queryByRole('button', { name: 'Show members' })).not.toBeInTheDocument();
  });
});
