import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import TimeoutDialog from '../../components/Moderation/TimeoutDialog';

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


describe('TimeoutDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
  });

  it('renders dialog with username in title', () => {
    renderWithProviders(<TimeoutDialog {...defaultProps} />);

    expect(screen.getByText('Timeout TestUser')).toBeInTheDocument();
  });

  it('shows reason field and duration radio options', () => {
    renderWithProviders(<TimeoutDialog {...defaultProps} />);

    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('60 seconds')).toBeInTheDocument();
    expect(screen.getByLabelText('5 minutes')).toBeInTheDocument();
    expect(screen.getByLabelText('10 minutes')).toBeInTheDocument();
    expect(screen.getByLabelText('1 hour')).toBeInTheDocument();
    expect(screen.getByLabelText('1 day')).toBeInTheDocument();
    expect(screen.getByLabelText('1 week')).toBeInTheDocument();
  });

  it('submits timeout and calls onClose on success', async () => {
    const { user } = renderWithProviders(<TimeoutDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /timeout user/i }));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when Cancel is clicked', async () => {
    const { user } = renderWithProviders(<TimeoutDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows error alert when mutation fails', async () => {
    server.use(
      http.post('http://localhost:3000/api/moderation/timeout/:communityId/:userId', () => {
        return HttpResponse.json({ message: 'Forbidden' }, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<TimeoutDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /timeout user/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
