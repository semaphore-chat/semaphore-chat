import React, { useEffect, useState } from 'react';
import { Snackbar, Alert, Box, Typography } from '@mui/material';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import {
  TOP_CHROME_ORDER,
  useChromeItem,
  useHasTopChromeHost,
  useTopChromeOffset,
} from '../../contexts/BottomChromeContext';

/** Height of the slim offline strip on touch layouts. */
const OFFLINE_STRIP_HEIGHT = 28;

/**
 * Slim "You're offline" indicator.
 *
 * Listens to the browser's online/offline events and shows while the network
 * is unreachable. It disappears automatically when connectivity returns.
 * Purely presentational — the app shell itself is served offline by the
 * service worker's navigation fallback.
 *
 * On the phone/tablet layouts (which host top chrome, see
 * BottomChromeContext) it's a slim strip at the top of the screen that
 * pushes the app bar and content down instead of covering them. Elsewhere
 * (desktop, Electron, public pages) it keeps the top-centre snackbar.
 */
export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const asStrip = useHasTopChromeHost();
  const top = useTopChromeOffset(TOP_CHROME_ORDER.OFFLINE);

  useChromeItem({
    id: 'offline-strip',
    edge: 'top',
    order: TOP_CHROME_ORDER.OFFLINE,
    height: OFFLINE_STRIP_HEIGHT,
    enabled: asStrip && isOffline,
  });

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (asStrip) {
    if (!isOffline) return null;
    return (
      <Box
        role="status"
        data-testid="offline-strip"
        sx={{
          position: 'fixed',
          top: top.css,
          left: 0,
          right: 0,
          height: OFFLINE_STRIP_HEIGHT,
          zIndex: (theme) => theme.zIndex.appBar + 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          px: 2,
          bgcolor: 'warning.main',
          color: 'warning.contrastText',
        }}
      >
        <WifiOffIcon sx={{ fontSize: 16 }} />
        <Typography variant="caption" fontWeight={600} noWrap>
          You're offline
        </Typography>
      </Box>
    );
  }

  return (
    <Snackbar
      open={isOffline}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        severity="warning"
        icon={<WifiOffIcon fontSize="inherit" />}
        variant="filled"
        sx={{ width: '100%' }}
      >
        You're offline
      </Alert>
    </Snackbar>
  );
};

export default OfflineBanner;
