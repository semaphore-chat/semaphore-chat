import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  IconButton,
  Typography,
  CircularProgress,
  styled,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import VideocamIcon from "@mui/icons-material/Videocam";
import { useFileCache } from "../../contexts/AvatarCacheContext";
import { getStreamUrl } from "../../utils/fileStream";
import type { FileMetadata } from "../../types/message.type";

const VideoCard = styled(Card)(({ theme }) => ({
  position: "relative",
  overflow: "hidden",
  borderRadius: theme.spacing(1),
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  display: "inline-block",
}));

const ThumbnailContainer = styled(Box)({
  position: "relative",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 200,
  "&:hover .play-overlay": {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  "&:hover .play-button": {
    transform: "scale(1.1)",
  },
});

const ThumbnailImage = styled("img")({
  width: "100%",
  maxHeight: 400,
  objectFit: "contain",
  display: "block",
});

const PlayOverlay = styled(Box)({
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  transition: "background-color 0.2s",
});

const SizeBadge = styled(Typography)(({ theme }) => ({
  position: "absolute",
  bottom: theme.spacing(1),
  right: theme.spacing(1),
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  color: "#fff",
  padding: "2px 8px",
  borderRadius: theme.spacing(0.5),
  fontSize: "0.75rem",
}));

const GenericPlaceholder = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 200,
  backgroundColor: theme.palette.action.hover,
  gap: theme.spacing(1),
}));

const StyledVideo = styled("video")({
  width: "100%",
  maxHeight: 400,
  objectFit: "contain",
  display: "block",
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface VideoPreviewProps {
  metadata: FileMetadata;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ metadata }) => {
  const [state, setState] = useState<"thumbnail" | "playing">("thumbnail");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const fileCache = useFileCache();

  // Fetch thumbnail on mount if available
  useEffect(() => {
    if (!metadata.hasThumbnail) return;

    let cancelled = false;
    setThumbnailLoading(true);

    fileCache
      .fetchThumbnail(metadata.id)
      .then((url) => {
        if (!cancelled) {
          setThumbnailUrl(url);
          setThumbnailLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThumbnailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [metadata.id, metadata.hasThumbnail, fileCache]);

  const handlePlay = () => {
    setState("playing");
  };

  if (state === "playing") {
    return (
      <VideoCard>
        <StyledVideo src={getStreamUrl(metadata.id)} controls autoPlay />
      </VideoCard>
    );
  }

  // Thumbnail state
  return (
    <VideoCard>
      <ThumbnailContainer onClick={handlePlay}>
        {thumbnailLoading ? (
          <GenericPlaceholder>
            <CircularProgress size={32} />
          </GenericPlaceholder>
        ) : thumbnailUrl ? (
          <ThumbnailImage src={thumbnailUrl} alt={metadata.filename} />
        ) : (
          <GenericPlaceholder>
            <VideocamIcon sx={{ fontSize: 48, opacity: 0.5 }} />
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {metadata.filename}
            </Typography>
          </GenericPlaceholder>
        )}

        <PlayOverlay className="play-overlay">
          <IconButton
            className="play-button"
            aria-label="Play video"
            sx={{
              color: "#fff",
              backgroundColor: "rgba(255, 255, 255, 0.15)",
              transition: "transform 0.2s",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.25)",
              },
            }}
            size="large"
          >
            <PlayArrowIcon sx={{ fontSize: 48 }} />
          </IconButton>
        </PlayOverlay>

        <SizeBadge>{formatFileSize(metadata.size)}</SizeBadge>
      </ThumbnailContainer>
    </VideoCard>
  );
};
