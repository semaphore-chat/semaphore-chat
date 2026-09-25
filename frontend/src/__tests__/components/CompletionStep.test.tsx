import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createTestQueryClient } from '../test-utils';
import CompletionStep from '../../components/Onboarding/CompletionStep';
import { onboardingControllerGetStatusQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { OnboardingData } from '../../components/Onboarding/OnboardingWizard';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});


const mockData: OnboardingData = {
  adminUsername: 'admin',
  adminPassword: 'password123',
  adminEmail: 'admin@test.com',
  instanceName: 'Test Instance',
  instanceDescription: 'A test instance',
  defaultCommunityName: 'General',
  createDefaultCommunity: true,
  setupToken: 'test-token',
};

describe('CompletionStep', () => {
  it('invalidates onboarding status cache after successful setup', async () => {
    server.use(
      http.post('http://localhost:3000/api/onboarding/setup', () => {
        return HttpResponse.json({ success: true });
      }),
      http.post('http://localhost:3000/api/auth/login', () => {
        return HttpResponse.json({
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
        });
      }),
    );

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(onboardingControllerGetStatusQueryKey(), {
      needsSetup: true,
      setupToken: 'test-token',
    });

    const onComplete = vi.fn();

    const { user } = renderWithProviders(
      <CompletionStep
        data={mockData}
        updateData={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
      { queryClient },
    );

    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });

    const cachedStatus = queryClient.getQueryState(onboardingControllerGetStatusQueryKey());
    expect(cachedStatus?.isInvalidated).toBe(true);
  });

  it('invalidates cache even when auto-login fails', async () => {
    server.use(
      http.post('http://localhost:3000/api/onboarding/setup', () => {
        return HttpResponse.json({ success: true });
      }),
      http.post('http://localhost:3000/api/auth/login', () => {
        return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 });
      }),
    );

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(onboardingControllerGetStatusQueryKey(), {
      needsSetup: true,
      setupToken: 'test-token',
    });

    const onComplete = vi.fn();

    const { user } = renderWithProviders(
      <CompletionStep
        data={mockData}
        updateData={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
      { queryClient },
    );

    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });

    const cachedStatus = queryClient.getQueryState(onboardingControllerGetStatusQueryKey());
    expect(cachedStatus?.isInvalidated).toBe(true);
  });
});
