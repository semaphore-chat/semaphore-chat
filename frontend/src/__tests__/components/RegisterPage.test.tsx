import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import RegisterPage from '../../pages/RegisterPage';
import { getAccessToken } from '../../utils/tokenService';

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

describe('RegisterPage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockReset();
  });

  it('renders all form fields and login link', () => {
    renderWithProviders(<RegisterPage />);

    expect(screen.getByRole('heading', { name: /register/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/login');
  });

  it('registers, auto-logs in, and navigates on success', async () => {
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'INVITE');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(localStorage.getItem('accessToken')).toBe('mock-access-token');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('stores token as plain string readable by getAccessToken() (cross-module contract)', async () => {
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'INVITE');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
    // Verify it's NOT JSON-wrapped (the old bug)
    expect(localStorage.getItem('accessToken')!.startsWith('"')).toBe(false);
  });

  it('shows error alert on registration failure', async () => {
    server.use(
      http.post('http://localhost:3000/api/users', () => {
        return HttpResponse.json({ message: 'Registration failed' }, { status: 400 });
      })
    );

    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'BAD');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Registration failed');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows loading spinner during submission', async () => {
    server.use(
      http.post('http://localhost:3000/api/users', async () => {
        await new Promise(r => setTimeout(r, 100));
        return HttpResponse.json({ id: 'u1', username: 'newuser', email: 'new@test.com' });
      })
    );

    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'INVITE');
    await user.click(screen.getByRole('button', { name: /register/i }));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});
