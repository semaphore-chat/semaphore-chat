/**
 * Auto Updater Component
 *
 * Displays update notifications and handles the update process
 * Only active when running in Electron
 */

import { useEffect } from 'react';
import { DESKTOP_TOAST_MAX_WIDTH } from '../../contexts/BottomChromeContext';
import { Alert, Button, LinearProgress, Snackbar, Box, Typography } from '@mui/material';
import { Download, Refresh } from '@mui/icons-material';
import { useElectronAPI } from '../../contexts/ElectronContext';
import { connectAppUpdates, useAppUpdate } from '../../data/appUpdate';
import { useShownShellKind } from '../../shell/shownShellKind';

/**
 * Holds the app's one subscription to the Electron updater (data/appUpdate.ts) and shows the
 * update in old-look snackbars. While the new design's shell is shown it renders nothing (that
 * shell shows the update in its banner row); the subscription stays.
 */
export const AutoUpdater = () => {
  const electronAPI = useElectronAPI();
  const update = useAppUpdate();
  const shownShell = useShownShellKind();
  // Null outside Electron.
  const isElectron = electronAPI !== null;

  useEffect(() => {
    if (!electronAPI) return;
    return connectAppUpdates(electronAPI);
  }, [electronAPI]);

  const updateAvailable = update.downloading || update.ready;
  const downloading = update.downloading;
  const downloadProgress = update.progress;
  const updateDownloaded = update.ready;
  const error = update.errorMessage;
  const updateInfo = update.version === null ? null : { version: update.version };

  const handleInstallUpdate = update.install;

  const handleCheckForUpdates = () => {
    electronAPI?.checkForUpdates?.();
  };

  const handleDismissError = update.dismissError;

  // Don't render anything if not in Electron
  if (!isElectron || shownShell === 'lounge') {
    return null;
  }

  return (
    <>
      {/* Error notification */}
      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={handleDismissError}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={handleDismissError}>
          {error}
        </Alert>
      </Snackbar>

      {/* Downloading update notification */}
      <Snackbar
        open={downloading}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{ maxWidth: DESKTOP_TOAST_MAX_WIDTH }}
      >
        <Alert severity="info" icon={<Download />}>
          <Typography variant="body2">
            Downloading update... {Math.round(downloadProgress)}%
          </Typography>
          <Box sx={{ mt: 1 }}>
            <LinearProgress variant="determinate" value={downloadProgress} />
          </Box>
        </Alert>
      </Snackbar>

      {/* Update downloaded notification */}
      <Snackbar
        open={updateDownloaded}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{ maxWidth: DESKTOP_TOAST_MAX_WIDTH }}
      >
        <Alert
          severity="success"
          action={
            <Button color="inherit" size="small" onClick={handleInstallUpdate}>
              Restart Now
            </Button>
          }
        >
          <Typography variant="body2">
            Update downloaded! Version {updateInfo?.version} is ready to install.
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            The app will restart to apply the update.
          </Typography>
        </Alert>
      </Snackbar>

      {/* Manual check for updates button (hidden for now, can be added to settings) */}
      {!updateAvailable && !downloading && !updateDownloaded && (
        <Box sx={{ display: 'none' }}>
          <Button
            startIcon={<Refresh />}
            onClick={handleCheckForUpdates}
            size="small"
          >
            Check for Updates
          </Button>
        </Box>
      )}
    </>
  );
};

export default AutoUpdater;
