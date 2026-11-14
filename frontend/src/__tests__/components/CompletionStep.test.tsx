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
  setupTokenRequired: false,
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

  describe('setup token from the backend log', () => {
    const requiredData: OnboardingData = {
      ...mockData,
      setupToken: '',
      setupTokenRequired: true,
    };

    const renderStep = (data: OnboardingData) => {
      const updateData = vi.fn();
      const view = renderWithProviders(
        <CompletionStep
          data={data}
          updateData={updateData}
          onNext={vi.fn()}
          onBack={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
      return { ...view, updateData };
    };

    it('asks for the token and says where to find it', () => {
      renderStep(requiredData);

      expect(screen.getByLabelText(/setup token/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Setup token:/).length).toBeGreaterThan(0);
      expect(screen.getByText(/SETUP_TOKEN/)).toBeInTheDocument();
    });

    it('keeps Complete Setup disabled until a token is entered', () => {
      renderStep({ ...requiredData, setupToken: '   ' });

      expect(
        screen.getByRole('button', { name: /complete setup/i }),
      ).toBeDisabled();
    });

    it('stores what the operator types', async () => {
      const { user, updateData } = renderStep(requiredData);

      await user.type(screen.getByLabelText(/setup token/i), 'a');

      expect(updateData).toHaveBeenCalledWith({ setupToken: 'a' });
    });

    it('sends the pasted token without surrounding whitespace', async () => {
      let sentToken: unknown;
      server.use(
        http.post(
          'http://localhost:3000/api/onboarding/setup',
          async ({ request }) => {
            sentToken = ((await request.json()) as { setupToken: string })
              .setupToken;
            return HttpResponse.json({ success: true });
          },
        ),
        http.post('http://localhost:3000/api/auth/login', () =>
          HttpResponse.json({ accessToken: 'a', refreshToken: 'r' }),
        ),
      );
      const { user } = renderStep({
        ...requiredData,
        setupToken: '  pasted-token\n',
      });

      await user.click(screen.getByRole('button', { name: /complete setup/i }));

      await waitFor(() => expect(sentToken).toBe('pasted-token'));
    });

    it('explains a wrong token instead of a bare error', async () => {
      server.use(
        http.post('http://localhost:3000/api/onboarding/setup', () =>
          HttpResponse.json(
            { message: 'Invalid setup token', statusCode: 409 },
            { status: 409 },
          ),
        ),
      );
      const { user } = renderStep({ ...requiredData, setupToken: 'wrong' });

      await user.click(screen.getByRole('button', { name: /complete setup/i }));

      expect(
        await screen.findByText(/doesn't match the token in the backend log/i),
      ).toBeInTheDocument();
    });

    it('shows no token field when the server sends the token itself', () => {
      renderStep(mockData);

      expect(screen.queryByLabelText(/setup token/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /complete setup/i }),
      ).toBeEnabled();
    });
  });
});
