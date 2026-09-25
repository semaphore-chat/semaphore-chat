import React, { useState, useCallback } from "react";
import {
  Button,
  TextField,
  FormControlLabel,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  DialogContent,
  DialogActions,
  Typography,
  CircularProgress,
} from "@mui/material";
import ResponsiveDialog from "../Common/ResponsiveDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { channelsControllerCreateMutation } from "../../api-client/@tanstack/react-query.gen";
import { logger } from "../../utils/logger";
import { invalidateChannelQueries } from "../../utils/queryInvalidation";

interface CreateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  communityId: string;
}

interface CreateChannelFormData {
  name: string;
  type: "TEXT" | "VOICE";
  isPrivate: boolean;
}

const initialFormData: CreateChannelFormData = {
  name: "",
  type: "TEXT",
  isPrivate: false,
};

const CreateChannelDialog: React.FC<CreateChannelDialogProps> = ({
  open,
  onClose,
  communityId,
}) => {
  const [formData, setFormData] = useState<CreateChannelFormData>(initialFormData);
  const queryClient = useQueryClient();

  const { mutateAsync: createChannel, isPending: creatingChannel } = useMutation({
    ...channelsControllerCreateMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });

  const handleClose = useCallback(() => {
    onClose();
    setFormData(initialFormData);
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    if (!formData.name.trim()) return;

    try {
      await createChannel({
        body: {
          name: formData.name.trim(),
          type: formData.type,
          communityId,
          isPrivate: formData.isPrivate,
        },
      });

      handleClose();
    } catch (error) {
      logger.error("Failed to create channel:", error);
    }
  }, [formData, communityId, createChannel, handleClose]);

  return (
    <ResponsiveDialog open={open} onClose={handleClose} maxWidth="sm" fullWidth title="Create New Channel">
      <DialogContent>
        <TextField
          // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
          autoFocus
          label="Channel Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          fullWidth
          margin="normal"
          placeholder="general, announcements, etc."
        />
        <FormControl fullWidth margin="normal">
          <InputLabel>Channel Type</InputLabel>
          <Select
            value={formData.type}
            label="Channel Type"
            onChange={(e) =>
              setFormData({ ...formData, type: e.target.value as "TEXT" | "VOICE" })
            }
          >
            <MenuItem value="TEXT">Text Channel</MenuItem>
            <MenuItem value="VOICE">Voice Channel</MenuItem>
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              checked={formData.isPrivate}
              onChange={(e) => setFormData({ ...formData, isPrivate: e.target.checked })}
            />
          }
          label="Private Channel"
        />
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          Private channels require explicit membership management
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={!formData.name.trim() || creatingChannel}
        >
          {creatingChannel ? <CircularProgress size={20} /> : "Create Channel"}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
};

export default CreateChannelDialog;
