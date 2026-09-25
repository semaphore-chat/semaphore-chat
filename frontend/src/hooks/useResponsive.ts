/**
 * useResponsive Hook
 *
 * Provides responsive breakpoint detection for different device types.
 * Aligns with DEVICE_BREAKPOINTS from utils/breakpoints.ts
 *
 * Electron is a desktop app: it always gets the desktop layout and pointer UI,
 * whatever the window width (its minimum width, 800px, is in the tablet range).
 * So in Electron every phone/tablet flag below is false and isDesktop is true.
 */

import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { DEVICE_BREAKPOINTS } from '../utils/breakpoints';
import { isElectron } from '../utils/platform';

export type DeviceType = 'phone' | 'tablet' | 'desktop';

/**
 * Hook to detect device type and provide responsive utilities
 */
export const useResponsive = () => {
  const theme = useTheme();

  // Device type detection using our custom breakpoints
  const isPhone = useMediaQuery(`(max-width: ${DEVICE_BREAKPOINTS.PHONE - 1}px)`);
  const isPhoneLandscape = useMediaQuery(
    `(min-width: ${DEVICE_BREAKPOINTS.PHONE}px) and (max-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE - 1}px)`
  );
  const isTabletPortrait = useMediaQuery(
    `(min-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE}px) and (max-width: ${DEVICE_BREAKPOINTS.TABLET - 1}px)`
  );
  const isTabletLandscape = useMediaQuery(
    `(min-width: ${DEVICE_BREAKPOINTS.TABLET}px) and (max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`
  );
  const isDesktop = useMediaQuery(`(min-width: ${DEVICE_BREAKPOINTS.DESKTOP}px)`);

  // Electron is a desktop app — never use the phone or tablet layout,
  // regardless of window size
  const electron = isElectron();

  const effectiveIsPhone = !electron && isPhone;
  const effectiveIsPhoneLandscape = !electron && isPhoneLandscape;
  const effectiveIsTabletPortrait = !electron && isTabletPortrait;
  const effectiveIsTabletLandscape = !electron && isTabletLandscape;

  // Grouped checks for convenience
  const isMobile = effectiveIsPhone || effectiveIsPhoneLandscape; // < 768px (use single-column mobile layout)
  const isTablet = effectiveIsTabletPortrait || effectiveIsTabletLandscape; // 768-1199px (use split-view tablet layout)
  const effectiveIsDesktop = electron || isDesktop;

  // MUI breakpoint checks (for backward compatibility)
  const isXs = useMediaQuery(theme.breakpoints.only('xs')); // < 600px
  const isSm = useMediaQuery(theme.breakpoints.only('sm')); // 600-899px
  const isMd = useMediaQuery(theme.breakpoints.only('md')); // 900-1199px
  const isLg = useMediaQuery(theme.breakpoints.only('lg')); // 1200-1535px
  const isXl = useMediaQuery(theme.breakpoints.up('xl')); // >= 1536px

  // Orientation
  const isPortrait = useMediaQuery('(orientation: portrait)');
  const isLandscape = useMediaQuery('(orientation: landscape)');

  // Device type
  const deviceType: DeviceType = isMobile ? 'phone' : isTablet ? 'tablet' : 'desktop';

  // Touch capability
  const isTouchDevice = useMediaQuery('(hover: none) and (pointer: coarse)');

  // Should use mobile/tablet-optimized UI (touch-friendly, larger targets)
  const shouldUseTouchUI = !electron && (isTouchDevice || isMobile || isTablet);

  return {
    // Device type
    isMobile,    // < 768px - single column layout (always false on Electron)
    isTablet,    // 768-1199px - split view layout (always false on Electron)
    isDesktop: effectiveIsDesktop, // >= 1200px - full desktop layout (always true on Electron)
    deviceType,

    // Granular phone/tablet detection
    isPhone: effectiveIsPhone,           // < 600px (always false on Electron)
    isPhoneLandscape: effectiveIsPhoneLandscape,  // 600-767px (always false on Electron)
    isTabletPortrait: effectiveIsTabletPortrait,   // 768-1023px (always false on Electron)
    isTabletLandscape: effectiveIsTabletLandscape, // 1024-1199px (always false on Electron)

    // MUI breakpoints (backward compatibility)
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,

    // Orientation
    isPortrait,
    isLandscape,

    // Capabilities
    isTouchDevice,
    shouldUseTouchUI, // always false on Electron
  };
};

/**
 * Simple hook for just mobile detection
 * Returns true for phone and phone landscape (< 768px).
 * Always false in Electron — a narrow desktop window is not a phone
 * (mirrors the Electron gate in useResponsive).
 */
export const useMobileBreakpoint = (): boolean => {
  const matches = useMediaQuery(`(max-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE - 1}px)`);
  return matches && !isElectron();
};

/**
 * Hook for tablet detection
 * Returns true for tablet portrait and landscape (768-1199px).
 * Always false in Electron (mirrors the Electron gate in useResponsive).
 */
export const useTabletBreakpoint = (): boolean => {
  const matches = useMediaQuery(
    `(min-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE}px) and (max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`
  );
  return matches && !isElectron();
};

/**
 * Hook for detecting if we should show mobile/tablet UI
 * Returns true for anything < 1200px.
 * Always false in Electron (mirrors the Electron gate in useResponsive).
 */
export const useCompactLayout = (): boolean => {
  const matches = useMediaQuery(`(max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`);
  return matches && !isElectron();
};
