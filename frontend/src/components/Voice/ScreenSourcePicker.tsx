import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material';
import {
  Monitor,
  Window as WindowIcon,
} from '@mui/icons-material';
import { logger } from '../../utils/logger';
import { supportsSystemAudio } from '../../utils/platform';
import { useElectronAPI } from '../../contexts/ElectronContext';

// TypeScript types for screen share settings
export type ResolutionPreset = 'native' | '4k' | '1440p' | '1080p' | '720p' | '480p';

export interface ScreenShareSettings {
  resolution: ResolutionPreset;
  fps: 15 | 30 | 60;
  enableAudio: boolean;
}

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id?: string;
  appIcon?: string;
}

interface ScreenSourcePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sourceId: string, settings: ScreenShareSettings) => void;
}

// Resolution presets configuration
const RESOLUTION_PRESETS = {
  native: { width: undefined, height: undefined, label: 'Native Resolution' },
  '4k': { width: 3840, height: 2160, label: '4K (3840×2160)' },
  '1440p': { width: 2560, height: 1440, label: '1440p (2560×1440)' },
  '1080p': { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  '720p': { width: 1280, height: 720, label: '720p (1280×720)' },
  '480p': { width: 854, height: 480, label: '480p (854×480)' },
};

// LocalStorage key
const SCREEN_SHARE_SETTINGS_KEY = 'semaphore_screen_share_settings';

// Load settings from localStorage
const loadScreenShareSettings = (): ScreenShareSettings => {
  try {
    const saved = localStorage.getItem(SCREEN_SHARE_SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    logger.error('Failed to load screen share settings:', error);
  }

  // Default settings
  return {
    resolution: '1080p',
    fps: 60,
    enableAudio: true,
  };
};

// Save settings to localStorage
const saveScreenShareSettings = (settings: ScreenShareSettings) => {
  try {
    localStorage.setItem(SCREEN_SHARE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    logger.error('Failed to save screen share settings:', error);
  }
};

export const ScreenSourcePicker: React.FC<ScreenSourcePickerProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const electronAPI = useElectronAPI();

  // Check platform capability for system audio
  const systemAudioSupported = supportsSystemAudio(electronAPI);

  // Settings state — force enableAudio off when system audio is not supported
  const [settings, setSettings] = useState<ScreenShareSettings>(() => {
    const saved = loadScreenShareSettings();
    if (!systemAudioSupported) {
      saved.enableAudio = false;
    }
    return saved;
  });

  // Fetch desktop sources when dialog opens
  useEffect(() => {
    if (!open) {
      return;
    }

    const fetchSources = async () => {
      setLoading(true);
      setError(null);
      setSources([]);
      setSelectedSourceId(null);

      try {
        // Check if Electron API is available
        if (!electronAPI?.getDesktopSources) {
          throw new Error('Screen capture is only available in the desktop app');
        }

        const desktopSources = await electronAPI.getDesktopSources(['screen', 'window']);

        if (!desktopSources || desktopSources.length === 0) {
          throw new Error('No screens or windows available to share');
        }

        setSources(desktopSources);
      } catch (err) {
        logger.error('Failed to get desktop sources:', err);
        setError(err instanceof Error ? err.message : 'Failed to load available sources');
      } finally {
        setLoading(false);
      }
    };

    fetchSources();
  }, [electronAPI, open]);

  const handleSourceClick = (sourceId: string) => {
    setSelectedSourceId(sourceId);
  };

  const handleConfirm = () => {
    if (selectedSourceId) {
      saveScreenShareSettings(settings);
      onSelect(selectedSourceId, settings);
      onClose();
    }
  };

  const handleCancel = () => {
    setSelectedSourceId(null);
    onClose();
  };

  // Handle resolution change
  const handleResolutionChange = (resolution: ResolutionPreset) => {
    setSettings(prev => ({
      ...prev,
      resolution,
    }));
  };

  // Handle FPS change
  const handleFPSChange = (fps: 15 | 30 | 60) => {
    setSettings(prev => ({
      ...prev,
      fps,
    }));
  };

  // Handle audio toggle
  const handleAudioToggle = (enableAudio: boolean) => {
    setSettings(prev => ({
      ...prev,
      enableAudio,
    }));
  };

  // Separate screens and windows
  const screens = sources.filter(s => s.id.startsWith('screen:'));
  const windows = sources.filter(s => s.id.startsWith('window:'));

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '60vh',
          maxHeight: '80vh',
        },
      }}
    >
      <DialogTitle>
        Choose what to share
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Select a screen or application window to share
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 3 }}>
        {loading && (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && sources.length > 0 && (
          <Box>
            {/* Screens Section */}
            {screens.length > 0 && (
              <Box mb={4}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <Monitor fontSize="small" color="primary" />
                  <Typography variant="subtitle2" color="text.secondary" textTransform="uppercase">
                    Entire Screens
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  {screens.map((source) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={source.id}>
                      <Paper
                        elevation={selectedSourceId === source.id ? 8 : 1}
                        sx={{
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          border: selectedSourceId === source.id ? 2 : 1,
                          borderColor: selectedSourceId === source.id ? 'primary.main' : 'divider',
                          '&:hover': {
                            elevation: 4,
                            borderColor: 'primary.main',
                            transform: 'translateY(-2px)',
                          },
                        }}
                        onClick={() => handleSourceClick(source.id)}
                      >
                        <Box p={1.5}>
                          <Box
                            component="img"
                            src={source.thumbnail}
                            alt={source.name}
                            sx={{
                              width: '100%',
                              aspectRatio: '16/9',
                              objectFit: 'contain',
                              backgroundColor: 'grey.900',
                              borderRadius: 1,
                              mb: 1,
                            }}
                          />
                          <Typography
                            variant="body2"
                            noWrap
                            textAlign="center"
                            fontWeight={selectedSourceId === source.id ? 600 : 400}
                          >
                            {source.name}
                          </Typography>
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {/* Windows Section */}
            {windows.length > 0 && (
              <Box>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <WindowIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" color="text.secondary" textTransform="uppercase">
                    Application Windows
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  {windows.map((source) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={source.id}>
                      <Paper
                        elevation={selectedSourceId === source.id ? 8 : 1}
                        sx={{
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          border: selectedSourceId === source.id ? 2 : 1,
                          borderColor: selectedSourceId === source.id ? 'primary.main' : 'divider',
                          '&:hover': {
                            elevation: 4,
                            borderColor: 'primary.main',
                            transform: 'translateY(-2px)',
                          },
                        }}
                        onClick={() => handleSourceClick(source.id)}
                      >
                        <Box p={1.5}>
                          <Box
                            component="img"
                            src={source.thumbnail}
                            alt={source.name}
                            sx={{
                              width: '100%',
                              aspectRatio: '16/9',
                              objectFit: 'contain',
                              backgroundColor: 'grey.900',
                              borderRadius: 1,
                              mb: 1,
                            }}
                          />
                          <Box display="flex" alignItems="center" gap={1} justifyContent="center">
                            {source.appIcon && (
                              <Box
                                component="img"
                                src={source.appIcon}
                                alt=""
                                sx={{
                                  width: 16,
                                  height: 16,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <Typography
                              variant="body2"
                              noWrap
                              fontWeight={selectedSourceId === source.id ? 600 : 400}
                              sx={{ flex: 1, textAlign: source.appIcon ? 'left' : 'center' }}
                            >
                              {source.name}
                            </Typography>
                          </Box>
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        {/* Settings Controls - Left Aligned */}
        <Box display="flex" alignItems="center" gap={2}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Resolution</InputLabel>
            <Select
              value={settings.resolution}
              label="Resolution"
              onChange={(e) => handleResolutionChange(e.target.value as ResolutionPreset)}
            >
              {(Object.keys(RESOLUTION_PRESETS) as ResolutionPreset[]).map((key) => (
                <MenuItem key={key} value={key}>
                  {RESOLUTION_PRESETS[key].label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel>FPS</InputLabel>
            <Select
              value={settings.fps}
              label="FPS"
              onChange={(e) => handleFPSChange(e.target.value as 15 | 30 | 60)}
            >
              <MenuItem value={15}>15</MenuItem>
              <MenuItem value={30}>30</MenuItem>
              <MenuItem value={60}>60</MenuItem>
            </Select>
          </FormControl>

          <Tooltip
            title={systemAudioSupported ? '' : 'System audio sharing is not supported on this platform'}
            placement="top"
          >
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enableAudio}
                  onChange={(e) => handleAudioToggle(e.target.checked)}
                  color="primary"
                  size="small"
                  disabled={!systemAudioSupported}
                />
              }
              label="System Audio"
            />
          </Tooltip>
        </Box>

        {/* Action Buttons - Right Aligned */}
        <Box display="flex" gap={1}>
          <Button onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={!selectedSourceId}
          >
            Share
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
