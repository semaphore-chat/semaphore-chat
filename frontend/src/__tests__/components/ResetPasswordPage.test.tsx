import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import ResetPasswordPage from '../../pages/ResetPasswordPage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const BASE_URL = 'http://localhost:3000';

const renderWithToken = (token = 'raw-reset-token') =>
  renderWithProviders(<ResetPasswordPage />, {
    routerProps: { initialEntries: [`/reset-password?token=${token}`] },
  });


beforeEach(() => {
  mockNavigate.mockReset();
});

describe('ResetPasswordPage', () => {
  it('reads the token from the URL and renders the form', () => {
    renderWithToken('abc123');

    expect(
      screen.getByRole('heading', { name: 'Reset Password' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^confirm new password/i)).toBeInTheDocument();
  });

  it('shows an error and a link to request a new link when no token is present', () => {
    renderWithProviders(<ResetPasswordPage />, {
      routerProps: { initialEntries: ['/reset-password'] },
    });

    expect(
      screen.getByText('This reset link is missing or invalid.'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Request a new reset link'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it('disables submit until passwords are valid and matching', async () => {
    const { user } = renderWithToken();
    const submit = screen.getByRole('button', { name: /reset password/i });

    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^new password/i), 'short');
    expect(submit).toBeDisabled();
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), 'long-enough-password');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'different-password');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText(/^confirm new password/i));
    await user.type(screen.getByLabelText(/^confirm new password/i), 'long-enough-password');
    expect(submit).toBeEnabled();
  });

  it('submits the token and new password, then shows success and navigates to login', async () => {
    let requestBody: unknown;
    server.use(
      http.post(`${BASE_URL}/api/auth/reset-password`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ message: 'Password has been reset.' });
      }),
    );

    const { user } = renderWithToken('the-raw-token');

    await user.type(screen.getByLabelText(/^new password/i), 'brand-new-password');
    await user.type(
      screen.getByLabelText(/^confirm new password/i),
      'brand-new-password',
    );
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password has been reset/i)).toBeInTheDocument();
    });
    expect(requestBody).toEqual({
      token: 'the-raw-token',
      newPassword: 'brand-new-password',
    });

    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      },
      { timeout: 3000 },
    );
  });

  it('shows a generic error and a link to request a new link on an invalid/expired/used token (400)', async () => {
    server.use(
      http.post(`${BASE_URL}/api/auth/reset-password`, () =>
        HttpResponse.json(
          { message: 'Invalid or expired reset token' },
          { status: 400 },
        ),
      ),
    );

    const { user } = renderWithToken('bad-token');

    await user.type(screen.getByLabelText(/^new password/i), 'brand-new-password');
    await user.type(
      screen.getByLabelText(/^confirm new password/i),
      'brand-new-password',
    );
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText('Request a new reset link'),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
