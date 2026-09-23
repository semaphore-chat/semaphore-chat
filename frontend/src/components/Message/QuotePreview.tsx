/**
 * QuotePreview Component
 *
 * Compact inline preview of a quoted (replied-to) message.
 * Shown above the message body when a message has a replyTo reference.
 * Clicking navigates to the original message.
 */

import React from "react";
import { Box, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../../api-client/@tanstack/react-query.gen";
import { useNavigate, useParams } from "react-router-dom";
import type { Message } from "../../types/message.type";

interface QuotePreviewProps {
  replyTo: NonNullable<Message["replyTo"]>;
  channelId?: string;
  directMessageGroupId?: string;
}

const QuotePreview: React.FC<QuotePreviewProps> = ({
  replyTo,
  channelId,
  directMessageGroupId,
}) => {
  const navigate = useNavigate();
  const { communityId } = useParams<{ communityId: string }>();

  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: replyTo.authorId ?? '' } }),
    enabled: !!replyTo.authorId,
  });

  const isDeleted = !!replyTo.deletedAt;
  const previewText = isDeleted
    ? "[Original message was deleted]"
    : replyTo.spans.find((s) => s.type === "PLAINTEXT")?.text || "Message";

  const handleClick = () => {
    if (isDeleted) return;
    if (channelId && communityId) {
      navigate(`/community/${communityId}/channel/${channelId}?highlight=${replyTo.id}`);
    } else if (directMessageGroupId) {
      navigate(`/direct-messages/${directMessageGroupId}?highlight=${replyTo.id}`);
    }
  };

  return (
    <Box
      onClick={handleClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        pl: 1.5,
        py: 0.25,
        mb: 0.25,
        borderLeft: "2px solid",
        borderColor: "primary.main",
        cursor: isDeleted ? "default" : "pointer",
        borderRadius: "0 4px 4px 0",
        "&:hover": isDeleted
          ? {}
          : { backgroundColor: "action.hover" },
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          color: isDeleted ? "text.disabled" : "primary.main",
          flexShrink: 0,
        }}
      >
        {isDeleted
          ? "[Deleted User]"
          : author?.displayName || author?.username || "Unknown"}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: isDeleted ? "text.disabled" : "text.secondary",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontStyle: isDeleted ? "italic" : "normal",
        }}
      >
        {previewText}
      </Typography>
    </Box>
  );
};

export default React.memo(QuotePreview);
