import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import OnboardingPage from '../../pages/OnboardingPage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const status = (body: Record<string, unknown>) =>
  server.use(http.get('http://localhost:3000/api/onboarding/status', () => HttpResponse.json(body)));

describe('OnboardingPage', () => {
  it('opens the wizard when the server requires the token and does not send it', async () => {
    status({ needsSetup: true, hasUsers: false, setupTokenRequired: true });

    renderWithProviders(<OnboardingPage />);

    expect(await screen.findByRole('button', { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByText(/setup token is missing/i)).not.toBeInTheDocument();
  });

  it('still opens the wizard for a server that sends the token (REQUIRE_SETUP_TOKEN=false)', async () => {
    status({ needsSetup: true, hasUsers: false, setupTokenRequired: false, setupToken: 't' });

    renderWithProviders(<OnboardingPage />);

    expect(await screen.findByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('reports a missing token when the server neither requires nor sends one', async () => {
    status({ needsSetup: true, hasUsers: false });

    renderWithProviders(<OnboardingPage />);

    expect(await screen.findByText(/setup token is missing/i)).toBeInTheDocument();
  });
});
