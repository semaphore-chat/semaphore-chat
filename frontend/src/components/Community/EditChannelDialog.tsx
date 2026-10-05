import React, { useState, useCallback, useEffect } from "react";
import {
  Box,
  Button,
  TextField,
  DialogContent,
  DialogActions,
  CircularProgress,
  Tab,
  Tabs,
} from "@mui/material";
import ChannelPermissionsTab from "./ChannelPermissionsTab";
import { useChannelPermissions } from "../../hooks/useChannelPermissions";
import ResponsiveDialog from "../Common/ResponsiveDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { channelsControllerUpdateMutation } from "../../api-client/@tanstack/react-query.gen";
import { ChannelType, type Channel } from "../../types/channel.type";
import { logger } from "../../utils/logger";
import { invalidateChannelQueries } from "../../utils/queryInvalidation";
import WebhookManagement from "./WebhookManagement";

interface EditChannelDialogProps {
  open: boolean;
  onClose: () => void;
  channel: Channel | null;
}

interface EditChannelFormData {
  name: string;
}

const initialFormData: EditChannelFormData = {
  name: "",
};

type EditChannelTab = "general" | "permissions";

const EditChannelDialog: React.FC<EditChannelDialogProps> = ({
  open,
  onClose,
  channel,
}) => {
  const [formData, setFormData] = useState<EditChannelFormData>(initialFormData);
  const [tab, setTab] = useState<EditChannelTab>("general");
  // Privacy and presets are permission changes: only for managers
  const { caps } = useChannelPermissions(channel?.communityId, channel?.id);
  const canManagePermissions = !!caps?.managePermissions;
  const queryClient = useQueryClient();

  const { mutateAsync: updateChannel, isPending: updatingChannel } = useMutation({
    ...channelsControllerUpdateMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });

  useEffect(() => {
    if (channel) {
      setFormData({
        name: channel.name,
      });
    } else {
      setFormData(initialFormData);
    }
  }, [channel]);

  const handleClose = useCallback(() => {
    onClose();
    setFormData(initialFormData);
    setTab("general");
  }, [onClose]);

  const handleUpdate = useCallback(async () => {
    if (!channel || !formData.name.trim()) return;

    try {
      await updateChannel({
        path: { id: channel.id },
        body: {
          name: formData.name.trim(),
        },
      });

      handleClose();
    } catch (error) {
      logger.error("Failed to update channel:", error);
    }
  }, [channel, formData, updateChannel, handleClose]);

  return (
    <ResponsiveDialog open={open} onClose={handleClose} maxWidth="sm" fullWidth title="Edit Channel">
      {canManagePermissions && (
        <Tabs
          value={tab}
          onChange={(_e, value: EditChannelTab) => setTab(value)}
          sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab value="general" label="General" />
          <Tab value="permissions" label="Permissions" />
        </Tabs>
      )}
      {tab === "permissions" && canManagePermissions && channel ? (
        <DialogContent>
          <ChannelPermissionsTab channel={channel} onSaved={handleClose} />
        </DialogContent>
      ) : (
        <>
          <DialogContent>
            <TextField
              // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
              autoFocus
              label="Channel Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              margin="normal"
            />
            {channel && channel.type === ChannelType.TEXT && (
              <Box mt={3}>
                <WebhookManagement channelId={channel.id} />
              </Box>
            )}
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
        </>
      )}
    </ResponsiveDialog>
  );
};

export default EditChannelDialog;
