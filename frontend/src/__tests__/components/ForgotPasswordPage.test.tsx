import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import ForgotPasswordPage from '../../pages/ForgotPasswordPage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE_URL = 'http://localhost:3000';


describe('ForgotPasswordPage', () => {
  it('renders the email form', () => {
    renderWithProviders(<ForgotPasswordPage />);

    expect(screen.getByText('Forgot Password')).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /send reset link/i }),
    ).toBeInTheDocument();
  });

  it('shows the enumeration-safe success copy after submit, regardless of the email', async () => {
    server.use(
      http.post(`${BASE_URL}/api/auth/forgot-password`, () =>
        HttpResponse.json({
          message:
            'If an account with that email exists, a reset link has been sent.',
        }),
      ),
    );

    const { user } = renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/^email/i), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "If an account with that email exists, we've sent a reset link.",
        ),
      ).toBeInTheDocument();
    });

    // Form is replaced by the success message — no email field left to
    // resubmit, and the response never reveals whether the email existed.
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument();
  });

  it('sends the entered email in the request body', async () => {
    let requestBody: unknown;
    server.use(
      http.post(`${BASE_URL}/api/auth/forgot-password`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ message: 'ok' });
      }),
    );

    const { user } = renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(requestBody).toEqual({ email: 'user@example.com' });
    });
  });

  it('shows an error alert and keeps the form when the request fails', async () => {
    server.use(
      http.post(`${BASE_URL}/api/auth/forgot-password`, () =>
        HttpResponse.json({ message: 'Too many requests' }, { status: 429 }),
      ),
    );

    const { user } = renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
  });

  it('has a link back to login', () => {
    renderWithProviders(<ForgotPasswordPage />);

    expect(screen.getByLabelText('Back to login')).toBeInTheDocument();
  });
});
