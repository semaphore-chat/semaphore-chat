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
});
