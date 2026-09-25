import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MobileAppBar from '../../components/Mobile/MobileAppBar';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack: vi.fn(), openDrawer: vi.fn() }),
}));

describe('MobileAppBar title', () => {
  it('shows the title', () => {
    renderWithProviders(<MobileAppBar title="general" showBack />);

    expect(screen.getByRole('heading', { name: 'general' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows a skeleton in place of the title while it loads', () => {
    renderWithProviders(<MobileAppBar title="" titleLoading showBack />);

    expect(screen.getByRole('progressbar', { name: 'Loading title' })).toBeInTheDocument();
    // The chrome around the title stays put.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });
});
