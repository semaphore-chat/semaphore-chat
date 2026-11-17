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
import type { PinnedMessageDto as PinnedMessage } from "../../api-client/types.gen";
import { pinnedText, usePinnedList } from "../../data/chat/usePinnedList";
import UserAvatar from "../Common/UserAvatar";
import { AttachmentPreview } from "../Message/AttachmentPreview";
import { formatDistanceToNow } from "date-fns";
import { useResponsive } from "../../hooks/useResponsive";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

/** Safe-area padding: the panel fills a full-height drawer on phones. */
const safeAreaSx = {
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
} as const;

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
  const { shouldUseTouchUI } = useResponsive();
  const touchTargetSx = shouldUseTouchUI
    ? { minWidth: TOUCH_TARGETS.MINIMUM, minHeight: TOUCH_TARGETS.MINIMUM }
    : undefined;
  // The list, Unpin and who may unpin: the shared pinned-list model (data/chat/usePinnedList).
  const { pins: pinnedMessages, isLoading, error, canUnpin, unpin } = usePinnedList(channelId, communityId);

  const handleUnpin = async (messageId: string) => {
    await unpin(messageId);
  };

  const handleMessageClick = (messageId: string) => {
    onMessageClick?.(messageId);
  };

  if (isLoading) {
    return (
      <Box sx={safeAreaSx}>
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
      </Box>
    );
  }

  // The pin's words on one line (shared with the new shell's list).
  const getMessageContent = (message: PinnedMessage): string => pinnedText(message);

  if (error) {
    return (
      <Box sx={safeAreaSx}>
        <Box sx={{ p: 2 }}>
          <Alert severity="error">Failed to load pinned messages</Alert>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      data-testid="pinned-messages-panel"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        ...safeAreaSx,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: shouldUseTouchUI ? 0.5 : 2,
          minHeight: shouldUseTouchUI ? 56 : undefined,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <PushPinIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">Pinned Messages</Typography>
        </Box>
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close pinned messages"
            sx={shouldUseTouchUI ? { ...touchTargetSx, mr: -1 } : undefined}
          >
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
            <PushPinIcon sx={{ fontSize: 'icon.5xl', color: "text.disabled", mb: 2 }} />
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
                          aria-label="Unpin message"
                          sx={touchTargetSx}
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
                    secondaryTypographyProps={{ component: "div" }}
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
                      (() => {
                        const content = getMessageContent(message);
                        return (
                          <Box>
                            {content && (
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
                                {content}
                              </Typography>
                            )}
                            {message.attachments.length > 0 && (
                              <>
                                <Box
                                  sx={{
                                    mt: content ? 1 : 0,
                                    maxHeight: 150,
                                    overflow: "hidden",
                                    pointerEvents: "none",
                                    "& img": { maxHeight: 140 },
                                    "& video": { maxHeight: 140 },
                                  }}
                                >
                                  <AttachmentPreview
                                    metadata={message.attachments[0]}
                                  />
                                </Box>
                                {message.attachments.length > 1 && (
                                  <Typography variant="caption" color="text.secondary">
                                    +{message.attachments.length - 1} more
                                  </Typography>
                                )}
                              </>
                            )}
                          </Box>
                        );
                      })()
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
