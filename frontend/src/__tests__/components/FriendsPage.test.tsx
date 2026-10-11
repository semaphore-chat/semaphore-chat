import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';

const responsive = vi.hoisted(() => ({ isMobile: false, isTablet: false }));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => responsive,
}));

// The panel's own behaviour (tabs, lists, add dialog) is covered elsewhere;
// here we only need its props and a way to fire onSelectDmGroup.
const panelProps = vi.fn();
const shell = vi.hoisted(() => ({ width: null as number | null }));
vi.mock('../../components/Common/PageShell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/Common/PageShell')>()),
  useShellWidth: () => shell.width,
}));

vi.mock('../../components/Friends', () => ({
  AddFriendForm: () => <div role="group" aria-label="Add friend" />,
  FriendRequestList: () => <div data-testid="requests" />,
  FriendsPanel: (props: { onSelectDmGroup?: (id: string) => void; hideTitle?: boolean; layout?: string }) => {
    panelProps(props);
    return (
      <button onClick={() => props.onSelectDmGroup?.('dm-42')}>Message</button>
    );
  },
}));

import FriendsPage from '../../pages/FriendsPage';

const LocationProbe = () => <span data-testid="location">{useLocation().pathname + useLocation().search}</span>;

const renderPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="*" element={<><FriendsPage /><LocationProbe /></>} />
    </Routes>,
    { routerProps: { initialEntries: ['/friends'] } },
  );

describe('FriendsPage', () => {
  beforeEach(() => {
    panelProps.mockClear();
    responsive.isMobile = false;
    responsive.isTablet = false;
    shell.width = null;
  });

  it('desktop below 1200px of shell: one centred card with the tabbed panel', () => {
    shell.width = 1100;
    renderPage();
    expect(screen.getByTestId('friends-layout')).toHaveAttribute('data-layout', 'tabs');
    expect(panelProps.mock.lastCall?.[0].layout).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Add friend' })).not.toBeInTheDocument();
  });

  it('desktop from 1200px of shell: the list plus a side panel with add friend and pending requests', () => {
    shell.width = 1300;
    renderPage();
    expect(screen.getByTestId('friends-layout')).toHaveAttribute('data-layout', 'split');
    expect(panelProps.mock.lastCall?.[0].layout).toBe('list');
    const side = screen.getByRole('complementary', { name: 'Add friends and requests' });
    expect(side).toContainElement(screen.getByRole('group', { name: 'Add friend' }));
    expect(side).toContainElement(screen.getByTestId('requests'));
    expect(screen.getByRole('heading', { name: 'Pending requests' })).toBeInTheDocument();
  });

  it('"Message" opens the DM at /direct-messages/:id (there is no /dm route)', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/direct-messages\/dm-42$/);
  });

  it('desktop: in the list page shell (no floating card), with the panel title', () => {
    renderPage();
    expect(panelProps.mock.lastCall?.[0].hideTitle).toBeFalsy();
    expect(screen.getByTestId('list-page-shell')).toBeInTheDocument();
  });

  it.each([
    ['phone', { isMobile: true, isTablet: false }],
    ['tablet', { isMobile: false, isTablet: true }],
  ])('%s: fills the screen in normal flow (no absolute layer) and drops the duplicate title', (_label, flags) => {
    Object.assign(responsive, flags);
    const { container } = renderPage();
    const root = container.querySelector('.MuiPaper-root') as HTMLElement;
    expect(root).toHaveStyle({ height: '100%' });
    expect(root.parentElement).not.toHaveStyle({ position: 'absolute' });
    expect(panelProps).toHaveBeenLastCalledWith(expect.objectContaining({ hideTitle: true }));
  });
});
