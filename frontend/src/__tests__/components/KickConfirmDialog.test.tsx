import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import KickConfirmDialog from '../../components/Moderation/KickConfirmDialog';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  communityId: 'community-1',
  userId: 'user-target',
  userName: 'TestUser',
};


describe('KickConfirmDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
  });

  it('renders dialog with username in title', () => {
    renderWithProviders(<KickConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Kick TestUser')).toBeInTheDocument();
  });

  it('shows warning that user can rejoin', () => {
    renderWithProviders(<KickConfirmDialog {...defaultProps} />);

    expect(screen.getByText(/can rejoin/i)).toBeInTheDocument();
  });

  it('submits kick and calls onClose on success', async () => {
    const { user } = renderWithProviders(<KickConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /kick user/i }));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when Cancel is clicked', async () => {
    const { user } = renderWithProviders(<KickConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
