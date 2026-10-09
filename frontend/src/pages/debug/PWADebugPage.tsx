/**
 * PWADebugPage
 *
 * Debug panel for diagnosing PWA installation issues.
 * Located at /debug/pwa
 *
 * Displays:
 * - Service worker status
 * - Manifest detection
 * - beforeinstallprompt event status
 * - Standalone/installed detection
 * - Secure context check
 * - localStorage dismissal state
 * - Platform detection results
 * - User agent string
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Divider,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
  Stack,
  Paper,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { getPlatform, isMobile, isElectron, isDesktopBrowser, isSecureContext as checkSecureContext } from '../../utils/platform';

interface DiagnosticItem {
  label: string;
  value: string;
  status: 'success' | 'error' | 'warning' | 'info';
  detail?: string;
}

const PWADebugPage: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [manifestData, setManifestData] = useState<Record<string, unknown> | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [swStatus, setSwStatus] = useState<string>('Checking...');
  const [swDetail, setSwDetail] = useState<string>('');
  const [installPromptFired, setInstallPromptFired] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Track beforeinstallprompt globally
  useEffect(() => {
    const handler = () => setInstallPromptFired(true);
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const runDiagnostics = useCallback(async () => {
    const items: DiagnosticItem[] = [];

    // 1. Secure context
    const secure = checkSecureContext();
    items.push({
      label: 'Secure Context (HTTPS)',
      value: secure ? 'Yes' : 'No',
      status: secure ? 'success' : 'error',
      detail: secure
        ? `Protocol: ${window.location.protocol}`
        : 'PWA install requires HTTPS or localhost',
    });

    // 2. Platform
    items.push({
      label: 'Platform',
      value: getPlatform(),
      status: 'info',
    });

    items.push({
      label: 'Is Mobile',
      value: isMobile() ? 'Yes' : 'No',
      status: isMobile() ? 'success' : 'info',
    });

    items.push({
      label: 'Is Desktop Browser',
      value: isDesktopBrowser() ? 'Yes' : 'No',
      status: isDesktopBrowser() ? 'warning' : 'info',
      detail: isDesktopBrowser() ? 'PWA install prompt is hidden on desktop (Electron preferred)' : undefined,
    });

    items.push({
      label: 'Is Electron',
      value: isElectron() ? 'Yes' : 'No',
      status: isElectron() ? 'warning' : 'info',
      detail: isElectron() ? 'SW registration is skipped in Electron' : undefined,
    });

    // 3. Service worker
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          const sw = registration.active || registration.waiting || registration.installing;
          const state = sw?.state || 'unknown';
          setSwStatus(`Registered (${state})`);
          setSwDetail(`Scope: ${registration.scope}`);
          items.push({
            label: 'Service Worker',
            value: `Registered - ${state}`,
            status: state === 'activated' ? 'success' : 'warning',
            detail: `Scope: ${registration.scope}`,
          });
        } else {
          setSwStatus('Not registered');
          setSwDetail('');
          items.push({
            label: 'Service Worker',
            value: 'Not registered',
            status: 'error',
            detail: 'No service worker found — PWA install requires an active SW',
          });
        }
      } catch (err) {
        setSwStatus('Error');
        setSwDetail(String(err));
        items.push({
          label: 'Service Worker',
          value: 'Error checking',
          status: 'error',
          detail: String(err),
        });
      }
    } else {
      setSwStatus('Not supported');
      setSwDetail('');
      items.push({
        label: 'Service Worker',
        value: 'Not supported by browser',
        status: 'error',
      });
    }

    // 4. Standalone mode (already installed?)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    items.push({
      label: 'Display Mode: Standalone',
      value: isStandalone ? 'Yes (installed)' : 'No (in browser)',
      status: isStandalone ? 'success' : 'info',
      detail: isStandalone ? 'App is running as installed PWA' : 'App is running in the browser',
    });

    // 5. beforeinstallprompt
    items.push({
      label: 'beforeinstallprompt Fired',
      value: installPromptFired ? 'Yes' : 'No',
      status: installPromptFired ? 'success' : 'warning',
      detail: installPromptFired
        ? 'Browser considers this app installable'
        : 'Event has not fired yet — may need 30s+ engagement, or Vanadium may not support it',
    });

    // 6. localStorage dismissal
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysAgo = ((Date.now() - dismissedTime) / (1000 * 60 * 60 * 24)).toFixed(1);
      const expired = Date.now() - dismissedTime >= 7 * 24 * 60 * 60 * 1000;
      items.push({
        label: 'Install Prompt Dismissed',
        value: expired ? `Yes (expired — ${daysAgo} days ago)` : `Yes (${daysAgo} days ago)`,
        status: expired ? 'info' : 'warning',
        detail: expired
          ? 'Dismissal has expired, prompt should show again'
          : `Prompt hidden for 7 days. Will re-appear in ${(7 - parseFloat(daysAgo)).toFixed(1)} days`,
      });
    } else {
      items.push({
        label: 'Install Prompt Dismissed',
        value: 'No',
        status: 'success',
      });
    }

    // 7. User agent
    items.push({
      label: 'User Agent',
      value: navigator.userAgent,
      status: 'info',
    });

    // 8. Display mode media queries
    const displayModes = ['standalone', 'fullscreen', 'minimal-ui', 'browser'] as const;
    const activeMode = displayModes.find(mode => window.matchMedia(`(display-mode: ${mode})`).matches) || 'unknown';
    items.push({
      label: 'Active Display Mode',
      value: activeMode,
      status: activeMode === 'standalone' ? 'success' : 'info',
    });

    // 9. Fetch manifest
    try {
      const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (link) {
        const resp = await fetch(link.href);
        if (resp.ok) {
          const data = await resp.json();
          setManifestData(data);
          setManifestError(null);

          // Validate required fields
          const hasName = !!data.name;
          const hasIcons = Array.isArray(data.icons) && data.icons.length > 0;
          const hasStartUrl = !!data.start_url;
          const hasDisplay = data.display === 'standalone' || data.display === 'fullscreen';

          items.push({
            label: 'Manifest',
            value: 'Loaded',
            status: hasName && hasIcons && hasStartUrl && hasDisplay ? 'success' : 'warning',
            detail: link.href,
          });

          items.push({
            label: 'Manifest: name',
            value: data.name || '(missing)',
            status: hasName ? 'success' : 'error',
          });
          items.push({
            label: 'Manifest: display',
            value: data.display || '(missing)',
            status: hasDisplay ? 'success' : 'error',
          });
          items.push({
            label: 'Manifest: start_url',
            value: data.start_url || '(missing)',
            status: hasStartUrl ? 'success' : 'error',
          });
          items.push({
            label: 'Manifest: icons',
            value: hasIcons ? `${data.icons.length} icon(s)` : '(missing)',
            status: hasIcons ? 'success' : 'error',
            detail: hasIcons ? data.icons.map((i: { src: string; sizes: string }) => `${i.sizes}`).join(', ') : undefined,
          });
        } else {
          setManifestError(`HTTP ${resp.status}`);
          items.push({
            label: 'Manifest',
            value: `Failed to load (${resp.status})`,
            status: 'error',
            detail: link.href,
          });
        }
      } else {
        setManifestError('No <link rel="manifest"> found');
        items.push({
          label: 'Manifest',
          value: 'No manifest link tag found',
          status: 'error',
        });
      }
    } catch (err) {
      setManifestError(String(err));
      items.push({
        label: 'Manifest',
        value: 'Error fetching',
        status: 'error',
        detail: String(err),
      });
    }

    setDiagnostics(items);
  }, [installPromptFired]);

  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics, refreshKey]);

  const handleClearDismissal = () => {
    localStorage.removeItem('pwa-install-dismissed');
    setRefreshKey(k => k + 1);
  };

  const getChipColor = (status: DiagnosticItem['status']) => {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return 'default';
    }
  };

  const hasErrors = diagnostics.some(d => d.status === 'error');
  const hasWarnings = diagnostics.some(d => d.status === 'warning');

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <PhoneAndroidIcon sx={{ fontSize: 'icon.4xl' }} />
        <Typography variant="h4">PWA Debug Panel</Typography>
      </Stack>

      {hasErrors && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Issues detected that will prevent PWA installation. See details below.
        </Alert>
      )}
      {!hasErrors && hasWarnings && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Some warnings detected. PWA may still be installable — check details below.
        </Alert>
      )}
      {!hasErrors && !hasWarnings && diagnostics.length > 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Everything looks good for PWA installation.
        </Alert>
      )}

      {/* Diagnostics */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Diagnostics</Typography>
            <Button
              onClick={() => setRefreshKey(k => k + 1)}
              startIcon={<RefreshIcon />}
              size="small"
            >
              Re-run
            </Button>
          </Stack>
          <Divider sx={{ my: 2 }} />
          {diagnostics.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <List dense>
              {diagnostics.map((item, i) => (
                <ListItem key={i} sx={{ alignItems: 'flex-start' }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {item.label}
                        </Typography>
                        <Chip
                          label={item.status}
                          color={getChipColor(item.status)}
                          size="small"
                          variant="outlined"
                        />
                      </Stack>
                    }
                    secondary={
                      <>
                        <Typography
                          variant="body2"
                          component="span"
                          sx={{ fontFamily: 'monospace', fontSize: 'scale.sm', wordBreak: 'break-all' }}
                        >
                          {item.value}
                        </Typography>
                        {item.detail && (
                          <Typography
                            variant="caption"
                            component="div"
                            color="text.secondary"
                            sx={{ mt: 0.5 }}
                          >
                            {item.detail}
                          </Typography>
                        )}
                      </>
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Actions</Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              color="warning"
              onClick={handleClearDismissal}
              startIcon={<DeleteSweepIcon />}
            >
              Clear Install Dismissal
            </Button>
          </Stack>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            Removes the 7-day dismissal so the install prompt can re-appear.
          </Typography>
        </CardContent>
      </Card>

      {/* Raw Manifest */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Raw Manifest</Typography>
          <Divider sx={{ mb: 2 }} />
          {manifestError && (
            <Alert severity="error" sx={{ mb: 2 }}>{manifestError}</Alert>
          )}
          {manifestData ? (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: 'background.default',
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              <Typography
                variant="body2"
                component="pre"
                sx={{ fontFamily: 'monospace', fontSize: 'scale.sm', whiteSpace: 'pre-wrap', m: 0 }}
              >
                {JSON.stringify(manifestData, null, 2)}
              </Typography>
            </Paper>
          ) : (
            <Typography color="text.secondary">
              {manifestError ? 'Could not load manifest' : 'Loading...'}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* SW Details */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Service Worker Details</Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2"><strong>Status:</strong> {swStatus}</Typography>
          {swDetail && (
            <Typography variant="body2" sx={{ mt: 1, fontFamily: 'monospace', fontSize: 'scale.sm' }}>
              {swDetail}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default PWADebugPage;
