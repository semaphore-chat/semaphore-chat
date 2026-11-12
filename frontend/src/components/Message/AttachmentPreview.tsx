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

/** VideoPreview has always capped its display at 400px tall; images match it. */
const PREVIEW_MAX_HEIGHT = 400;

/**
 * The box an image occupies, from the dimensions the server recorded. It is
 * capped at the original's own width (never enlarged), at the container
 * width, and at the height that would make it 400px tall, so the space is
 * reserved before the thumbnail arrives and the layout does not jump.
 * Null when the dimensions are unknown (older files), which keeps the
 * intrinsic-size behaviour.
 */
function previewBoxSx(
  width?: number | null,
  height?: number | null,
): { width: string; height: string; aspectRatio: string } | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const widthAtMaxHeight = Math.max(
    1,
    Math.round((PREVIEW_MAX_HEIGHT * width) / height),
  );
  return {
    width: `min(100%, ${width}px, ${widthAtMaxHeight}px)`,
    // The img also carries HTML width/height (so the browser knows the ratio
    // before CSS loads); without `auto` that height attribute would fix the
    // height in pixels and letterbox a wide image inside a tall box.
    height: 'auto',
    aspectRatio: `${width} / ${height}`,
  };
}

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

/** Internal image preview that fetches a thumbnail, or the original if none exists */
const ImagePreview: React.FC<AttachmentPreviewProps> = ({
  metadata,
  alt = "Attachment",
  onClick,
  onImageClick,
}) => {
  const { blobUrl, isLoading, error } = useAuthenticatedFile(metadata.id, {
    fetchBlob: !metadata.hasThumbnail,
    fetchThumbnail: !!metadata.hasThumbnail,
    fetchMetadata: false,
  });
  const boxSx = previewBoxSx(metadata.width, metadata.height);

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
        <LoadingContainer sx={boxSx ? { ...boxSx, minHeight: 0 } : undefined}>
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
        width={metadata.width ?? undefined}
        height={metadata.height ?? undefined}
        sx={boxSx}
        onClick={onImageClick || onClick}
      />
    </AttachmentCard>
  );
};
