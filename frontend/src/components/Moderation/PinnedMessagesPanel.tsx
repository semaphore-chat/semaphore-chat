/**
 * PinnedMessagesPanel Component
 *
 * Displays all pinned messages for a channel.
 * Allows users with permission to unpin messages.
 */

import React from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Skeleton,
  Alert,
  Tooltip,
  Divider,
} from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  moderationControllerGetPinnedMessagesOptions,
  moderationControllerUnpinMessageMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { PinnedMessageDto as PinnedMessage } from "../../api-client/types.gen";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import UserAvatar from "../Common/UserAvatar";
import { AttachmentPreview } from "../Message/AttachmentPreview";
import type { FileMetadata } from "../../types/message.type";
import { formatDistanceToNow } from "date-fns";
import { logger } from "../../utils/logger";

interface PinnedMessagesPanelProps {
  channelId: string;
  communityId: string;
  onMessageClick?: (messageId: string) => void;
  onClose?: () => void;
}

const PinnedMessagesPanel: React.FC<PinnedMessagesPanelProps> = ({
  channelId,
  communityId,
  onMessageClick,
  onClose,
}) => {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: pinnedMessages, isLoading, error } = useQuery(moderationControllerGetPinnedMessagesOptions({ path: { channelId } }));
  const { mutateAsync: unpinMessage } = useMutation({
    ...moderationControllerUnpinMessageMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetPinnedMessages' }] }),
  });

  const canUnpin = useCanPerformAction("COMMUNITY", communityId, RBAC_ACTIONS.UNPIN_MESSAGE);

  const handleUnpin = async (messageId: string) => {
    try {
      await unpinMessage({ path: { messageId } });
    } catch (err) {
      logger.error("Failed to unpin message:", err);
    }
  };

  const handleMessageClick = (messageId: string) => {
    onMessageClick?.(messageId);
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <PushPinIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Pinned Messages</Typography>
        </Box>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={{ mb: 2 }}>
            <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
    );
  }

  // Helper to extract text from spans
  const getMessageContent = (message: PinnedMessage): string => {
    return message.spans
      .filter((span) => span.text)
      .map((span) => span.text)
      .join(" ");
  };

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load pinned messages</Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <PushPinIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">Pinned Messages</Typography>
        </Box>
        {onClose && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {!pinnedMessages || pinnedMessages.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
              px: 2,
            }}
          >
            <PushPinIcon sx={{ fontSize: 48, color: "text.disabled", mb: 2 }} />
            <Typography variant="body2" color="text.secondary" textAlign="center">
              No pinned messages yet.
            </Typography>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Pin important messages to keep them easily accessible.
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {pinnedMessages.map((message, index) => (
              <React.Fragment key={message.id}>
                {index > 0 && <Divider />}
                <ListItem
                  sx={{
                    alignItems: "flex-start",
                    cursor: onMessageClick ? "pointer" : "default",
                    "&:hover": {
                      backgroundColor: theme.palette.semantic.overlay.medium,
                    },
                  }}
                  onClick={() => handleMessageClick(message.id)}
                  secondaryAction={
                    canUnpin && (
                      <Tooltip title="Unpin message">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnpin(message.id);
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )
                  }
                >
                  <ListItemText
                    secondaryTypographyProps={{ component: "div" } as object}
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                        {message.author && (
                          <UserAvatar userId={message.author?.id} size="small" />
                        )}
                        <Typography variant="subtitle2">
                          {message.author?.displayName || message.author?.username || "Unknown"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDistanceToNow(new Date(message.sentAt), { addSuffix: true })}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Box component="span" sx={{ display: "block" }}>
                        {getMessageContent(message) && (
                          <Typography
                            variant="body2"
                            color="text.primary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              wordBreak: "break-word",
                            }}
                          >
                            {getMessageContent(message)}
                          </Typography>
                        )}
                        {message.attachments.length > 0 && (
                          <Box
                            sx={{
                              mt: getMessageContent(message) ? 1 : 0,
                              maxHeight: 150,
                              overflow: "hidden",
                              pointerEvents: "none",
                              "& img": { maxHeight: 140 },
                              "& video": { maxHeight: 140 },
                            }}
                          >
                            <AttachmentPreview
                              metadata={message.attachments[0] as FileMetadata}
                            />
                            {message.attachments.length > 1 && (
                              <Typography variant="caption" color="text.secondary">
                                +{message.attachments.length - 1} more
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};

export default PinnedMessagesPanel;
