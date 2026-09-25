import { AutoUpdater } from '../../components/Electron/AutoUpdater';
import { emitOnSubscribe } from '../../__tests__/test-utils/fakeElectronAPI';
import type { UpdateInfo } from '../../types/electron-api';
import { defineComponent } from '../fixtures/componentStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario } from '../fixtures/scenarios';

/*
 * The Electron auto-updater's snackbars (App.tsx mounts <AutoUpdater />; it
 * renders nothing in a browser). The fake bridge fires the main process's
 * update events as soon as the component subscribes. Electron windows are at
 * least 800px wide, so tablet and desktop only.
 */

const update: UpdateInfo = { version: '1.4.0', releaseDate: '2026-09-21T12:00:00Z' };

const updater = () => defineComponent(bigCommunityScenario, () => <AutoUpdater />, { maxWidth: false });

/** An update was found and the download started: no progress reported yet. */
export const UpdateAvailable = asElectron(updater(), {
  onUpdateAvailable: emitOnSubscribe(update),
});
UpdateAvailable.meta = { viewports: ['tablet', 'desktop'] };

/** Downloading, 64% done. */
export const UpdateDownloading = asElectron(updater(), {
  onUpdateAvailable: emitOnSubscribe(update),
  onDownloadProgress: emitOnSubscribe({ percent: 64.2, bytesPerSecond: 2_400_000, transferred: 64_200_000, total: 100_000_000 }),
});
UpdateDownloading.meta = { viewports: ['tablet', 'desktop'] };

/** Downloaded: "Restart Now" installs it. (electron-updater reports the
 * update as available first; the snackbar's version comes from that.) */
export const UpdateReady = asElectron(updater(), {
  onUpdateAvailable: emitOnSubscribe(update),
  onUpdateDownloaded: emitOnSubscribe(update),
});
UpdateReady.meta = { viewports: ['tablet', 'desktop'] };

/** The download failed. */
export const UpdateError = asElectron(updater(), {
  onUpdateError: emitOnSubscribe(new Error('Cannot download update: net::ERR_CONNECTION_RESET')),
});
UpdateError.meta = { viewports: ['tablet', 'desktop'] };
