import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import AudioVideoSettingsPanel from '../Settings/AudioVideoSettingsPanel';

interface DeviceSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onDeviceChange?: (type: 'audio' | 'video', deviceId: string) => void;
}

export const DeviceSettingsDialog: React.FC<DeviceSettingsDialogProps> = ({
  open,
  onClose,
  onDeviceChange,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    maxWidth="md"
    fullWidth
    PaperProps={{ sx: { minHeight: '500px' } }}
  >
    <DialogTitle>Voice & Video Settings</DialogTitle>
    <DialogContent dividers>
      <AudioVideoSettingsPanel
        onDeviceChange={onDeviceChange}
        active={open}
        showHeader={false}
      />
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Done</Button>
    </DialogActions>
  </Dialog>
);
