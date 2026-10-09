/**
 * NotificationDebugPage
 *
 * Admin-only debug panel for testing and auditing the notification system.
 * Located at /debug/notifications
 *
 * Features:
 * - Platform info display (Web/Electron/PWA, permission status, push status)
 * - Test buttons for all notification types
 * - Push subscription list
 * - Settings clear functionality
 * - Test results log
 */

import React, { useState, useCallback } from 'react';
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
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import { useQuery } from '@tanstack/react-query';
import type { DebugSubscriptionsResponseDto } from '../../api-client/types.gen';
import { userControllerGetProfileOptions } from '../../api-client/@tanstack/react-query.gen';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import {
  showNotification,
  formatNotificationContent,
} from '../../utils/notifications';
import { NotificationType } from '../../types/notification.type';
import { isElectron, getPlatform, Platform } from '../../utils/platform';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  notificationsControllerSendTestNotificationMutation,
  notificationsControllerGetDebugSubscriptionsOptions,
  notificationsControllerClearDebugSettingsMutation,
} from '../../api-client/@tanstack/react-query.gen';

import { pushNotificationsControllerSendTestPushMutation } from '../../api-client/@tanstack/react-query.gen';

interface TestResult {
  timestamp: string;
  message: string;
  success: boolean;
}

const NotificationDebugPage: React.FC = () => {
  const { data: profile, isLoading: isLoadingProfile } = useQuery(userControllerGetProfileOptions());
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  // Permission hooks
  const {
    permission,
    isSupported,
    requestPermission,
    isRequesting,
  } = useNotificationPermission();

  // Push hooks
  const {
    isServerEnabled: isPushServerEnabled,
    isSubscribed: isPushSubscribed,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    isLoading: isPushLoading,
    error: pushError,
  } = usePushNotifications();

  // Debug API mutations
  const queryClient = useQueryClient();

  const { mutateAsync: sendTestNotification, isPending: isSendingTest } = useMutation({
    ...notificationsControllerSendTestNotificationMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetNotifications' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetUnreadCount' }] });
    },
  });

  const { mutateAsync: sendTestPush, isPending: isSendingPush } = useMutation(pushNotificationsControllerSendTestPushMutation());

  const { mutateAsync: clearSettings, isPending: isClearing } = useMutation({
    ...notificationsControllerClearDebugSettingsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetNotifications' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetUnreadCount' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetSettings' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetChannelOverride' }] });
    },
  });

  const [subscriptionsData, setSubscriptionsData] =
    React.useState<DebugSubscriptionsResponseDto | null>(null);
  const [isLoadingSubscriptions, setIsLoadingSubscriptions] = React.useState(false);

  // Add a result to the log
  const addResult = useCallback((message: string, success: boolean = true) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestResults((prev) => [{ timestamp, message, success }, ...prev.slice(0, 19)]);
  }, []);

  // Check admin access
  if (isLoadingProfile) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (profile?.role !== 'OWNER') {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          This debug panel is only accessible to instance owners.
        </Alert>
      </Box>
    );
  }

  // Test handlers
  const handleRequestPermission = async () => {
    try {
      const result = await requestPermission();
      addResult(`Permission request result: ${result}`, result === 'granted');
    } catch (error) {
      addResult(`Permission request failed: ${error}`, false);
    }
  };

  const handleTestBrowserNotification = async () => {
    try {
      const { title, body } = formatNotificationContent({
        type: NotificationType.DIRECT_MESSAGE,
        authorUsername: 'Debug Test',
        messageText: 'This is a test browser notification',
      });

      const notification = await showNotification({
        title,
        body,
        tag: `debug-browser-test-${Date.now()}`,
      });
      addResult(
        `Browser notification sent: ${notification ? 'Success' : 'Failed (null returned)'}`,
        !!notification
      );
    } catch (error) {
      addResult(`Browser notification failed: ${error}`, false);
    }
  };

  const handleTestServerNotification = async (type: NotificationType) => {
    try {
      const result = await sendTestNotification({ body: { type } });
      addResult(`Server notification (${type}): ${result.message}`, result.success);
    } catch (error) {
      addResult(`Server notification (${type}) failed: ${error}`, false);
    }
  };

  const handleTestPush = async () => {
    try {
      const result = await sendTestPush({});
      addResult(
        `Push notification: ${result.message} (sent: ${result.sent}, failed: ${result.failed})`,
        result.success
      );
    } catch (error) {
      addResult(`Push notification failed: ${error}`, false);
    }
  };

  const handleSubscribePush = async () => {
    const success = await subscribePush();
    addResult(
      `Push subscription: ${success ? 'Subscribed successfully' : 'Failed to subscribe'}`,
      success
    );
  };

  const handleUnsubscribePush = async () => {
    const success = await unsubscribePush();
    addResult(
      `Push unsubscription: ${success ? 'Unsubscribed successfully' : 'Failed to unsubscribe'}`,
      success
    );
  };

  const handleClearSettings = async () => {
    try {
      const result = await clearSettings({});
      addResult(
        `Cleared: ${result.notificationsDeleted} notifications, ${result.settingsDeleted} settings, ${result.overridesDeleted} overrides`,
        result.success
      );
    } catch (error) {
      addResult(`Clear settings failed: ${error}`, false);
    }
  };

  const handleRefreshSubscriptions = async () => {
    setIsLoadingSubscriptions(true);
    try {
      const data = await queryClient.fetchQuery(
        notificationsControllerGetDebugSubscriptionsOptions()
      );
      setSubscriptionsData(data);
      addResult('Subscriptions refreshed');
    } catch (error) {
      addResult(`Failed to load subscriptions: ${error}`, false);
    } finally {
      setIsLoadingSubscriptions(false);
    }
  };

  const getPermissionColor = () => {
    switch (permission) {
      case 'granted':
        return 'success';
      case 'denied':
        return 'error';
      default:
        return 'warning';
    }
  };

  const getPlatformLabel = () => {
    const platform = getPlatform();
    switch (platform) {
      case Platform.ELECTRON:
        return 'Electron (Desktop App)';
      case Platform.MOBILE:
        return 'Mobile Browser';
      default:
        return 'Web Browser';
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <NotificationsActiveIcon sx={{ fontSize: 'icon.4xl' }} />
        <Typography variant="h4">Notification Debug Panel</Typography>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        This panel allows you to test and debug the notification system. All
        actions are performed on your own account.
      </Alert>

      {/* Platform Info */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Platform Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <List dense>
            <ListItem>
              <ListItemText primary="Platform" secondary={getPlatformLabel()} />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Is Electron"
                secondary={isElectron() ? 'Yes' : 'No'}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Notifications Supported"
                secondary={isSupported ? 'Yes' : 'No'}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Permission Status"
                secondary={
                  <Chip
                    label={permission}
                    color={getPermissionColor()}
                    size="small"
                  />
                }
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Push Server Enabled"
                secondary={
                  <Chip
                    label={isPushServerEnabled ? 'Yes' : 'No (VAPID keys not configured)'}
                    color={isPushServerEnabled ? 'success' : 'warning'}
                    size="small"
                  />
                }
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Push Subscribed"
                secondary={
                  <Chip
                    label={isPushSubscribed ? 'Yes' : 'No'}
                    color={isPushSubscribed ? 'success' : 'default'}
                    size="small"
                  />
                }
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItem>
          </List>
          {pushError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Push Error: {pushError}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Permission Actions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Permission Management
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              onClick={handleRequestPermission}
              disabled={isRequesting || permission === 'granted'}
              startIcon={
                isRequesting ? <CircularProgress size={16} /> : <NotificationsIcon />
              }
            >
              Request Permission
            </Button>
            <Button
              variant="outlined"
              onClick={handleSubscribePush}
              disabled={isPushLoading || isPushSubscribed || !isPushServerEnabled}
              startIcon={isPushLoading ? <CircularProgress size={16} /> : <SendIcon />}
            >
              Subscribe to Push
            </Button>
            <Button
              variant="outlined"
              onClick={handleUnsubscribePush}
              disabled={isPushLoading || !isPushSubscribed}
              startIcon={isPushLoading ? <CircularProgress size={16} /> : <DeleteSweepIcon />}
            >
              Unsubscribe from Push
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Test Actions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Test Notifications
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <Stack spacing={2}>
            <Typography variant="subtitle2" color="text.secondary">
              Local Browser Notifications
            </Typography>
            <Button
              variant="outlined"
              onClick={handleTestBrowserNotification}
              disabled={permission !== 'granted'}
              startIcon={<NotificationsIcon />}
              sx={{ alignSelf: 'flex-start' }}
            >
              Send Test Browser Notification (Local)
            </Button>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" color="text.secondary">
              Server-Side Notifications (WebSocket)
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                onClick={() => handleTestServerNotification(NotificationType.DIRECT_MESSAGE)}
                disabled={isSendingTest}
                startIcon={
                  isSendingTest ? <CircularProgress size={16} /> : <SendIcon />
                }
              >
                Test DM Notification
              </Button>
              <Button
                variant="outlined"
                onClick={() => handleTestServerNotification(NotificationType.USER_MENTION)}
                disabled={isSendingTest}
                startIcon={
                  isSendingTest ? <CircularProgress size={16} /> : <SendIcon />
                }
              >
                Test Mention Notification
              </Button>
              <Button
                variant="outlined"
                onClick={() => handleTestServerNotification(NotificationType.CHANNEL_MESSAGE)}
                disabled={isSendingTest}
                startIcon={
                  isSendingTest ? <CircularProgress size={16} /> : <SendIcon />
                }
              >
                Test Channel Notification
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" color="text.secondary">
              Push Notifications (Background)
            </Typography>
            <Button
              variant="outlined"
              onClick={handleTestPush}
              disabled={!isPushServerEnabled || !isPushSubscribed || isSendingPush}
              startIcon={isSendingPush ? <CircularProgress size={16} /> : <SendIcon />}
              sx={{ alignSelf: 'flex-start' }}
            >
              Send Test Push Notification
            </Button>
            {!isPushServerEnabled && (
              <Typography variant="caption" color="text.secondary">
                Push not available - VAPID keys not configured on server
              </Typography>
            )}
            {isPushServerEnabled && !isPushSubscribed && (
              <Typography variant="caption" color="text.secondary">
                Subscribe to push notifications first
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Push Subscriptions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Push Subscriptions</Typography>
            <Button
              onClick={handleRefreshSubscriptions}
              disabled={isLoadingSubscriptions}
              startIcon={
                isLoadingSubscriptions ? <CircularProgress size={16} /> : <RefreshIcon />
              }
              size="small"
            >
              Refresh
            </Button>
          </Stack>
          <Divider sx={{ my: 2 }} />
          {subscriptionsData?.subscriptions?.length ? (
            <List dense>
              {subscriptionsData.subscriptions.map((sub) => (
                <ListItem key={sub.id}>
                  <ListItemText
                    primary={`Endpoint: ${sub.endpoint.substring(0, 60)}...`}
                    secondary={`User Agent: ${sub.userAgent || 'Unknown'} | Created: ${new Date(sub.createdAt).toLocaleString()}`}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography color="text.secondary">
              {subscriptionsData
                ? 'No push subscriptions found'
                : 'Click Refresh to load subscriptions'}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card sx={{ mb: 3, borderColor: 'error.main', borderWidth: 1, borderStyle: 'solid' }}>
        <CardContent>
          <Typography variant="h6" color="error" gutterBottom>
            Danger Zone
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Button
            variant="outlined"
            color="error"
            onClick={handleClearSettings}
            disabled={isClearing}
            startIcon={isClearing ? <CircularProgress size={16} /> : <DeleteSweepIcon />}
          >
            Clear All Notification Data
          </Button>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            This will delete all your notifications, settings, and channel overrides.
          </Typography>
        </CardContent>
      </Card>

      {/* Test Results Log */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Test Results Log
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Paper
            variant="outlined"
            sx={{
              maxHeight: 300,
              overflow: 'auto',
              p: 2,
              bgcolor: 'background.default',
            }}
          >
            {testResults.length ? (
              testResults.map((result, i) => (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{
                    mb: 0.5,
                    fontFamily: 'monospace',
                    fontSize: 'scale.sm',
                    color: result.success ? 'success.main' : 'error.main',
                  }}
                >
                  [{result.timestamp}] {result.message}
                </Typography>
              ))
            ) : (
              <Typography color="text.secondary" variant="body2">
                No test results yet. Click a button above to test notifications.
              </Typography>
            )}
          </Paper>
        </CardContent>
      </Card>
    </Box>
  );
};

export default NotificationDebugPage;
