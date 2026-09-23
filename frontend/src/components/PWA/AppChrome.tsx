import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { UpdateToast } from './UpdateToast';
import { OfflineBanner } from './OfflineBanner';

/** Renders nothing — a crashed piece of chrome just disappears. */
const renderNothing = () => null;

/**
 * App-shell chrome that floats over every screen: PWA install prompt,
 * "Update available" toast and the offline banner.
 *
 * Each piece gets its own silent ErrorBoundary: these are non-essential
 * overlays, so a render error in one of them must never blank the app (it
 * used to — they were mounted outside every boundary, and the update toast
 * threw under dark + balanced/vibrant themes). App.tsx additionally mounts
 * this inside the app-level ErrorBoundary as a second safety net.
 */
export const AppChrome: React.FC = () => (
  <>
    <ErrorBoundary fallback={renderNothing}>
      <PWAInstallPrompt />
    </ErrorBoundary>
    <ErrorBoundary fallback={renderNothing}>
      <UpdateToast />
    </ErrorBoundary>
    <ErrorBoundary fallback={renderNothing}>
      <OfflineBanner />
    </ErrorBoundary>
  </>
);

export default AppChrome;
