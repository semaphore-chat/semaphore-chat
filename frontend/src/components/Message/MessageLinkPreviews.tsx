import React from "react";
import { Box } from "@mui/material";
import { LinkPreviewCard } from "./LinkPreviewCard";
import type { LinkPreview } from "../../types/message.type";
import { useLoadRemoteContent } from "../../hooks/useLoadRemoteContent";

interface MessageLinkPreviewsProps {
  linkPreviews?: LinkPreview[];
}

export const MessageLinkPreviews: React.FC<MessageLinkPreviewsProps> =
  React.memo(({ linkPreviews }) => {
    // Off: the cards keep their words and leave out the pictures from other sites.
    const showPictures = useLoadRemoteContent();
    if (!linkPreviews || linkPreviews.length === 0) return null;

    return (
      <Box sx={{ mt: 0.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
        {linkPreviews.map((preview) => (
          <LinkPreviewCard key={preview.url} preview={preview} showPictures={showPictures} />
        ))}
      </Box>
    );
  });

MessageLinkPreviews.displayName = "MessageLinkPreviews";
