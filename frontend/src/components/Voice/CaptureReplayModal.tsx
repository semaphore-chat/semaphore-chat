import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  ButtonGroup,
  CircularProgress,
  RadioGroup,
  FormControlLabel,
  Radio,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Collapse,
} from '@mui/material';
import { VideocamOutlined, Download, Send, VideoLibrary, ContentCut } from '@mui/icons-material';
import { useNotification } from '../../contexts/NotificationContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  channelsControllerFindAllForCommunityOptions,
  livekitControllerCaptureReplayMutation,
  directMessagesControllerFindUserDmGroupsOptions,
} from '../../api-client/@tanstack/react-query.gen';

import { useParams } from 'react-router-dom';
import { getApiUrl } from '../../config/env';
import { getAccessToken } from '../../utils/tokenService';
import { TrimPreview } from './TrimPreview';
import type { Channel } from '../../types/channel.type';
import type { DirectMessageGroup } from '../../types/direct-message.type';
import { logger } from '../../utils/logger';
import { useResponsive } from '../../hooks/useResponsive';

interface CaptureReplayModalProps {
  open: boolean;
  onClose: () => void;
}

interface DurationPreset {
  minutes: 1 | 2 | 5 | 10;
  label: string;
  estimatedSizeMB: number;
}

const DURATION_PRESETS: DurationPreset[] = [
  { minutes: 1, label: '1 min', estimatedSizeMB: 45 },
  { minutes: 2, label: '2 min', estimatedSizeMB: 90 },
  { minutes: 5, label: '5 min', estimatedSizeMB: 225 },
  { minutes: 10, label: '10 min', estimatedSizeMB: 450 },
];

export const CaptureReplayModal: React.FC<CaptureReplayModalProps> = ({
  open,
  onClose,
}) => {
  const { isMobile } = useResponsive();

  const [selectedDuration, setSelectedDuration] = useState<1 | 2 | 5 | 10>(5);
  const [destination, setDestination] = useState<'library' | 'channel' | 'dm' | 'download'>('library');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [selectedDmGroupId, setSelectedDmGroupId] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [useCustomTrim, setUseCustomTrim] = useState(false);
  const [customRange, setCustomRange] = useState<{ start: number; end: number }>({ start: 0, end: 60 });

  const queryClient = useQueryClient();
  const { mutateAsync: captureReplay, isPending: isLoading } = useMutation({
    ...livekitControllerCaptureReplayMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'livekitControllerGetMyClips' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'livekitControllerGetUserPublicClips' }] });
    },
  });

  const handleCustomRangeChange = useCallback((start: number, end: number) => {
    setCustomRange({ start, end });
  }, []);
  const { showNotification } = useNotification();

  // Reset all state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedDuration(5);
      setDestination('library');
      setSelectedChannelId('');
      setSelectedDmGroupId('');
      setUseCustomTrim(false);
      setCustomRange({ start: 0, end: 60 });
    }
  }, [open]);

  // Get current community ID from URL params
  const { communityId } = useParams<{ communityId: string }>();

  // Fetch channels for the current community
  const { data: channelsData } = useQuery({
    ...channelsControllerFindAllForCommunityOptions({ path: { communityId: communityId || '' } }),
    enabled: !!communityId && destination === 'channel',
  });

  // Fetch DM conversations
  const { data: dmsData } = useQuery({
    ...directMessagesControllerFindUserDmGroupsOptions(),
    enabled: destination === 'dm',
  });

  // Filter to text channels only (no VOICE channels)
  const textChannels = channelsData?.filter((ch: Channel) => ch.type !== 'VOICE') || [];

  // Helper function to download file via blob (with authentication)
  const downloadFileBlob = async (url: string, filename: string) => {
    const token = getAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(getApiUrl(url), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    try {
      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      // Always clean up blob URL to prevent memory leaks
      URL.revokeObjectURL(blobUrl);
    }
  };

  const handleCapture = async () => {
    try {
      // Validate destination-specific fields
      if (destination === 'channel' && !selectedChannelId) {
        showNotification('Please select a channel', 'error');
        return;
      }
      if (destination === 'dm' && !selectedDmGroupId) {
        showNotification('Please select a DM conversation', 'error');
        return;
      }

      // Handle download-only (streaming with blob download)
      if (destination === 'download') {
        setIsDownloading(true);
        try {
          const url = `/livekit/replay/stream?durationMinutes=${selectedDuration}`;
          const filename = `replay-${Date.now()}.mp4`;
          await downloadFileBlob(url, filename);
          showNotification('Replay clip downloaded successfully!', 'success');
          onClose();
        } catch (error) {
          logger.error('Failed to download replay:', error);
          showNotification('Failed to download replay clip', 'error');
        } finally {
          setIsDownloading(false);
        }
        return;
      }

      // Handle library/channel/DM saving
      const captureRequest = useCustomTrim
        ? {
            startSeconds: customRange.start,
            endSeconds: customRange.end,
            destination: destination as 'library' | 'channel' | 'dm',
            ...(destination === 'channel' && { targetChannelId: selectedChannelId }),
            ...(destination === 'dm' && { targetDirectMessageGroupId: selectedDmGroupId }),
          }
        : {
            durationMinutes: selectedDuration,
            destination: destination as 'library' | 'channel' | 'dm',
            ...(destination === 'channel' && { targetChannelId: selectedChannelId }),
            ...(destination === 'dm' && { targetDirectMessageGroupId: selectedDmGroupId }),
          };

      await captureReplay({ body: captureRequest });

      showNotification('Recording saved', 'success');

      onClose();
    } catch (error: unknown) {
      logger.error('Failed to capture replay:', error);
      const errorMessage = (error as { data?: { message?: string } })?.data?.message || 'Failed to capture replay';
      showNotification(errorMessage, 'error');
    }
  };

  const selectedPreset = DURATION_PRESETS.find(p => p.minutes === selectedDuration);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={useCustomTrim ? false : 'sm'}
      fullWidth={!useCustomTrim}
      fullScreen={isMobile && useCustomTrim}
      PaperProps={{
        sx: {
          backgroundColor: 'background.paper',
          ...(useCustomTrim && !isMobile && {
            width: '90vw',
            maxWidth: '90vw',
            height: '90vh',
            maxHeight: '90vh',
            transition: 'all 0.3s ease-in-out',
          }),
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VideocamOutlined />
          <Typography variant="h6">Capture Replay</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ py: 2 }}>
          {/* Duration Selection */}
          <Typography variant="body2" color="text.secondary" gutterBottom>
            How much time would you like to capture?
          </Typography>

          <Box sx={{ mt: 2, mb: 3 }}>
            <ButtonGroup
              variant="outlined"
              fullWidth
              sx={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
                gap: 1,
                mb: 2,
              }}
            >
              {DURATION_PRESETS.map((preset) => (
                <Button
                  key={preset.minutes}
                  variant={!useCustomTrim && selectedDuration === preset.minutes ? 'contained' : 'outlined'}
                  onClick={() => {
                    setSelectedDuration(preset.minutes);
                    setUseCustomTrim(false);
                  }}
                  sx={{
                    flexDirection: 'column',
                    py: isMobile ? 1.5 : 2,
                    gridColumn: 'span 1',
                  }}
                >
                  <Typography variant={isMobile ? 'body1' : 'h6'}>{preset.label}</Typography>
                  <Typography variant="caption" sx={{ mt: 0.5 }}>
                    ~{preset.estimatedSizeMB}MB
                  </Typography>
                </Button>
              ))}
            </ButtonGroup>

            <Button
              variant={useCustomTrim ? 'contained' : 'outlined'}
              onClick={() => setUseCustomTrim(!useCustomTrim)}
              startIcon={<ContentCut />}
              fullWidth
            >
              {useCustomTrim ? 'Custom Trim (Active)' : 'Custom Trim'}
            </Button>

            <Collapse in={useCustomTrim} unmountOnExit>
              <TrimPreview onRangeChange={handleCustomRangeChange} />
            </Collapse>
          </Box>

          {/* Destination Selection */}
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mt: 3 }}>
            What would you like to do with the clip?
          </Typography>

          <RadioGroup
            value={destination}
            onChange={(e) => setDestination(e.target.value as 'library' | 'channel' | 'dm' | 'download')}
            sx={{ mt: 1 }}
          >
            <FormControlLabel
              value="library"
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mb: 1 }}
              label={
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pt: 0.5 }}>
                  <VideoLibrary fontSize="small" sx={{ mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2">Save to my library</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Access later from your profile settings
                    </Typography>
                  </Box>
                </Box>
              }
            />
            <FormControlLabel
              value="channel"
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mb: 1 }}
              label={
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pt: 0.5 }}>
                  <Send fontSize="small" sx={{ mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2">Share to channel</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Post in a channel and save to your library
                    </Typography>
                  </Box>
                </Box>
              }
            />
            <FormControlLabel
              value="dm"
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mb: 1 }}
              label={
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pt: 0.5 }}>
                  <Send fontSize="small" sx={{ mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2">Share to DM</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Send to a conversation and save to your library
                    </Typography>
                  </Box>
                </Box>
              }
            />
            <FormControlLabel
              value="download"
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mb: 1 }}
              label={
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pt: 0.5 }}>
                  <Download fontSize="small" sx={{ mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2">Download only</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Download to your device without saving to server
                    </Typography>
                  </Box>
                </Box>
              }
            />
          </RadioGroup>

          {/* Channel Selector */}
          {destination === 'channel' && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Select Channel</InputLabel>
              <Select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                label="Select Channel"
              >
                {textChannels.map((channel: Channel) => (
                  <MenuItem key={channel.id} value={channel.id}>
                    #{channel.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* DM Selector */}
          {destination === 'dm' && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Select DM</InputLabel>
              <Select
                value={selectedDmGroupId}
                onChange={(e) => setSelectedDmGroupId(e.target.value)}
                label="Select DM"
              >
                {dmsData?.map((dm: DirectMessageGroup) => (
                  <MenuItem key={dm.id} value={dm.id}>
                    {dm.members.map((member) => member.user.username).join(', ')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Info Box */}
          {!useCustomTrim && (
            <Box
              sx={{
                mt: 3,
                p: 2,
                backgroundColor: 'action.hover',
                borderRadius: 1,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                <strong>Note:</strong> The replay will be captured from your current screen share buffer.
                Make sure you've been sharing your screen for at least {selectedPreset?.label} to
                capture the full duration.
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={isLoading || isDownloading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCapture}
          disabled={isLoading || isDownloading}
          startIcon={(isLoading || isDownloading) ? <CircularProgress size={20} /> : <VideocamOutlined />}
        >
          {isDownloading
            ? 'Downloading...'
            : isLoading
              ? 'Capturing...'
              : 'Capture'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
