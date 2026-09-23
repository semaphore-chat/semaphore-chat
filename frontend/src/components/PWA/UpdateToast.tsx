import React, { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { Snackbar, Button } from '@mui/material';
import {
  subscribeSwUpdate,
  shouldShowUpdate,
  applyUpdate,
} from '../../utils/swUpdate';
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
 * "Update available" toast.
 *
 * With registerType: "prompt", a new service worker installs but waits instead
 * of auto-activating. This toast lets the user apply the update on their terms
 * (calling applyUpdate → updateSW(true) → SKIP_WAITING + reload).
 *
 * It stays hidden while the update is deferred — the voice layer raises the
 * deferral flag during a call (see swUpdate.setUpdateDeferred) so an update
 * never reloads the page mid-call. Once the call ends the toast reappears.
 *
 * It queues with the other snackbars (only one shows at a time; the update
 * goes ahead of the install prompt) and sits above the nav / voice bar /
 * composer via BottomChromeContext.
 */
export const UpdateToast: React.FC = () => {
  const show = useSyncExternalStore(subscribeSwUpdate, shouldShowUpdate);
  const [isReloading, setIsReloading] = useState(false);
  const isMyTurn = useToastQueue('update', TOAST_PRIORITY.UPDATE, show);
  const open = show && isMyTurn;
  const offset = useBottomChromeOffset(BOTTOM_CHROME_ORDER.TOAST);
  const snackbarGap = useSnackbarGap();
  const measureRef = useMeasuredChromeItem({
    extraHeight: snackbarGap,
    id: 'toast-update',
    order: BOTTOM_CHROME_ORDER.TOAST,
    fallbackHeight: 48,
    enabled: open,
  });

  const handleReload = () => {
    setIsReloading(true);
    // applyUpdate triggers a reload once the new SW activates; if it rejects
    // we re-enable the button so the user can retry.
    void applyUpdate().catch(() => setIsReloading(false));
  };

  return (
    <Snackbar
      ref={measureRef}
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      data-chrome-offset={offset.px}
      sx={snackbarBottomSx(offset, snackbarGap)}
      message="Update available"
      action={
        <Button
          color="primary"
          size="small"
          onClick={handleReload}
          disabled={isReloading}
        >
          Reload
        </Button>
      }
    />
  );
};

export default UpdateToast;
