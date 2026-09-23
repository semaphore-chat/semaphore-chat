/**
 * ThreadReplyBadge Component
 *
 * Shows "X replies" badge under messages that have thread replies.
 * Clicking opens the thread panel.
 */

import React from "react";
import { Typography, ButtonBase } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { formatDistanceToNow } from "date-fns";

interface ThreadReplyBadgeProps {
  replyCount: number;
  lastReplyAt?: string | null;
  onClick: () => void;
}

export const ThreadReplyBadge: React.FC<ThreadReplyBadgeProps> = ({
  replyCount,
  lastReplyAt,
  onClick,
}) => {
  const theme = useTheme();

  if (replyCount <= 0) return null;

  const replyText = replyCount === 1 ? "1 reply" : `${replyCount} replies`;
  const timeAgo = lastReplyAt
    ? formatDistanceToNow(new Date(lastReplyAt), { addSuffix: true })
    : null;

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        color: "primary.main",
        "&:hover": {
          backgroundColor: alpha(theme.palette.primary.main, 0.08),
        },
      }}
    >
      <ChatBubbleOutlineIcon sx={{ fontSize: 'icon.md' }} />
      <Typography
        variant="caption"
        sx={{
          fontWeight: 500,
          color: "primary.main",
        }}
      >
        {replyText}
      </Typography>
      {timeAgo && (
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            ml: 0.5,
          }}
        >
          Last reply {timeAgo}
        </Typography>
      )}
    </ButtonBase>
  );
};

export default ThreadReplyBadge;
