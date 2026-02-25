import React from "react";
import { Box, Card, CircularProgress, Alert, styled } from "@mui/material";
import { useAuthenticatedFile } from "../../hooks/useAuthenticatedFile";
import { AudioPlayer } from "./AudioPlayer";
import { DownloadLink } from "./DownloadLink";
import { VideoPreview } from "./VideoPreview";

const AttachmentCard = styled(Card)(({ theme }) => ({
  position: "relative",
  overflow: "hidden",
  borderRadius: theme.spacing(1),
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  display: "inline-block",
}));

const LoadingContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 200,
  backgroundColor: theme.palette.action.hover,
}));

const StyledImage = styled("img")({
  maxWidth: "100%",
  maxHeight: 400,
  objectFit: "contain",
  display: "block",
  cursor: "pointer",
  transition: "opacity 0.2s",
  "&:hover": {
    opacity: 0.9,
  },
});

interface AttachmentPreviewProps {
  metadata: import("../../types/message.type").FileMetadata;
  alt?: string;
  onClick?: () => void;
  onImageClick?: () => void;
}

function getMediaType(mimeType?: string): "image" | "video" | "audio" | "other" {
  if (!mimeType) return "other";
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  return "other";
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  metadata,
  alt = "Attachment",
  onClick,
  onImageClick,
}) => {
  const mediaType = getMediaType(metadata?.mimeType);

  // Videos get their own component — no blob download needed
  if (mediaType === "video") {
    return <VideoPreview metadata={metadata} />;
  }

  // Audio files get their own specialized player
  if (mediaType === "audio") {
    return <AudioPlayer metadata={metadata} />;
  }

  // Other file types get a download link
  if (mediaType === "other") {
    return <DownloadLink metadata={metadata} />;
  }

  // Images need the blob fetched
  return (
    <ImagePreview
      metadata={metadata}
      alt={alt}
      onClick={onClick}
      onImageClick={onImageClick}
    />
  );
};

/** Internal image preview that fetches the blob */
const ImagePreview: React.FC<AttachmentPreviewProps> = ({
  metadata,
  alt = "Attachment",
  onClick,
  onImageClick,
}) => {
  const { blobUrl, isLoading, error } = useAuthenticatedFile(metadata.id, {
    fetchBlob: true,
    fetchMetadata: false,
  });

  if (error) {
    return (
      <AttachmentCard>
        <Alert severity="error" sx={{ m: 1 }}>
          Failed to load attachment
        </Alert>
      </AttachmentCard>
    );
  }

  if (isLoading || !blobUrl) {
    return (
      <AttachmentCard>
        <LoadingContainer>
          <CircularProgress size={32} />
        </LoadingContainer>
      </AttachmentCard>
    );
  }

  return (
    <AttachmentCard>
      <StyledImage
        src={blobUrl}
        alt={alt}
        onClick={onImageClick || onClick}
      />
    </AttachmentCard>
  );
};
