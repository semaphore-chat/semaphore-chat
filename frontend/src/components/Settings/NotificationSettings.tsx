/**
 * NotificationSettings Component
 *
 * UI for managing notification preferences including desktop notifications,
 * DND mode, sound settings, and default channel notification level.
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  TextField,
  Button,
  Box,
  Divider,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  InputLabel,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  PlayArrow as PlayArrowIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  notificationsControllerGetSettingsOptions,
  notificationsControllerUpdateSettingsMutation,
  pushNotificationsControllerSendTestPushToSelfMutation,
} from '../../api-client/@tanstack/react-query.gen';

import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { isElectron } from '../../utils/platform';
import { showNotification } from '../../utils/notifications';
import { logger } from '../../utils/logger';
import type { UpdateNotificationSettingsDto } from '../../types/notification.type';
import { playSound, Sounds, type SoundName } from '../../hooks/useSound';

export const NotificationSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery(notificationsControllerGetSettingsOptions());
  const { mutateAsync: updateSettings, isPending: isUpdating } = useMutation({
    ...notificationsControllerUpdateSettingsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetSettings' }] });
    },
  });
  const {
    isEnabled,
    isDenied,
    isSupported,
    requestPermission,
    isRequesting,
  } = useNotificationPermission();

  // Push notifications (web only)
  const {
    isSupported: isPushSupported,
    isServerEnabled: isPushServerEnabled,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    error: pushError,
    toggle: togglePush,
  } = usePushNotifications();

  const { mutateAsync: sendTestPush, isPending: isTestPushPending } = useMutation(
    pushNotificationsControllerSendTestPushToSelfMutation(),
  );

  const showPushOption = !isElectron() && isPushSupported && isPushServerEnabled;

  // Local form state
  const [formValues, setFormValues] = useState<UpdateNotificationSettingsDto>({
    desktopEnabled: true,
    playSound: true,
    soundType: 'default',
    doNotDisturb: false,
    dndStartTime: '22:00',
    dndEndTime: '08:00',
    defaultChannelLevel: 'mentions',
    dmNotifications: true,
  });

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testPushResult, setTestPushResult] = useState<{ success: boolean; message: string } | null>(null);

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      setFormValues({
        desktopEnabled: settings.desktopEnabled,
        playSound: settings.playSound,
        soundType: settings.soundType,
        doNotDisturb: settings.doNotDisturb,
        dndStartTime: settings.dndStartTime || '22:00',
        dndEndTime: settings.dndEndTime || '08:00',
        defaultChannelLevel: settings.defaultChannelLevel,
        dmNotifications: settings.dmNotifications,
      });
    }
  }, [settings]);

  const handleChange = <K extends keyof UpdateNotificationSettingsDto>(
    key: K,
    value: UpdateNotificationSettingsDto[K]
  ) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    try {
      await updateSettings({ body: formValues });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      logger.error('Failed to update notification settings:', error);
    }
  };

  const handleRequestPermission = async () => {
    const result = await requestPermission();
    if (result === 'granted') {
      // Enable desktop notifications after granting permission
      handleChange('desktopEnabled', true);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">Failed to load notification settings</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotificationsIcon /> Notification Settings
        </Typography>
        <Divider sx={{ mb: 3 }} />

        {/* Browser Notification Permission */}
        {isSupported && !isEnabled && (
          <Alert
            severity={isDenied ? 'error' : 'warning'}
            sx={{ mb: 3 }}
            action={
              !isDenied && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={handleRequestPermission}
                  disabled={isRequesting}
                >
                  {isRequesting ? 'Requesting...' : 'Enable'}
                </Button>
              )
            }
          >
            {isDenied
              ? 'Browser notifications are blocked. Please enable them in your browser settings.'
              : 'Browser notifications are disabled. Click "Enable" to receive desktop notifications.'}
          </Alert>
        )}

        {/* Desktop Notifications Toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={formValues.desktopEnabled}
              onChange={(e) => handleChange('desktopEnabled', e.target.checked)}
              disabled={!isSupported || isDenied}
            />
          }
          label={
            <Box>
              <Typography variant="body1">Desktop Notifications</Typography>
              <Typography variant="caption" color="text.secondary">
                Show desktop notifications for new messages and mentions
              </Typography>
            </Box>
          }
          sx={{ mb: 2, alignItems: 'flex-start' }}
        />

        {/* Push Notifications Toggle (Web PWA only) */}
        {showPushOption && (
          <>
            <FormControlLabel
              control={
                <Switch
                  checked={isPushSubscribed}
                  onChange={togglePush}
                  disabled={isPushLoading}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">Background Notifications</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Receive notifications even when the app is closed (requires PWA install)
                  </Typography>
                </Box>
              }
              sx={{ mb: 2, alignItems: 'flex-start' }}
            />
            {pushError && (
              <Alert severity="error" sx={{ mb: 2, ml: 4 }}>
                {pushError}
              </Alert>
            )}
          </>
        )}

        {/* Sound Toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={formValues.playSound}
              onChange={(e) => handleChange('playSound', e.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body1">Notification Sounds</Typography>
              <Typography variant="caption" color="text.secondary">
                Play a sound when you receive a notification
              </Typography>
            </Box>
          }
          sx={{ mb: 2, alignItems: 'flex-start' }}
        />

        {/* Sound Type Selector - shown when sound is enabled */}
        {formValues.playSound && (
          <Box sx={{ ml: 4, mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="sound-type-label">Sound Type</InputLabel>
              <Select
                labelId="sound-type-label"
                value={formValues.soundType}
                label="Sound Type"
                onChange={(e) => handleChange('soundType', e.target.value as 'default' | 'mention' | 'dm')}
              >
                <MenuItem value="default">Default</MenuItem>
                <MenuItem value="mention">Mention</MenuItem>
                <MenuItem value="dm">Direct Message</MenuItem>
              </Select>
            </FormControl>
            <Tooltip title="Test notification sound">
              <IconButton
                size="small"
                onClick={() => {
                  const soundTypeMap: Record<string, SoundName> = {
                    default: Sounds.channelMessage,
                    mention: Sounds.mention,
                    dm: Sounds.directMessage,
                  };
                  playSound(soundTypeMap[formValues.soundType] || Sounds.channelMessage);
                }}
              >
                <PlayArrowIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Do Not Disturb */}
        <FormControlLabel
          control={
            <Switch
              checked={formValues.doNotDisturb}
              onChange={(e) => handleChange('doNotDisturb', e.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body1">Do Not Disturb</Typography>
              <Typography variant="caption" color="text.secondary">
                Suppress notifications during specific hours
              </Typography>
            </Box>
          }
          sx={{ mb: 2, alignItems: 'flex-start' }}
        />

        {formValues.doNotDisturb && (
          <Box sx={{ ml: 4, mb: 3, display: 'flex', gap: 2 }}>
            <TextField
              label="Start Time"
              type="time"
              value={formValues.dndStartTime}
              onChange={(e) => handleChange('dndStartTime', e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }} // 5 min
              size="small"
            />
            <TextField
              label="End Time"
              type="time"
              value={formValues.dndEndTime}
              onChange={(e) => handleChange('dndEndTime', e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }}
              size="small"
            />
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Default Channel Notification Level */}
        <FormControl component="fieldset" sx={{ mb: 3 }}>
          <FormLabel component="legend">
            <Typography variant="body1" sx={{ mb: 1 }}>
              Default Channel Notifications
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Choose when to receive notifications from channels
            </Typography>
          </FormLabel>
          <RadioGroup
            value={formValues.defaultChannelLevel}
            onChange={(e) => handleChange('defaultChannelLevel', e.target.value as 'all' | 'mentions' | 'none')}
            sx={{ mt: 1 }}
          >
            <FormControlLabel
              value="all"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2">All Messages</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Get notified for every message in channels
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="mentions"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2">Only @mentions</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Only get notified when someone mentions you
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="none"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2">Nothing</Typography>
                  <Typography variant="caption" color="text.secondary">
                    No channel notifications (you can override per channel)
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        {/* DM Notifications Toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={formValues.dmNotifications}
              onChange={(e) => handleChange('dmNotifications', e.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body1">Direct Message Notifications</Typography>
              <Typography variant="caption" color="text.secondary">
                Get notified for all direct messages
              </Typography>
            </Box>
          }
          sx={{ mb: 3, alignItems: 'flex-start' }}
        />

        {/* Test Notifications */}
        <Typography variant="subtitle2" gutterBottom>
          Test Notifications
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<SendIcon />}
            disabled={!isEnabled}
            onClick={() => {
              showNotification({
                title: 'Test Notification',
                body: 'Desktop notifications are working!',
                tag: `test-local-${Date.now()}`,
              });
            }}
          >
            Send Test Notification
          </Button>
          {isPushSubscribed && (
            <Button
              variant="outlined"
              size="small"
              startIcon={isTestPushPending ? <CircularProgress size={16} /> : <SendIcon />}
              disabled={isTestPushPending}
              onClick={async () => {
                setTestPushResult(null);
                try {
                  const result = await sendTestPush({});
                  setTestPushResult({ success: result.success, message: result.message });
                } catch {
                  setTestPushResult({ success: false, message: 'Failed to send test push notification' });
                }
                setTimeout(() => setTestPushResult(null), 5000);
              }}
            >
              Send Test Push
            </Button>
          )}
        </Box>
        {testPushResult && (
          <Alert severity={testPushResult.success ? 'success' : 'error'} sx={{ mb: 2 }}>
            {testPushResult.message}
          </Alert>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Save Button */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isUpdating}
            startIcon={isUpdating && <CircularProgress size={20} />}
          >
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
          {saveSuccess && (
            <Typography variant="body2" color="success.main">
              Settings saved successfully!
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default NotificationSettings;
