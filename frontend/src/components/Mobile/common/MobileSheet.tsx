/**
 * MobileSheet Component
 *
 * Bottom sheet for mobile context menus, member lists, etc.
 * Swipeable and touch-friendly with handle indicator.
 */

import React from 'react';
import {
  SwipeableDrawer,
  Box,
  Typography,
  IconButton,
  Divider,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { MOBILE_ANIMATIONS, TOUCH_TARGETS } from '../../../utils/breakpoints';
import { useOverlayHistory } from '../../../hooks/useOverlayHistory';

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  title?: string;
  children: React.ReactNode;
  // Optional height constraint (default: auto)
  maxHeight?: string | number;
  // Show close button in header
  showCloseButton?: boolean;
}

/**
 * iOS-style bottom sheet with swipe-to-dismiss
 */
export const MobileSheet: React.FC<MobileSheetProps> = ({
  open,
  onClose,
  onOpen = () => {},
  title,
  children,
  maxHeight = '85vh',
  showCloseButton = true,
}) => {
  // iOS detection for swipe hints
  const iOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Hardware/browser back closes the sheet instead of leaving the screen.
  // Sheets are only rendered on touch layouts, so this is always on.
  useOverlayHistory(open, onClose);

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={onOpen}
      disableBackdropTransition={!iOS}
      disableDiscovery={iOS}
      swipeAreaWidth={0} // Disable edge swipe to open (we control opening)
      ModalProps={{
        keepMounted: false,
      }}
      PaperProps={{
        sx: {
          maxHeight,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          // Safe area padding for devices with home indicator
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
      }}
      transitionDuration={MOBILE_ANIMATIONS.NORMAL}
    >
      {/* Pull handle indicator */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          pt: 1.5,
          pb: 1,
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: 'action.disabled',
          }}
        />
      </Box>

      {/* Header with title and close button */}
      {(title || showCloseButton) && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1,
              minHeight: TOUCH_TARGETS.MINIMUM,
            }}
          >
            <Typography variant="h6" fontWeight={600}>
              {title || ''}
            </Typography>
            {showCloseButton && (
              <IconButton
                onClick={onClose}
                size="small"
                sx={{ mr: -1, minWidth: TOUCH_TARGETS.MINIMUM, minHeight: TOUCH_TARGETS.MINIMUM }}
                aria-label="Close"
              >
                <CloseIcon />
              </IconButton>
            )}
          </Box>
          <Divider />
        </>
      )}

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 2,
          py: 2,
        }}
      >
        {children}
      </Box>
    </SwipeableDrawer>
  );
};

export default MobileSheet;
