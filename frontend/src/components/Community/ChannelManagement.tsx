import React, { useState, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  IconButton,
  Chip,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  KeyboardArrowUp as ArrowUpIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from "@mui/icons-material";
import { ChannelType } from "../../types/channel.type";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  channelsControllerFindAllForCommunityOptions,
  channelsControllerRemoveMutation,
  channelsControllerMoveUpMutation,
  channelsControllerMoveDownMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import type { Channel } from "../../types/channel.type";
import { logger } from "../../utils/logger";
import { invalidateChannelQueries } from "../../utils/queryInvalidation";
import ConfirmDialog from "../Common/ConfirmDialog";
import CreateChannelDialog from "./CreateChannelDialog";
import EditChannelDialog from "./EditChannelDialog";

interface ChannelManagementProps {
  communityId: string;
}

const ChannelManagement: React.FC<ChannelManagementProps> = ({ communityId }) => {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<{id: string, name: string} | null>(null);

  const queryClient = useQueryClient();

  const {
    data: channels,
    isLoading: loadingChannels,
    error: channelsError,
  } = useQuery(channelsControllerFindAllForCommunityOptions({ path: { communityId } }));

  const { mutateAsync: deleteChannel, isPending: deletingChannel } = useMutation({
    ...channelsControllerRemoveMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });
  const { mutateAsync: moveUp, isPending: movingUp } = useMutation({
    ...channelsControllerMoveUpMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });
  const { mutateAsync: moveDown, isPending: movingDown } = useMutation({
    ...channelsControllerMoveDownMutation(),
    onSuccess: () => invalidateChannelQueries(queryClient),
  });

  // Sort channels by type (TEXT first) then by position
  const sortedChannels = React.useMemo(() => {
    if (!channels) return [];
    return [...channels].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === ChannelType.TEXT ? -1 : 1;
      }
      return (a.position ?? 0) - (b.position ?? 0);
    });
  }, [channels]);

  // Get channels by type for determining first/last
  const textChannels = sortedChannels.filter((c) => c.type === ChannelType.TEXT);
  const voiceChannels = sortedChannels.filter((c) => c.type === ChannelType.VOICE);

  const { hasPermissions: canCreateChannels } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["CREATE_CHANNEL"],
  });

  const { hasPermissions: canUpdateChannels } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["UPDATE_CHANNEL"],
  });

  const { hasPermissions: canDeleteChannels } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["DELETE_CHANNEL"],
  });

  const canManageChannels = canCreateChannels || canUpdateChannels || canDeleteChannels;

  const handleEditChannel = useCallback((channel: Channel) => {
    setEditingChannel(channel);
    setEditDialogOpen(true);
  }, []);

  const handleDeleteChannel = useCallback((channelId: string, channelName: string) => {
    setChannelToDelete({ id: channelId, name: channelName });
    setConfirmDeleteOpen(true);
  }, []);

  const confirmDeleteChannel = useCallback(async () => {
    if (!channelToDelete) return;

    try {
      await deleteChannel({ path: { id: channelToDelete.id } });
    } catch (error) {
      logger.error("Failed to delete channel:", error);
    } finally {
      setConfirmDeleteOpen(false);
      setChannelToDelete(null);
    }
  }, [channelToDelete, deleteChannel]);

  const cancelDeleteChannel = useCallback(() => {
    setConfirmDeleteOpen(false);
    setChannelToDelete(null);
  }, []);

  const handleMoveUp = useCallback(
    async (channelId: string) => {
      try {
        await moveUp({ path: { id: channelId }, body: { communityId } });
      } catch (error) {
        logger.error("Failed to move channel up:", error);
      }
    },
    [moveUp, communityId]
  );

  const handleMoveDown = useCallback(
    async (channelId: string) => {
      try {
        await moveDown({ path: { id: channelId }, body: { communityId } });
      } catch (error) {
        logger.error("Failed to move channel down:", error);
      }
    },
    [moveDown, communityId]
  );

  if (loadingChannels) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (channelsError) {
    return (
      <Alert severity="error">
        Failed to load channels. Please try again.
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">Channels</Typography>
          {canManageChannels && canCreateChannels && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Create Channel
            </Button>
          )}
        </Box>

        {/* Text Channels */}
        {textChannels.length > 0 && (
          <Box mb={2}>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              Text Channels
            </Typography>
            <Box display="flex" flexDirection="column" gap={1}>
              {textChannels.map((channel, index) => {
                const isFirst = index === 0;
                const isLast = index === textChannels.length - 1;
                return (
                  <Box
                    key={channel.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={1}
                    border={1}
                    borderColor="divider"
                    borderRadius={1}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" fontWeight="medium">
                        {channel.name}
                      </Typography>
                      {channel.isPrivate && (
                        <Chip label="Private" size="small" color="warning" />
                      )}
                    </Box>

                    {canManageChannels && (
                      <Box display="flex" gap={0.5}>
                        {canUpdateChannels && (
                          <>
                            <IconButton
                              size="small"
                              onClick={() => handleMoveUp(channel.id)}
                              disabled={isFirst || movingUp || movingDown}
                              title="Move up"
                            >
                              <ArrowUpIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleMoveDown(channel.id)}
                              disabled={isLast || movingUp || movingDown}
                              title="Move down"
                            >
                              <ArrowDownIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleEditChannel(channel)}
                              title="Edit channel"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </>
                        )}
                        {canDeleteChannels && channel.name !== "general" && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteChannel(channel.id, channel.name)}
                            disabled={deletingChannel}
                            title="Delete channel"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Voice Channels */}
        {voiceChannels.length > 0 && (
          <Box>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              Voice Channels
            </Typography>
            <Box display="flex" flexDirection="column" gap={1}>
              {voiceChannels.map((channel, index) => {
                const isFirst = index === 0;
                const isLast = index === voiceChannels.length - 1;
                return (
                  <Box
                    key={channel.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={1}
                    border={1}
                    borderColor="divider"
                    borderRadius={1}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" fontWeight="medium">
                        {channel.name}
                      </Typography>
                      {channel.isPrivate && (
                        <Chip label="Private" size="small" color="warning" />
                      )}
                    </Box>

                    {canManageChannels && (
                      <Box display="flex" gap={0.5}>
                        {canUpdateChannels && (
                          <>
                            <IconButton
                              size="small"
                              onClick={() => handleMoveUp(channel.id)}
                              disabled={isFirst || movingUp || movingDown}
                              title="Move up"
                            >
                              <ArrowUpIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleMoveDown(channel.id)}
                              disabled={isLast || movingUp || movingDown}
                              title="Move down"
                            >
                              <ArrowDownIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleEditChannel(channel)}
                              title="Edit channel"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </>
                        )}
                        {canDeleteChannels && channel.name !== "general" && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteChannel(channel.id, channel.name)}
                            disabled={deletingChannel}
                            title="Delete channel"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <CreateChannelDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          communityId={communityId}
        />

        <EditChannelDialog
          open={editDialogOpen}
          onClose={() => {
            setEditDialogOpen(false);
            setEditingChannel(null);
          }}
          channel={editingChannel}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete Channel"
          description={<>Are you sure you want to delete the channel <strong>"{channelToDelete?.name}"</strong>? This action cannot be undone and all messages in this channel will be permanently lost.</>}
          confirmLabel="Delete Channel"
          confirmColor="error"
          isLoading={deletingChannel}
          onConfirm={confirmDeleteChannel}
          onCancel={cancelDeleteChannel}
        />
      </CardContent>
    </Card>
  );
};

export default ChannelManagement;
