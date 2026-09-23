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
vi.mock('../../components/Friends', () => ({
  FriendsPanel: (props: { onSelectDmGroup?: (id: string) => void; hideTitle?: boolean }) => {
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
  });

  it('"Message" opens the DM at /direct-messages/:id (there is no /dm route)', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/direct-messages\/dm-42$/);
  });

  it('desktop: floating card with the panel title', () => {
    renderPage();
    expect(panelProps.mock.lastCall?.[0].hideTitle).toBeFalsy();
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
