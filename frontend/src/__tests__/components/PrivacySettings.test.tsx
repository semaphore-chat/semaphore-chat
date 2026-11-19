import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createAppearanceSettings, renderWithProviders } from '../test-utils';
import { PrivacySettings } from '../../pages/SettingsPage';
import { appearanceSettingsControllerGetSettingsQueryKey } from '../../api-client/@tanstack/react-query.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const URL = 'http://localhost:3000/api/appearance-settings';
const SWITCH = { name: /Load pictures and previews from other sites/ };

function serve(loadRemoteContent: boolean, patch: (body: unknown) => Response | Promise<Response>) {
  let stored = createAppearanceSettings({ loadRemoteContent });
  server.use(
    http.get(URL, () => HttpResponse.json(stored)),
    http.patch(URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const response = await patch(body);
      if (response.ok) stored = { ...stored, ...(body as object) };
      return response;
    }),
  );
}

describe('PrivacySettings', () => {
  it('shows the setting on, with what it does in plain words', async () => {
    serve(true, () => HttpResponse.json({}));
    renderWithProviders(<PrivacySettings />);
    expect(await screen.findByRole('switch', SWITCH)).toBeChecked();
    expect(screen.getByText(/keep other sites from seeing your IP address/)).toBeInTheDocument();
    expect(screen.getByText(/GIF picker always load/)).toBeInTheDocument();
  });

  it('turning it off sends only loadRemoteContent and updates the shared settings at once', async () => {
    const bodies: unknown[] = [];
    serve(true, (body) => {
      bodies.push(body);
      return HttpResponse.json(createAppearanceSettings({ loadRemoteContent: false }));
    });
    const { user, queryClient } = renderWithProviders(<PrivacySettings />);
    const toggle = await screen.findByRole('switch', SWITCH);
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(
      queryClient.getQueryData<{ loadRemoteContent: boolean }>(appearanceSettingsControllerGetSettingsQueryKey())?.loadRemoteContent,
    ).toBe(false);
    await waitFor(() => expect(bodies).toEqual([{ loadRemoteContent: false }]));
  });

  it('a failed save puts the switch back and says so', async () => {
    serve(false, () => HttpResponse.json({ message: 'nope' }, { status: 500 }));
    const { user } = renderWithProviders(<PrivacySettings />);
    const toggle = await screen.findByRole('switch', SWITCH);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(await screen.findByText('Could not save the setting. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('switch', SWITCH)).not.toBeChecked();
  });

  it('says so when the settings cannot be loaded', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    renderWithProviders(<PrivacySettings />);
    expect(await screen.findByText('Failed to load privacy settings')).toBeInTheDocument();
  });
});
