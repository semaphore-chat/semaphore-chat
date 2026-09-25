import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import LoginPage from '../../pages/LoginPage';
import { getAccessToken, clearTokens } from '../../utils/tokenService';

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

describe('LoginPage', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockNavigate.mockReset();
  });

  it('renders login form with heading, fields, and register link', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /register/i })).toHaveAttribute('href', '/register');
  });

  it('stores tokens and navigates on successful login', async () => {
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
    expect(localStorage.getItem('refreshToken')).toBe('mock-refresh-token');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('stores token as plain string readable by getAccessToken() (cross-module contract)', async () => {
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
  });

  it('shows error alert on failed login', async () => {
    server.use(
      http.post('http://localhost:3000/api/auth/login', () => {
        return HttpResponse.json({ message: 'Invalid' }, { status: 401 });
      })
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'baduser');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Login failed. Please try again.');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not show a "Forgot password?" link when the feature is disabled', async () => {
    server.use(
      http.get('http://localhost:3000/api/instance/settings/public', () =>
        HttpResponse.json({
          name: 'Semaphore Chat',
          registrationMode: 'OPEN',
          maxFileSizeBytes: 524288000,
          passwordResetEnabled: false,
        }),
      ),
    );

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.queryByLabelText('Forgot password?')).not.toBeInTheDocument();
    });
  });

  it('shows a "Forgot password?" link when the feature is enabled', async () => {
    server.use(
      http.get('http://localhost:3000/api/instance/settings/public', () =>
        HttpResponse.json({
          name: 'Semaphore Chat',
          registrationMode: 'OPEN',
          maxFileSizeBytes: 524288000,
          passwordResetEnabled: true,
        }),
      ),
    );

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Forgot password?')).toHaveAttribute(
        'href',
        '/forgot-password',
      );
    });
  });

  it('shows loading spinner during submission', async () => {
    // Delay the response to catch the loading state
    server.use(
      http.post('http://localhost:3000/api/auth/login', async () => {
        await new Promise(r => setTimeout(r, 100));
        return HttpResponse.json({ accessToken: 'tok', refreshToken: 'rtok' });
      })
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('after the server signed the user out', () => {
    const renderSignedOut = (signOutReason?: string) =>
      renderWithProviders(<LoginPage />, {
        routerProps: {
          initialEntries: [{ pathname: '/login', state: { signOutReason } }],
        },
      });

    it.each([
      ['PASSWORD_CHANGED', 'Your password was changed, so you were signed out. Sign in with the new password.'],
      ['ACCOUNT_BANNED', 'You were signed out because this account was banned.'],
      ['ACCOUNT_DELETED', 'You were signed out because this account was deleted.'],
    ])('explains %s', (reason, message) => {
      renderSignedOut(reason);

      expect(screen.getByRole('status')).toHaveTextContent(message);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each(['LOGGED_OUT', 'SESSION_REVOKED', 'TOKEN_EXPIRED', undefined])(
      'says nothing for %s',
      (reason) => {
        renderSignedOut(reason);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
    );

    it('shows a failed login instead of the reason', async () => {
      server.use(
        http.post('http://localhost:3000/api/auth/login', () =>
          HttpResponse.json({ message: 'Invalid' }, { status: 401 }),
        ),
      );
      const { user } = renderSignedOut('PASSWORD_CHANGED');

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'old-password');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Login failed');
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
