import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import RegisterPage from '../../pages/RegisterPage';
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

const useMode = (registrationMode: string | null) =>
  server.use(
    http.get('http://localhost:3000/api/instance/settings/public', () =>
      registrationMode === null
        ? HttpResponse.json({ message: 'boom' }, { status: 500 })
        : HttpResponse.json({
            name: 'Test',
            registrationMode,
            maxFileSizeBytes: 1,
            gifSearchEnabled: false,
            passwordResetEnabled: false,
          }),
    ),
  );

/** Captures the body POSTed to /api/users. */
const captureRegisterBody = () => {
  const calls: Record<string, unknown>[] = [];
  server.use(
    http.post('http://localhost:3000/api/users', async ({ request }) => {
      calls.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'u1', username: 'newuser' });
    }),
  );
  return calls;
};

const fillAndSubmit = async (
  user: ReturnType<typeof renderWithProviders>['user'],
  code?: string,
) => {
  await user.type(await screen.findByLabelText(/username/i), 'newuser');
  await user.type(screen.getByLabelText(/email/i), 'new@test.com');
  await user.type(screen.getByLabelText(/password/i), 'pass123');
  if (code) await user.type(screen.getByLabelText(/code/i), code);
  await user.click(screen.getByRole('button', { name: /register/i }));
};

describe('RegisterPage registration mode', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockNavigate.mockReset();
  });

  it('shows a progress indicator and no form while the mode is loading', () => {
    server.use(
      http.get('http://localhost:3000/api/instance/settings/public', async () => {
        await new Promise(() => {});
      }),
    );
    renderWithProviders(<RegisterPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it('CLOSED: shows a closed message and a sign-in link, no form', async () => {
    useMode('CLOSED');
    renderWithProviders(<RegisterPage />);
    expect(await screen.findByText(/registration is closed on this server/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/login');
  });

  it('INVITE_ONLY: the code field is required', async () => {
    useMode('INVITE_ONLY');
    renderWithProviders(<RegisterPage />);
    expect(await screen.findByLabelText(/^code/i)).toBeRequired();
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
  });

  it('INVITE_ONLY: an empty code blocks submit', async () => {
    useMode('INVITE_ONLY');
    const calls = captureRegisterBody();
    const { user } = renderWithProviders(<RegisterPage />);
    await fillAndSubmit(user);
    expect(calls).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('INVITE_ONLY: sends the code', async () => {
    useMode('INVITE_ONLY');
    const calls = captureRegisterBody();
    const { user } = renderWithProviders(<RegisterPage />);
    await fillAndSubmit(user, 'INVITE');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
    expect(calls[0]).toMatchObject({ code: 'INVITE' });
  });

  it('OPEN: the code field is labelled optional and not required', async () => {
    useMode('OPEN');
    renderWithProviders(<RegisterPage />);
    const field = await screen.findByLabelText(/code \(optional\)/i);
    expect(field).not.toBeRequired();
  });

  it('OPEN: submits without a code and omits it from the request', async () => {
    useMode('OPEN');
    const calls = captureRegisterBody();
    const { user } = renderWithProviders(<RegisterPage />);
    await fillAndSubmit(user);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('code');
  });

  it('OPEN: sends the code when one is entered', async () => {
    useMode('OPEN');
    const calls = captureRegisterBody();
    const { user } = renderWithProviders(<RegisterPage />);
    await fillAndSubmit(user, 'INVITE');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
    expect(calls[0]).toMatchObject({ code: 'INVITE' });
  });

  it('settings request fails: falls back to a required code', async () => {
    useMode(null);
    renderWithProviders(<RegisterPage />);
    expect(await screen.findByLabelText(/^code/i)).toBeRequired();
  });
});

describe('RegisterPage', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockNavigate.mockReset();
  });

  it('renders all form fields and login link', async () => {
    renderWithProviders(<RegisterPage />);

    expect(await screen.findByRole('heading', { name: /register/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/login');
  });

  it('registers, auto-logs in, and navigates on success', async () => {
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(await screen.findByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'INVITE');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('stores token as plain string readable by getAccessToken() (cross-module contract)', async () => {
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(await screen.findByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@test.com');
    await user.type(screen.getByLabelText(/password/i), 'pass123');
    await user.type(screen.getByLabelText(/code/i), 'INVITE');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
  });

  it('shows error alert on registration failure', async () => {
    server.use(
      http.post('http://localhost:3000/api/users', () => {
        return HttpResponse.json({ message: 'Registration failed' }, { status: 400 });
      })
    );

    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(await screen.findByLabelText(/username/i), 'newuser');
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

    await user.type(await screen.findByLabelText(/username/i), 'newuser');
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
