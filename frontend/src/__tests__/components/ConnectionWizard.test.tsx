import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { ConnectionWizard } from '../../components/Electron/ConnectionWizard';
import { addServer, getActiveServer, getServers } from '../../utils/serverStorage';
import { consumeBrowserLoginOnLoad } from '../../hooks/useBrowserLogin';

const NEW_SERVER = 'https://new.example.com';

function serverAnswers(publicSettings: Record<string, unknown>) {
  server.use(
    http.get(`${NEW_SERVER}/api/onboarding/status`, () => HttpResponse.json({ needsSetup: false })),
    http.get(`${NEW_SERVER}/api/instance/settings/public`, () => HttpResponse.json(publicSettings)),
  );
}

describe('ConnectionWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  async function connect(user: ReturnType<typeof renderWithProviders>['user']) {
    await user.type(screen.getByLabelText(/server url/i), NEW_SERVER);
    await user.click(screen.getByRole('button', { name: /^connect$/i }));
  }

  it('changing server: starts at the URL, can be cancelled, and switches to the new server', async () => {
    addServer('Old', 'https://old.example.com');
    serverAnswers({ desktopBrowserLogin: false });
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    const { user } = renderWithProviders(
      <ConnectionWizard open onCancel={onCancel} onComplete={onComplete} />,
      { electronAPI: createFakeElectronAPI() },
    );

    expect(screen.getByRole('heading', { name: /change server/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/server url/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalled();

    await connect(user);
    await user.click(await screen.findByRole('button', { name: /^finish$/i }));

    expect(onComplete).toHaveBeenCalled();
    expect(getActiveServer()?.url).toBe(NEW_SERVER);
    expect(getServers()).toHaveLength(2);
  });

  it('offers to sign in with the browser when the server supports it', async () => {
    serverAnswers({ desktopBrowserLogin: true });
    const onComplete = vi.fn();
    const { user } = renderWithProviders(<ConnectionWizard open onComplete={onComplete} />, {
      electronAPI: createFakeElectronAPI(),
    });

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await connect(user);
    await user.click(await screen.findByRole('button', { name: /sign in with browser/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // The login screen starts it after the reload
    expect(consumeBrowserLoginOnLoad()).toBe(true);
    expect(screen.getByRole('button', { name: /sign in with password/i })).toBeInTheDocument();
  });

  it('changing server: leaving on the last step keeps the current server and session', async () => {
    const old = addServer('Old', 'https://old.example.com');
    localStorage.setItem('refreshToken', 'old-session');
    serverAnswers({ desktopBrowserLogin: false });
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    const { user } = renderWithProviders(
      <ConnectionWizard open onCancel={onCancel} onComplete={onComplete} />,
      { electronAPI: createFakeElectronAPI() },
    );

    await connect(user);
    await screen.findByRole('button', { name: /^finish$/i });
    // Tested, not switched yet
    expect(getActiveServer()?.id).toBe(old.id);
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(getActiveServer()?.id).toBe(old.id);
    expect(getServers()).toHaveLength(1);
    expect(localStorage.getItem('refreshToken')).toBe('old-session');
  });

  it('changing server: confirming switches and drops the old session together', async () => {
    addServer('Old', 'https://old.example.com');
    localStorage.setItem('refreshToken', 'old-session');
    serverAnswers({ desktopBrowserLogin: false });
    const onComplete = vi.fn(() => {
      // What the app reloads onto
      expect(getActiveServer()?.url).toBe(NEW_SERVER);
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });
    const { user } = renderWithProviders(
      <ConnectionWizard open onCancel={vi.fn()} onComplete={onComplete} />,
      { electronAPI: createFakeElectronAPI() },
    );

    await connect(user);
    await user.click(await screen.findByRole('button', { name: /^finish$/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
