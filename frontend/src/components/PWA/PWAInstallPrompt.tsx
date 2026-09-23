import React, { useState } from 'react';
import {
  Snackbar,
  Button,
  IconButton,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Close as CloseIcon,
  GetApp as InstallIcon,
  PhoneIphone as IPhoneIcon,
} from '@mui/icons-material';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import {
  BOTTOM_CHROME_ORDER,
  TOAST_PRIORITY,
  snackbarBottomSx,
  useBottomChromeOffset,
  useMeasuredChromeItem,
  useSnackbarGap,
  useToastQueue,
} from '../../contexts/BottomChromeContext';

/**
 * PWA Install Prompt Component
 *
 * Shows a non-intrusive prompt to install the app:
 * - On supported browsers: Shows install button that triggers native prompt
 * - On iOS: Shows instructions for "Add to Home Screen"
 * - Dismissed for 7 days if user closes it
 * - Hidden if app is already installed
 * - Queues behind the "Update available" toast (one snackbar at a time) and
 *   sits above the nav / voice bar / composer (BottomChromeContext)
 */
export const PWAInstallPrompt: React.FC = () => {
  const { isInstallable, isIOS, install, dismiss } = useInstallPrompt();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const isMyTurn = useToastQueue('install', TOAST_PRIORITY.INSTALL, isInstallable);
  const offset = useBottomChromeOffset(BOTTOM_CHROME_ORDER.TOAST);
  const snackbarGap = useSnackbarGap();
  const measureRef = useMeasuredChromeItem({
    extraHeight: snackbarGap,
    id: 'toast-install',
    order: BOTTOM_CHROME_ORDER.TOAST,
    fallbackHeight: 72,
    enabled: isInstallable && isMyTurn,
  });

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
    } else {
      setIsInstalling(true);
      try {
        const installed = await install();
        if (installed) {
          dismiss();
        }
      } finally {
        setIsInstalling(false);
      }
    }
  };

  if (!isInstallable || !isMyTurn) {
    return null;
  }

  return (
    <>
      <Snackbar
        ref={showIOSInstructions ? undefined : measureRef}
        open={!showIOSInstructions}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        data-chrome-offset={offset.px}
        sx={snackbarBottomSx(offset, snackbarGap)}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            bgcolor: 'background.paper',
            borderRadius: 2,
            p: 2,
            boxShadow: 8,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <InstallIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              Install Semaphore Chat
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Add to your home screen for the best experience
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            onClick={handleInstall}
            disabled={isInstalling}
            startIcon={isInstalling ? <CircularProgress size={16} color="inherit" /> : (isIOS ? <IPhoneIcon /> : <InstallIcon />)}
          >
            {isInstalling ? 'Installing...' : 'Install'}
          </Button>
          <IconButton size="small" onClick={dismiss} aria-label="dismiss">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Snackbar>

      {/* iOS Instructions Dialog */}
      <Snackbar
        ref={showIOSInstructions ? measureRef : undefined}
        open={showIOSInstructions}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        data-chrome-offset={offset.px}
        sx={snackbarBottomSx(offset, snackbarGap)}
      >
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 2,
            p: 3,
            boxShadow: 8,
            border: '1px solid',
            borderColor: 'divider',
            maxWidth: 320,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Install on iOS
            </Typography>
            <IconButton
              size="small"
              onClick={() => {
                setShowIOSInstructions(false);
                dismiss();
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="body2" paragraph>
            1. Tap the <strong>Share</strong> button in Safari
          </Typography>
          <Typography variant="body2" paragraph>
            2. Scroll down and tap <strong>"Add to Home Screen"</strong>
          </Typography>
          <Typography variant="body2">
            3. Tap <strong>"Add"</strong> to install
          </Typography>
        </Box>
      </Snackbar>
    </>
  );
};
