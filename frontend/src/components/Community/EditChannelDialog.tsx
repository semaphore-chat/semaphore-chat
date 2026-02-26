import React, { useState, useCallback, useEffect } from "react";
import {
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { channelsControllerUpdateMutation } from "../../api-client/@tanstack/react-query.gen";
import type { Channel } from "../../types/channel.type";
import { logger } from "../../utils/logger";
import { invalidateChannelQueries } from "../../utils/queryInvalidation";

interface EditChannelDialogProps {
  open: boolean;
  onClose: () => void;
  channel: Channel | null;
}

interface EditChannelFormData {
  name: string;
  isPrivate: boolean;
}

const initialFormData: EditChannelFormData = {
  name: "",
  isPrivate: false,
};

const EditChannelDialog: React.FC<EditChannelDialogProps> = ({
  open,
  onClose,
  channel,
}) => {
  const [formData, setFormData] = useState<EditChannelFormData>(initialFormData);
  const queryClient = useQueryClient();

  const { mutateAsync: updateChannel, isPending: updatingChannel } = useMutation({
    ...channelsControllerUpdateMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });

  useEffect(() => {
    if (channel) {
      setFormData({
        name: channel.name,
        isPrivate: channel.isPrivate,
      });
    } else {
      setFormData(initialFormData);
    }
  }, [channel]);

  const handleClose = useCallback(() => {
    onClose();
    setFormData(initialFormData);
  }, [onClose]);

  const handleUpdate = useCallback(async () => {
    if (!channel || !formData.name.trim()) return;

    try {
      await updateChannel({
        path: { id: channel.id },
        body: {
          name: formData.name.trim(),
          isPrivate: formData.isPrivate,
        },
      });

      handleClose();
    } catch (error) {
      logger.error("Failed to update channel:", error);
    }
  }, [channel, formData, updateChannel, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Channel</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Channel Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          fullWidth
          margin="normal"
        />
        <FormControlLabel
          control={
            <Switch
              checked={formData.isPrivate}
              onChange={(e) => setFormData({ ...formData, isPrivate: e.target.checked })}
            />
          }
          label="Private Channel"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleUpdate}
          variant="contained"
          disabled={!formData.name.trim() || updatingChannel}
        >
          {updatingChannel ? <CircularProgress size={20} /> : "Update Channel"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditChannelDialog;
