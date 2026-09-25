import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Divider,
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  alpha,
} from '@mui/material';
import {
  Settings,
  CheckCircle,
  Error as ErrorIcon,
  Palette,
} from '@mui/icons-material';
import axios from 'axios';
import NotificationSettings from '../components/Settings/NotificationSettings';
import InstallAppSettings from '../components/Settings/InstallAppSettings';
import VoiceSettings from '../components/Settings/VoiceSettings';
import SessionsSettings from '../components/Settings/SessionsSettings';
import { useTheme, type ThemeIntensity } from '../contexts/ThemeContext';
import { accentColors } from '../theme/constants';
import { isElectron, hasElectronFeature, getElectronAPI } from '../utils/platform';
import { getActiveServer, updateServer } from '../utils/serverStorage';

interface HealthResponse {
  status: string;
  instanceName: string;
  version: string;
  timestamp: string;
}

// Appearance Settings Component
const AppearanceSettings: React.FC = () => {
  const { settings, setAccentColor, setIntensity, toggleMode } = useTheme();

  const handleIntensityChange = (
    _event: React.MouseEvent<HTMLElement>,
    newIntensity: ThemeIntensity | null
  ) => {
    if (newIntensity) {
      setIntensity(newIntensity);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Palette /> Appearance
        </Typography>
        <Divider sx={{ mb: 3 }} />

        {/* Dark/Light Mode Toggle */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Theme Mode
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={settings.mode === 'dark'}
                onChange={toggleMode}
              />
            }
            label={settings.mode === 'dark' ? 'Dark Mode' : 'Light Mode'}
          />
        </Box>

        {/* Accent Color Selection */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Accent Color
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {accentColors.map((color) => (
              <Box
                key={color.id}
                onClick={() => setAccentColor(color.id)}
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  backgroundColor: color.primary,
                  cursor: 'pointer',
                  border: settings.accentColor === color.id
                    ? '3px solid white'
                    : '3px solid transparent',
                  boxShadow: settings.accentColor === color.id
                    ? `0 0 0 2px ${color.primary}`
                    : 'none',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    boxShadow: `0 4px 12px ${alpha(color.primary, 0.4)}`,
                  },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={color.name}
              >
                {settings.accentColor === color.id && (
                  <CheckCircle sx={{ color: 'white', fontSize: 24 }} />
                )}
              </Box>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {accentColors.find((c) => c.id === settings.accentColor)?.name}
          </Typography>
        </Box>

        {/* Theme Intensity */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Theme Intensity
          </Typography>
          <ToggleButtonGroup
            value={settings.intensity}
            exclusive
            onChange={handleIntensityChange}
            size="small"
          >
            <ToggleButton value="minimal">
              Minimal
            </ToggleButton>
            <ToggleButton value="balanced">
              Balanced
            </ToggleButton>
            <ToggleButton value="vibrant">
              Vibrant
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {settings.intensity === 'minimal'
              ? 'Clean, neutral look with minimal accent color'
              : settings.intensity === 'balanced'
              ? 'Soft gradients and accent color highlights'
              : 'Bold, eye-catching accent colors throughout'}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

const SettingsPage: React.FC = () => {
  const [isElectronApp, setIsElectronApp] = useState(false);
  const [currentBackendUrl, setCurrentBackendUrl] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBackendUrl, setNewBackendUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isElectron()) return;

    setIsElectronApp(true);

    // Get current backend URL from serverStorage
    const activeServer = getActiveServer();
    if (activeServer) {
      setCurrentBackendUrl(activeServer.url);
      setActiveServerId(activeServer.id);

      // Fetch backend version and instance name from health endpoint
      axios.get<HealthResponse>(`${activeServer.url}/api/health`)
        .then(response => {
          setBackendVersion(response.data.version);
          setInstanceName(response.data.instanceName || null);
        })
        .catch(() => {
          // Ignore errors
        });
    }

    // Get app version from Electron API
    if (hasElectronFeature('getAppVersion')) {
      getElectronAPI()?.getAppVersion?.()
        .then(version => {
          setAppVersion(version);
        })
        .catch(() => {
          // Ignore errors
        });
    }
  }, []);

  const validateBackendUrl = async (url: string): Promise<boolean> => {
    // Strip trailing slashes
    const cleanUrl = url.replace(/\/+$/, '');

    // Validate URL format
    try {
      const urlObj = new URL(cleanUrl);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        setValidationError('URL must start with http:// or https://');
        return false;
      }
    } catch {
      setValidationError('Please enter a valid URL (e.g., https://chat.example.com)');
      return false;
    }

    // Test connection to /api/health
    try {
      const response = await axios.get<HealthResponse>(`${cleanUrl}/api/health`, {
        timeout: 10000, // 10 second timeout
      });

      if (response.data && response.data.status === 'ok') {
        const instanceName = response.data.instanceName || 'Unknown Instance';
        setValidationSuccess(`Connected to: ${instanceName}`);
        return true;
      } else {
        setValidationError('Server responded but health check failed');
        return false;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          setValidationError('Connection timed out. Please check the URL and try again.');
        } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
          setValidationError(`Cannot connect to ${cleanUrl}. Please check the URL.`);
        } else if (error.response) {
          setValidationError(`Server error: ${error.response.status} ${error.response.statusText}`);
        } else {
          setValidationError(`Failed to connect: ${error.message}`);
        }
      } else {
        setValidationError('An unexpected error occurred');
      }
      return false;
    }
  };

  const handleOpenDialog = () => {
    setNewBackendUrl(currentBackendUrl || '');
    setDialogOpen(true);
    setValidationError(null);
    setValidationSuccess(null);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setNewBackendUrl('');
    setValidationError(null);
    setValidationSuccess(null);
  };

  const handleSaveBackendUrl = async () => {
    if (!newBackendUrl.trim()) {
      setValidationError('Please enter a backend URL');
      return;
    }

    setIsValidating(true);
    setValidationError(null);
    setValidationSuccess(null);

    const cleanUrl = newBackendUrl.trim().replace(/\/+$/, '');
    const isValid = await validateBackendUrl(cleanUrl);

    setIsValidating(false);

    if (isValid) {
      // Update the active server in serverStorage
      if (activeServerId) {
        updateServer(activeServerId, { url: cleanUrl });
      }

      // Reload the app to apply the new configuration
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  };

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Settings /> Settings
      </Typography>

      {/* Install App Section (web, only when installable) */}
      <InstallAppSettings />

      {/* Notification Settings Section */}
      <Box sx={{ mb: 3 }}>
        <NotificationSettings />
      </Box>

      {/* Voice & Video Settings Section */}
      <VoiceSettings />

      {/* Appearance Settings Section */}
      <AppearanceSettings />

      {/* Sessions Settings Section */}
      <SessionsSettings />

      {/* Backend Configuration Section (Electron only) */}
      {isElectronApp && (
        <>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Backend Configuration
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Typography variant="body2" color="text.secondary" paragraph>
                Current backend URL:
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace', mb: 2 }}>
                {currentBackendUrl || 'Not configured'}
              </Typography>

              <Button variant="contained" onClick={handleOpenDialog}>
                Change Backend URL
              </Button>

              <Alert severity="warning" sx={{ mt: 2 }}>
                Changing the backend URL will reload the application.
              </Alert>
            </CardContent>
          </Card>

          {/* App Information Section */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                App Information
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {instanceName && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Instance:
                    </Typography>
                    <Typography variant="body2">
                      {instanceName}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">
                    App Version:
                  </Typography>
                  <Typography variant="body2">
                    {appVersion || 'Unknown'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">
                    Backend Version:
                  </Typography>
                  <Typography variant="body2">
                    {backendVersion || 'Unknown'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {/* Change Backend URL Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Change Backend URL</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            Enter the URL of your Semaphore Chat backend server. The app will reload after the change.
          </Typography>

          <TextField
            // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
            autoFocus
            fullWidth
            label="Backend URL"
            placeholder="https://chat.example.com"
            value={newBackendUrl}
            onChange={(e) => setNewBackendUrl(e.target.value)}
            disabled={isValidating}
            sx={{ mt: 2 }}
            helperText="The URL should not include /api or trailing slashes"
          />

          {validationError && (
            <Alert severity="error" icon={<ErrorIcon />} sx={{ mt: 2 }}>
              {validationError}
            </Alert>
          )}

          {validationSuccess && (
            <Alert severity="success" icon={<CheckCircle />} sx={{ mt: 2 }}>
              {validationSuccess}
              <Typography variant="body2" sx={{ mt: 1 }}>
                Reloading app...
              </Typography>
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={isValidating}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveBackendUrl}
            variant="contained"
            disabled={isValidating || !newBackendUrl.trim()}
            startIcon={isValidating && <CircularProgress size={20} />}
          >
            {isValidating ? 'Testing...' : 'Save & Reload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SettingsPage;
