import React, { useState, useRef, useEffect } from 'react';
import {
  Typography,
  Divider,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Paper,
  Alert,
  Chip,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Slider,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Mic,
  MicOff,
  Videocam,
  VideocamOff,
  Refresh,
  CheckCircle,
  Error as ErrorIcon,
  Keyboard,
  VolumeUp,
  InfoOutlined,
} from '@mui/icons-material';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useDeviceTest, getDeviceLabel } from '../../hooks/useDeviceTest';
import { useVoiceSettings, VoiceInputMode } from '../../hooks/useVoiceSettings';

interface AudioVideoSettingsPanelProps {
  /** Callback when user changes device selection (for live-switching during calls) */
  onDeviceChange?: (type: 'audio' | 'video', deviceId: string) => void;
  /** When false, stops active device tests. Dialog passes `open` here. Default: true */
  active?: boolean;
  /** Whether to show the "Voice & Video" title row with refresh icon. Default: true */
  showHeader?: boolean;
}

const AudioVideoSettingsPanel: React.FC<AudioVideoSettingsPanelProps> = ({
  onDeviceChange,
  active = true,
  showHeader = true,
}) => {
  const [isRecordingKey, setIsRecordingKey] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    audioInputDevices,
    audioOutputDevices,
    videoInputDevices,
    selectedAudioInputId,
    selectedAudioOutputId,
    selectedVideoInputId,
    setSelectedAudioInput,
    setSelectedAudioOutput,
    setSelectedVideoInput,
    isLoading,
    permissions,
    requestPermissions,
    enumerateDevices,
    getAudioConstraints,
    getVideoConstraints,
  } = useDeviceSettings();

  const {
    testingAudio,
    testingVideo,
    audioLevel,
    rawAudioLevel,
    testAudioInput,
    testVideoInput,
    stopAudioTest,
    stopVideoTest,
  } = useDeviceTest({ videoRef, getAudioConstraints, getVideoConstraints });

  const {
    inputMode,
    pushToTalkKeyDisplay,
    voiceActivityThreshold,
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    voiceIsolation,
    setInputMode,
    setPushToTalkKey,
    setVoiceActivityThreshold,
    setAudioProcessing,
  } = useVoiceSettings();

  const handleInputModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newMode: VoiceInputMode | null
  ) => {
    if (newMode) {
      setInputMode(newMode);
    }
  };

  // Handle key recording for PTT
  useEffect(() => {
    if (!isRecordingKey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Ignore modifier keys alone
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
        return;
      }

      setPushToTalkKey(event);
      setIsRecordingKey(false);
    };

    const handleBlur = () => {
      setIsRecordingKey(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isRecordingKey, setPushToTalkKey]);

  // Stop device tests when panel becomes inactive (e.g., dialog closes)
  useEffect(() => {
    if (!active) {
      stopAudioTest();
      stopVideoTest();
    }
  }, [active, stopAudioTest, stopVideoTest]);

  const handleRefreshDevices = async () => {
    await requestPermissions();
    await enumerateDevices();
  };

  const handleAudioInputChange = (deviceId: string) => {
    setSelectedAudioInput(deviceId);
    onDeviceChange?.('audio', deviceId);
  };

  const handleVideoInputChange = (deviceId: string) => {
    setSelectedVideoInput(deviceId);
    if (testingVideo) {
      stopVideoTest();
    }
    onDeviceChange?.('video', deviceId);
  };

  return (
    <Box>
      {showHeader && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <VolumeUp /> Voice & Video
            </Typography>
            <IconButton onClick={handleRefreshDevices} disabled={isLoading} size="small">
              <Refresh />
            </IconButton>
          </Box>
          <Divider sx={{ mb: 3 }} />
        </>
      )}

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Input Mode Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Input Mode
        </Typography>
        <ToggleButtonGroup
          value={inputMode}
          exclusive
          onChange={handleInputModeChange}
          size="small"
        >
          <ToggleButton value="voice_activity">
            Voice Activity
          </ToggleButton>
          <ToggleButton value="push_to_talk">
            Push to Talk
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {inputMode === 'voice_activity'
            ? 'Your microphone is always active when unmuted'
            : 'Hold a key to transmit audio'}
        </Typography>
      </Box>

      {/* Input Sensitivity (only shown when voice_activity mode is selected) */}
      {inputMode === 'voice_activity' && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Input Sensitivity
          </Typography>
          <Slider
            value={voiceActivityThreshold}
            onChange={(_, val) => setVoiceActivityThreshold(val as number)}
            min={0}
            max={100}
            marks={[
              { value: 0, label: 'High' },
              { value: 50, label: 'Medium' },
              { value: 100, label: 'Low' },
            ]}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `Sensitivity: ${100 - v}%`}
            size="small"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Move the slider left for higher sensitivity (picks up quieter sounds), right for lower sensitivity.
          </Typography>
        </Box>
      )}

      {/* Push to Talk Key (only shown when PTT mode is selected) */}
      {inputMode === 'push_to_talk' && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Push to Talk Key
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Paper
              sx={{
                px: 2,
                py: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minWidth: 120,
                justifyContent: 'center',
                bgcolor: isRecordingKey ? 'primary.main' : 'background.default',
                color: isRecordingKey ? 'primary.contrastText' : 'text.primary',
                transition: 'all 0.2s',
              }}
            >
              <Keyboard fontSize="small" />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {isRecordingKey ? 'Press a key...' : pushToTalkKeyDisplay}
              </Typography>
            </Paper>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setIsRecordingKey(!isRecordingKey)}
            >
              {isRecordingKey ? 'Cancel' : 'Change Key'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            This key will activate your microphone while held
          </Typography>
        </Box>
      )}

      {/* Audio Processing Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Audio Processing
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', ml: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={echoCancellation}
                onChange={(e) => setAudioProcessing('echoCancellation', e.target.checked)}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Echo Cancellation</Typography>
                <Typography variant="caption" color="text.secondary">
                  Reduces echo from your speakers
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={noiseSuppression}
                onChange={(e) => setAudioProcessing('noiseSuppression', e.target.checked)}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Noise Suppression</Typography>
                <Typography variant="caption" color="text.secondary">
                  Filters out steady background noise
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={autoGainControl}
                onChange={(e) => setAudioProcessing('autoGainControl', e.target.checked)}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Auto Gain Control</Typography>
                <Typography variant="caption" color="text.secondary">
                  Automatically adjusts microphone volume
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={voiceIsolation}
                onChange={(e) => setAudioProcessing('voiceIsolation', e.target.checked)}
                size="small"
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2">Voice Isolation</Typography>
                    <Chip label="Experimental" size="small" variant="outlined" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Uses AI to isolate your voice
                  </Typography>
                </Box>
              </Box>
            }
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, ml: 1 }}>
          <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">
            Changes take effect the next time you join a voice channel.
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* Audio Input Device */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Microphone</Typography>
          <Chip
            size="small"
            icon={permissions.microphone ? <CheckCircle /> : <ErrorIcon />}
            label={permissions.microphone ? 'Granted' : 'Not Granted'}
            color={permissions.microphone ? 'success' : 'error'}
          />
        </Box>
        {!permissions.microphone && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Microphone permission is required.{' '}
            <Button size="small" onClick={requestPermissions}>
              Request Permission
            </Button>
          </Alert>
        )}
        <FormControl fullWidth size="small">
          <InputLabel>Microphone</InputLabel>
          <Select
            value={selectedAudioInputId}
            label="Microphone"
            onChange={(e) => handleAudioInputChange(e.target.value)}
            disabled={!permissions.microphone || audioInputDevices.length === 0}
          >
            {audioInputDevices.length === 0 ? (
              <MenuItem value="">No devices found</MenuItem>
            ) : (
              audioInputDevices.map((device) => (
                <MenuItem key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device)}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Box>

      {/* Audio Output Device */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Speakers
        </Typography>
        <FormControl fullWidth size="small">
          <InputLabel>Speakers</InputLabel>
          <Select
            value={selectedAudioOutputId}
            label="Speakers"
            onChange={(e) => setSelectedAudioOutput(e.target.value)}
            disabled={audioOutputDevices.length === 0}
          >
            {audioOutputDevices.length === 0 ? (
              <MenuItem value="">No devices found</MenuItem>
            ) : (
              audioOutputDevices.map((device) => (
                <MenuItem key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device)}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Box>

      {/* Microphone Test */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2">Test Microphone</Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={testingAudio ? <MicOff /> : <Mic />}
            onClick={testAudioInput}
            disabled={!permissions.microphone}
          >
            {testingAudio ? 'Stop' : 'Test'}
          </Button>
        </Box>
        {testingAudio && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Microphone Level
              </Typography>
              {inputMode === 'voice_activity' ? (
                <Typography
                  variant="caption"
                  fontWeight="medium"
                  color={rawAudioLevel > voiceActivityThreshold ? 'success.main' : 'text.secondary'}
                >
                  {rawAudioLevel > voiceActivityThreshold ? 'Transmitting' : 'Gated'}
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {Math.round(audioLevel)}%
                </Typography>
              )}
            </Box>
            <Box sx={{ position: 'relative' }}>
              <LinearProgress
                variant="determinate"
                value={inputMode === 'voice_activity' ? rawAudioLevel : audioLevel}
                sx={{
                  height: 8,
                  borderRadius: 1,
                  backgroundColor: 'grey.300',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: inputMode === 'voice_activity'
                      ? (rawAudioLevel > voiceActivityThreshold ? 'success.main' : 'grey.500')
                      : (audioLevel > 80 ? 'error.main' : audioLevel > 50 ? 'warning.main' : 'success.main'),
                  },
                }}
              />
              {inputMode === 'voice_activity' && (
                <Box
                  data-testid="threshold-marker"
                  sx={{
                    position: 'absolute',
                    // Marker position matches the raw-scale progress bar.
                    left: `${voiceActivityThreshold}%`,
                    top: -2,
                    bottom: -2,
                    width: 2,
                    backgroundColor: 'warning.main',
                    borderRadius: 1,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </Box>
            {inputMode === 'voice_activity' && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                The marker shows your sensitivity threshold — audio above it is transmitted.
              </Typography>
            )}
          </Box>
        )}
        {!testingAudio && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Click "Test" and speak to verify your microphone
          </Typography>
        )}
      </Paper>

      <Divider sx={{ my: 3 }} />

      {/* Video Input Device */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Camera</Typography>
          <Chip
            size="small"
            icon={permissions.camera ? <CheckCircle /> : <ErrorIcon />}
            label={permissions.camera ? 'Granted' : 'Not Granted'}
            color={permissions.camera ? 'success' : 'error'}
          />
        </Box>
        {!permissions.camera && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Camera permission is required.{' '}
            <Button size="small" onClick={requestPermissions}>
              Request Permission
            </Button>
          </Alert>
        )}
        <FormControl fullWidth size="small">
          <InputLabel>Camera</InputLabel>
          <Select
            value={selectedVideoInputId}
            label="Camera"
            onChange={(e) => handleVideoInputChange(e.target.value)}
            disabled={!permissions.camera || videoInputDevices.length === 0}
          >
            {videoInputDevices.length === 0 ? (
              <MenuItem value="">No devices found</MenuItem>
            ) : (
              videoInputDevices.map((device) => (
                <MenuItem key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device)}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Box>

      {/* Camera Test */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle2">Test Camera</Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={testingVideo ? <VideocamOff /> : <Videocam />}
            onClick={testVideoInput}
            disabled={!permissions.camera}
          >
            {testingVideo ? 'Stop' : 'Test'}
          </Button>
        </Box>
        <Box
          sx={{
            width: '100%',
            height: 200,
            backgroundColor: 'grey.200',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {testingVideo ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
              <Videocam sx={{ fontSize: 48, mb: 1 }} />
              <Typography variant="body2">
                Click "Test" to preview your camera
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {/* Refresh Devices Button */}
      {!showHeader && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Refresh />}
            onClick={handleRefreshDevices}
            disabled={isLoading}
          >
            Refresh Devices
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default AudioVideoSettingsPanel;
