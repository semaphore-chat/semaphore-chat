import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import ResetPasswordDialog from '../../components/admin/ResetPasswordDialog';
import type { AdminUserEntity } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const targetUser = {
  id: 'user-target',
  username: 'forgetful',
  displayName: 'Forgetful Fred',
  role: 'USER',
  banned: false,
} as AdminUserEntity;

const defaultProps = {
  user: targetUser,
  onClose: vi.fn(),
};


describe('ResetPasswordDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
    server.use(
      http.patch('http://localhost:3000/api/users/admin/:id/password', () =>
        HttpResponse.json({ ...targetUser }),
      ),
    );
  });

  it('renders with the user name in the title', () => {
    renderWithProviders(<ResetPasswordDialog {...defaultProps} />);

    expect(
      screen.getByText('Reset Password for Forgetful Fred'),
    ).toBeInTheDocument();
  });

  it('does not render when user is null', () => {
    renderWithProviders(<ResetPasswordDialog user={null} onClose={vi.fn()} />);

    expect(screen.queryByText(/reset password for/i)).not.toBeInTheDocument();
  });

  it('disables submit until passwords are valid and matching', async () => {
    const { user } = renderWithProviders(<ResetPasswordDialog {...defaultProps} />);
    const submit = screen.getByRole('button', { name: /reset password/i });

    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('New password'), 'short');
    expect(submit).toBeDisabled();
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'long-enough-password');
    await user.type(screen.getByLabelText('Confirm password'), 'different-password');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-password');
    expect(submit).toBeEnabled();
  });

  it('rejects passwords longer than the backend limit of 128 chars', () => {
    renderWithProviders(<ResetPasswordDialog {...defaultProps} />);
    const tooLong = 'a'.repeat(129);

    // maxLength blocks typing past 128, so set the value programmatically to
    // exercise the validation fallback
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: tooLong },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: tooLong },
    });

    expect(screen.getByText('Must be at most 128 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
  });

  it('fills both fields with a generated password and reveals it', async () => {
    const { user } = renderWithProviders(<ResetPasswordDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /generate password/i }));

    const passwordField = screen.getByLabelText('New password') as HTMLInputElement;
    const confirmField = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(passwordField.value).toHaveLength(16);
    expect(confirmField.value).toBe(passwordField.value);
    expect(passwordField.type).toBe('text');
    expect(screen.getByRole('button', { name: /reset password/i })).toBeEnabled();
  });

  it('submits the new password and shows success', async () => {
    let requestBody: unknown;
    server.use(
      http.patch(
        'http://localhost:3000/api/users/admin/:id/password',
        async ({ request, params }) => {
          requestBody = await request.json();
          expect(params.id).toBe('user-target');
          return HttpResponse.json({ ...targetUser });
        },
      ),
    );

    const { user } = renderWithProviders(<ResetPasswordDialog {...defaultProps} />);

    await user.type(screen.getByLabelText('New password'), 'brand-new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'brand-new-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    });
    expect(requestBody).toEqual({ password: 'brand-new-password' });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('shows an error alert when the request fails', async () => {
    server.use(
      http.patch('http://localhost:3000/api/users/admin/:id/password', () =>
        HttpResponse.json(
          { message: "Only an instance owner can reset another owner's password" },
          { status: 403 },
        ),
      ),
    );

    const { user } = renderWithProviders(<ResetPasswordDialog {...defaultProps} />);

    await user.type(screen.getByLabelText('New password'), 'brand-new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'brand-new-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument();
  });

  it('calls onClose and resets state when Cancel is clicked', async () => {
    const { user } = renderWithProviders(<ResetPasswordDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
