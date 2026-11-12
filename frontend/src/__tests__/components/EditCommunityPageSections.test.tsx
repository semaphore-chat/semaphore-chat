/**
 * Community settings sections. On desktop the nine sections are a vertical
 * tablist beside the column (FormPageShell navMode="tabs"); on phone/tablet
 * they are MUI Tabs. Either way they must stay real tabs: users of assistive
 * tech (and the release E2E, `getByRole('tab', { name: 'Channels' })`) pick a
 * section by its tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';

const responsive = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => responsive }));

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-client/@tanstack/react-query.gen')>()),
  communityControllerFindOneOptions: () => ({
    queryKey: ['test-community'],
    queryFn: async () => ({ id: 'c1', name: 'Nightowl Collective', description: null, avatar: null, banner: null }),
  }),
  channelsControllerFindAllForCommunityOptions: () => ({ queryKey: ['test-channels'], queryFn: async () => [] }),
}));
const permissions = vi.hoisted(() => ({ held: [] as string[] }));
vi.mock('../../features/roles/useUserPermissions', () => ({
  useUserPermissions: ({ actions }: { actions: string[] }) => ({
    hasPermissions: actions.every((action) => permissions.held.includes(action)),
  }),
}));
vi.mock('../../components/Community', () => {
  const stub = (name: string) => () => <div>{name} section</div>;
  return {
    CommunitySettingsForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
    CommunityFormContent: stub('Settings form'),
    MemberManagement: stub('Members'),
    ChannelManagement: stub('Channels'),
    PrivateChannelMembership: stub('Private channels'),
    RoleManagement: stub('Roles'),
    AliasGroupManagement: stub('Mention groups'),
    CustomEmojiManagement: stub('Custom emoji'),
    SoundboardManagement: stub('Soundboard'),
  };
});
vi.mock('../../components/Moderation', () => ({
  BanListPanel: () => <div>Ban list section</div>,
  TimeoutListPanel: () => <div>Timeout list section</div>,
  ModerationLogsPanel: () => <div>Logs section</div>,
}));

import EditCommunityPage from '../../pages/EditCommunityPage';

const renderPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/community/:communityId/edit" element={<EditCommunityPage />} />
    </Routes>,
    { routerProps: { initialEntries: ['/community/c1/edit'] } },
  );

describe('EditCommunityPage sections', () => {
  beforeEach(() => {
    responsive.isDesktop = true;
    permissions.held = [
      'UPDATE_COMMUNITY',
      'READ_MEMBER',
      'CREATE_CHANNEL',
      'VIEW_BAN_LIST',
      'TIMEOUT_USER',
      'MANAGE_EMOJIS',
    ];
  });

  it.each([
    ['desktop (section nav)', true],
    ['phone/tablet (MUI tabs)', false],
  ])('%s: "Channels" is a tab that shows the channel management section', async (_label, desktop) => {
    responsive.isDesktop = desktop;
    const { user } = renderPage();
    const channels = await screen.findByRole('tab', { name: 'Channels' });
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await user.click(channels);
    expect(channels).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Channels section');
  });

  it('a moderator who may only set timeouts sees the timeout list, not the ban list or the logs (#688)', async () => {
    permissions.held = ['TIMEOUT_USER'];
    const { user } = renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Moderation' }));

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Timeout list section');
    expect(panel).not.toHaveTextContent('Ban list section');
    expect(panel).not.toHaveTextContent('Logs section');
  });

  it('a ban-list viewer still sees the ban list, the timeouts and the logs', async () => {
    permissions.held = ['VIEW_BAN_LIST'];
    const { user } = renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Moderation' }));

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Ban list section');
    expect(panel).toHaveTextContent('Timeout list section');
    expect(panel).toHaveTextContent('Logs section');
  });

  it('desktop: the shown section is a tab panel named by its tab, with the section as the title', async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Members' }));
    expect(screen.getByRole('tabpanel', { name: 'Members' })).toHaveTextContent('Members section');
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
  });
});
