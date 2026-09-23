/**
 * ThreadPanel Component
 *
 * Side panel showing a thread's parent message and replies.
 * Users can read and add replies to the thread.
 *
 * `fullScreen` (phone): rendered as a full-screen layer with an app-bar style
 * header, a back arrow instead of the close X, 44px touch targets and
 * safe-area padding top and bottom.
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  IconButton,
  Skeleton,
  Divider,
  Button,
  Tooltip,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import { useQueryClient } from "@tanstack/react-query";
import {
  threadsControllerGetRepliesOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { Message } from "../../types/message.type";
import MessageComponent from "../Message/MessageComponent";
import ThreadMessageInput from "./ThreadMessageInput";
import { useThreadPanel } from "../../contexts/ThreadPanelContext";
import { useThreadReplies } from "../../hooks/useThreadReplies";
import { useThreadSubscription } from "../../hooks/useThreadSubscription";
import { logger } from "../../utils/logger";
import ListState from "../Common/ListState";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { useResponsive } from "../../hooks/useResponsive";

interface ThreadPanelProps {
  parentMessage: Message;
  channelId?: string;
  directMessageGroupId?: string;
  communityId?: string;
  /** Phone: full-screen layer with a back button instead of a side drawer. */
  fullScreen?: boolean;
}

const touchTarget = {
  minWidth: TOUCH_TARGETS.MINIMUM,
  minHeight: TOUCH_TARGETS.MINIMUM,
} as const;

export const ThreadPanel: React.FC<ThreadPanelProps> = ({
  parentMessage,
  channelId,
  directMessageGroupId,
  communityId,
  fullScreen = false,
}) => {
  const theme = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const parentMessageId = parentMessage.id;
  const { closeThread } = useThreadPanel();
  // Tablet keeps the side drawer, but it is still a touch layout: header
  // buttons need 44px targets there too.
  const { shouldUseTouchUI } = useResponsive();
  const touchHeader = fullScreen || shouldUseTouchUI;

  // Thread replies via TanStack Query
  const { replies, continuationToken, isLoading, error, refetch } = useThreadReplies(parentMessageId);

  // Subscription status via TanStack Query
  const { isSubscribed, toggleSubscription } = useThreadSubscription(parentMessageId);

  // Scroll to bottom when new replies come in
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies.length]);

  const handleClose = () => {
    closeThread();
  };

  const handleLoadMore = useCallback(async () => {
    if (continuationToken && !isLoading) {
      try {
        const nextPage = await queryClient.fetchQuery(
          threadsControllerGetRepliesOptions({
            path: { parentMessageId },
            query: { limit: 50, continuationToken },
          })
        );

        // Merge into the base query cache (continuationToken: '') so useThreadReplies sees the results
        const baseQueryKey = threadsControllerGetRepliesOptions({
          path: { parentMessageId },
          query: { limit: 50, continuationToken: '' },
        }).queryKey;

        queryClient.setQueryData(baseQueryKey, (old: typeof nextPage | undefined) => {
          if (!old) return nextPage;
          return {
            ...old,
            replies: [...old.replies, ...(nextPage.replies ?? [])],
            continuationToken: nextPage.continuationToken,
          };
        });
      } catch (error) {
        logger.error("Failed to load more thread replies:", error);
      }
    }
  }, [continuationToken, isLoading, queryClient, parentMessageId]);

  const contextId = channelId || directMessageGroupId || "";

  const subscriptionLabel = isSubscribed ? "Turn off notifications" : "Get notified about replies";
  const subscriptionButton = (
    <Tooltip title={subscriptionLabel}>
      <IconButton
        size={touchHeader ? "medium" : "small"}
        onClick={toggleSubscription}
        aria-label={subscriptionLabel}
        sx={touchHeader ? touchTarget : undefined}
      >
        {isSubscribed ? (
          <NotificationsIcon fontSize="small" color="primary" />
        ) : (
          <NotificationsOffIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      data-testid="thread-panel"
      data-variant={fullScreen ? "fullscreen" : "drawer"}
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: theme.palette.background.canvas,
        ...(fullScreen
          ? { paddingTop: "env(safe-area-inset-top)" }
          : { borderLeft: `1px solid ${theme.palette.divider}` }),
      }}
    >
      {/* Header */}
      {fullScreen ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 0.5,
            minHeight: 56,
            flexShrink: 0,
            borderBottom: 1,
            borderColor: "divider",
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <IconButton onClick={handleClose} aria-label="Back" sx={touchTarget}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
            Thread
          </Typography>
          {subscriptionButton}
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 2,
            flexShrink: 0,
            borderBottom: 1,
            borderColor: "divider",
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ChatBubbleOutlineIcon sx={{ color: "primary.main" }} />
            <Typography variant="h6">Thread</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {subscriptionButton}
            <IconButton
              size={touchHeader ? "medium" : "small"}
              onClick={handleClose}
              aria-label="Close thread"
              sx={touchHeader ? touchTarget : undefined}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Parent Message */}
      <Box
        sx={{
          p: 2,
          flexShrink: 0,
          backgroundColor: alpha(theme.palette.primary.main, 0.04),
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
          Original message
        </Typography>
        <MessageComponent
          message={parentMessage}
          contextId={contextId}
          communityId={communityId}
          isThreadParent
        />
      </Box>

      {/* Replies */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: 1,
        }}
      >
        {/* Load more button */}
        {continuationToken && (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Button
              size="small"
              onClick={handleLoadMore}
              disabled={isLoading}
            >
              Load more replies
            </Button>
          </Box>
        )}

        <ListState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          isEmpty={replies.length === 0}
          size="compact"
          errorTitle="Couldn't load replies"
          skeleton={
            <Box sx={{ p: 2 }} role="progressbar" aria-label="Loading replies" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <Box key={i} sx={{ mb: 2 }}>
                  <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
                </Box>
              ))}
            </Box>
          }
          empty={
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
              <ChatBubbleOutlineIcon sx={{ fontSize: 'icon.5xl', color: "text.disabled", mb: 2 }} />
              <Typography variant="body2" color="text.secondary" textAlign="center">
                No replies yet
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="center">
                Be the first to reply to this message
              </Typography>
            </Box>
          }
        >
          {replies.map((reply, index) => (
            <React.Fragment key={reply.id}>
              {index > 0 && <Divider sx={{ my: 1 }} />}
              <MessageComponent
                message={reply}
                contextId={contextId}
                communityId={communityId}
                isThreadReply
              />
            </React.Fragment>
          ))}
        </ListState>

        <div ref={messagesEndRef} />
      </Box>

      {/* Message Input */}
      <Box
        sx={{
          flexShrink: 0,
          ...(fullScreen && {
            paddingBottom: "env(safe-area-inset-bottom)",
            backgroundColor: theme.palette.background.paper,
          }),
        }}
      >
        <ThreadMessageInput parentMessageId={parentMessageId} communityId={communityId} />
      </Box>
    </Box>
  );
};

export default ThreadPanel;
