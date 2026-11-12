import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import AdminSettingsPage from '../../pages/admin/AdminSettingsPage';
import type { InstanceSettingsResponseDto } from '../../api-client/types.gen';

// vi.mock factories are hoisted above imports, so the client must be loaded
// inside the factory. Same pattern as the other generated-client tests.
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

const settings = (
  overrides: Partial<InstanceSettingsResponseDto> = {},
): InstanceSettingsResponseDto => ({
  id: 'settings-1',
  name: 'Semaphore Chat',
  description: null,
  registrationMode: 'INVITE_ONLY',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  defaultStorageQuotaBytes: 50 * 1024 ** 3,
  maxFileSizeBytes: 500 * 1024 ** 2,
  vapidPublicKey: null,
  vapidSubject: null,
  ...overrides,
});

describe('AdminSettingsPage', () => {
  it('keeps the storage inputs inside the server bounds', async () => {
    server.use(
      http.get(`${API}/instance/settings`, () => HttpResponse.json(settings())),
    );

    renderWithProviders(<AdminSettingsPage />);

    const quota = await screen.findByLabelText('Default Storage Quota');
    const fileSize = screen.getByLabelText('Maximum File Size');

    expect(quota).toHaveAttribute('min', '1');
    expect(fileSize).toHaveAttribute('min', '1');
    expect(fileSize).toHaveAttribute('max', '1024');
  });

  it("shows the server's validation message when a value is out of bounds", async () => {
    server.use(
      http.get(`${API}/instance/settings`, () => HttpResponse.json(settings())),
      http.patch(`${API}/instance/settings`, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['maxFileSizeBytes must not be less than 1048576'],
            error: 'Bad Request',
          },
          { status: 400 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AdminSettingsPage />);

    const fileSize = await screen.findByLabelText('Maximum File Size');
    await user.clear(fileSize);
    await user.type(fileSize, '0');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(
        screen.getByText('maxFileSizeBytes must not be less than 1048576'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Failed to save settings')).not.toBeInTheDocument();
  });
});
