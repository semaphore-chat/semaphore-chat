/**
 * ReplyComposerBanner Component
 *
 * Banner shown above the message input when replying to / quoting a message.
 * Shows "Replying to @username" plus a one-line snippet of the quoted
 * message, with a cancel button.
 */

import React from "react";
import { Box, Typography, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../../api-client/@tanstack/react-query.gen";
import type { Message } from "../../types/message.type";
import { useResponsive } from "../../hooks/useResponsive";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

interface ReplyComposerBannerProps {
  replyToMessage: Message;
  onCancel: () => void;
}

/** One-line plain-text preview of a message: span text joined, whitespace collapsed. */
// eslint-disable-next-line react-refresh/only-export-components
export function replySnippet(message: Message): string {
  const text = (message.spans ?? [])
    .map((span) => span.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  if (message.attachments && message.attachments.length > 0) return "Attachment";
  return "Message";
}

const ReplyComposerBanner: React.FC<ReplyComposerBannerProps> = ({
  replyToMessage,
  onCancel,
}) => {
  const { shouldUseTouchUI } = useResponsive();
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: replyToMessage.authorId ?? '' } }),
    enabled: !!replyToMessage.authorId,
  });

  const authorName = author?.displayName || author?.username || "Unknown";
  const snippet = replySnippet(replyToMessage);

  return (
    <Box
      data-testid="reply-composer-banner"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        pl: 1.5,
        pr: 0.5,
        py: 0.25,
        borderLeft: "2px solid",
        borderColor: "primary.main",
        backgroundColor: "action.hover",
        borderRadius: 1,
        mx: 1,
        mb: 0.5,
        minWidth: 0,
      }}
    >
      {/* inline-size containment: the nowrap snippet must never widen the
          chat column (its min-content would otherwise propagate up). */}
      <Box sx={{ flex: 1, minWidth: 0, contain: "inline-size" }}>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          Replying to{" "}
          <Typography
            component="span"
            variant="caption"
            sx={{ fontWeight: 600, color: "primary.main" }}
          >
            {authorName}
          </Typography>
        </Typography>
        <Typography
          variant="caption"
          component="div"
          data-testid="reply-banner-snippet"
          title={snippet}
          sx={{
            color: "text.primary",
            opacity: 0.8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {snippet}
        </Typography>
      </Box>
      <IconButton
        size="small"
        onClick={onCancel}
        aria-label="cancel reply"
        sx={
          shouldUseTouchUI
            ? { width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM, flexShrink: 0 }
            : { flexShrink: 0 }
        }
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
};

export default React.memo(ReplyComposerBanner);
