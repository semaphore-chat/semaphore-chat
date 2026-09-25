/**
 * Auto Updater Component
 *
 * Displays update notifications and handles the update process
 * Only active when running in Electron
 */

import { useEffect, useState } from 'react';
import { Alert, Button, LinearProgress, Snackbar, Box, Typography } from '@mui/material';
import { Download, Refresh } from '@mui/icons-material';
import { logger } from '../../utils/logger';
import { useElectronAPI } from '../../contexts/ElectronContext';
import type { UpdateInfo } from '../../types/electron-api';

export const AutoUpdater = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isElectron, setIsElectron] = useState(false);
  const electronAPI = useElectronAPI();

  useEffect(() => {
    // Null outside Electron.
    if (!electronAPI) return;

    setIsElectron(true);

    if (
      !electronAPI.onUpdateAvailable ||
      !electronAPI.onDownloadProgress ||
      !electronAPI.onUpdateDownloaded ||
      !electronAPI.onUpdateError
    ) {
      return;
    }

    // Set up event listeners
    const unsubUpdateAvailable = electronAPI.onUpdateAvailable((info) => {
      logger.dev('Update available:', info);
      setUpdateInfo(info);
      setUpdateAvailable(true);
      setDownloading(true);
    });

    const unsubDownloadProgress = electronAPI.onDownloadProgress((progress) => {
      logger.dev('Download progress:', progress.percent);
      setDownloadProgress(progress.percent);
    });

    const unsubUpdateDownloaded = electronAPI.onUpdateDownloaded((info) => {
      logger.dev('Update downloaded:', info);
      // Carries the version too: the renderer may have missed
      // update-available (e.g. it reloaded mid-download)
      setUpdateInfo(info);
      setDownloading(false);
      setUpdateDownloaded(true);
    });

    const unsubUpdateError = electronAPI.onUpdateError((err) => {
      logger.error('Update error:', err);
      setError(err.message || 'Failed to download update');
      setDownloading(false);
      setUpdateAvailable(false);
    });

    // Cleanup on unmount
    return () => {
      unsubUpdateAvailable();
      unsubDownloadProgress();
      unsubUpdateDownloaded();
      unsubUpdateError();
    };
  }, [electronAPI]);

  const handleInstallUpdate = () => {
    electronAPI?.quitAndInstall?.();
  };

  const handleCheckForUpdates = () => {
    electronAPI?.checkForUpdates?.();
  };

  const handleDismissError = () => {
    setError(null);
  };

  // Don't render anything if not in Electron
  if (!isElectron) {
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
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
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
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
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
