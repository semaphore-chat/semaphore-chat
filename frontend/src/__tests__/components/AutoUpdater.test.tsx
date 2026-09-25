import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { AutoUpdater } from '../../components/Electron/AutoUpdater';
import type { DownloadProgress, UpdateInfo } from '../../types/electron-api';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI, emitOnSubscribe } from '../test-utils/fakeElectronAPI';

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const update: UpdateInfo = { version: '1.4.0' };

describe('AutoUpdater', () => {
  it('renders nothing outside Electron', () => {
    const { container } = renderWithProviders(<AutoUpdater />, { electronAPI: null });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Downloading update/)).not.toBeInTheDocument();
  });

  it('shows download progress once an update is available', () => {
    let reportProgress: (progress: DownloadProgress) => void = () => {};
    const electronAPI = createFakeElectronAPI({
      onUpdateAvailable: emitOnSubscribe(update),
      onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
        reportProgress = callback;
        return () => {};
      },
    });

    renderWithProviders(<AutoUpdater />, { electronAPI });
    expect(screen.getByText('Downloading update... 0%')).toBeInTheDocument();

    act(() => reportProgress({ percent: 41.6, bytesPerSecond: 1, transferred: 416, total: 1000 }));
    expect(screen.getByText('Downloading update... 42%')).toBeInTheDocument();
  });

  it('offers to restart when the update is downloaded, and installs on click', async () => {
    const quitAndInstall = vi.fn();
    // electron-updater reports update-available before update-downloaded;
    // the version shown comes from the former.
    const electronAPI = createFakeElectronAPI({
      onUpdateAvailable: emitOnSubscribe(update),
      onUpdateDownloaded: emitOnSubscribe(update),
      quitAndInstall,
    });

    const { user } = renderWithProviders(<AutoUpdater />, { electronAPI });
    expect(screen.getByText(/Version 1\.4\.0 is ready to install/)).toBeInTheDocument();
    expect(screen.queryByText(/Downloading update/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart Now' }));
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('shows the update error', () => {
    const electronAPI = createFakeElectronAPI({
      onUpdateError: emitOnSubscribe(new Error('Cannot download update')),
    });

    renderWithProviders(<AutoUpdater />, { electronAPI });
    expect(screen.getByText('Cannot download update')).toBeInTheDocument();
  });

  it('unsubscribes from every update event on unmount', () => {
    const unsubscribes = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const electronAPI = createFakeElectronAPI({
      onUpdateAvailable: () => unsubscribes[0],
      onDownloadProgress: () => unsubscribes[1],
      onUpdateDownloaded: () => unsubscribes[2],
      onUpdateError: () => unsubscribes[3],
    });

    const { unmount } = renderWithProviders(<AutoUpdater />, { electronAPI });
    unmount();
    unsubscribes.forEach((unsubscribe) => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });
});
