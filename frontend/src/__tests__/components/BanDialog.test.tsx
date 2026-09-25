import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import BanDialog from '../../components/Moderation/BanDialog';

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


describe('BanDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
  });

  it('renders dialog with username in title when open', () => {
    renderWithProviders(<BanDialog {...defaultProps} />);

    expect(screen.getByText('Ban TestUser')).toBeInTheDocument();
  });

  it('does not render dialog content when open is false', () => {
    renderWithProviders(<BanDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Ban TestUser')).not.toBeInTheDocument();
  });

  it('shows reason text field', () => {
    renderWithProviders(<BanDialog {...defaultProps} />);

    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();
  });

  it('shows duration type radio buttons', () => {
    renderWithProviders(<BanDialog {...defaultProps} />);

    expect(screen.getByLabelText('Temporary')).toBeInTheDocument();
    expect(screen.getByLabelText('Permanent')).toBeInTheDocument();
  });

  it('shows duration options when Temporary is selected', async () => {
    const { user } = renderWithProviders(<BanDialog {...defaultProps} />);

    await user.click(screen.getByLabelText('Temporary'));

    expect(screen.getByLabelText('1 hour')).toBeInTheDocument();
    expect(screen.getByLabelText('1 day')).toBeInTheDocument();
    expect(screen.getByLabelText('1 week')).toBeInTheDocument();
    expect(screen.getByLabelText('1 month')).toBeInTheDocument();
  });

  it('submits permanent ban and calls onClose on success', async () => {
    const { user } = renderWithProviders(<BanDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /ban user/i }));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('shows error alert when mutation fails', async () => {
    server.use(
      http.post('http://localhost:3000/api/moderation/ban/:communityId/:userId', () => {
        return HttpResponse.json({ message: 'Forbidden' }, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<BanDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /ban user/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
