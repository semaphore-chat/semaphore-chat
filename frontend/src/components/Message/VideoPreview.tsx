import React, { useState, useEffect, useRef } from "react";
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
import { useVideoUrl } from "../../hooks/useVideoUrl";
import type { FileMetadata } from "../../types/message.type";
import { formatFileSize } from "../../utils/format";

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
  fontSize: theme.typography.scale.sm,
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

interface VideoPreviewProps {
  metadata: FileMetadata;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ metadata }) => {
  const [state, setState] = useState<"thumbnail" | "playing">("thumbnail");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const fileCache = useFileCache();
  const { url: videoUrl } = useVideoUrl(state === "playing" ? metadata.id : null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasLoadedRef = useRef(false);

  // Manage the video src imperatively so that signed-URL refreshes (Electron)
  // don't trigger a React-driven src swap + autoPlay, which would audibly
  // replay the clip while the app is backgrounded.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      video.src = videoUrl;
      video.play().catch(() => {}); // user just clicked Play — gesture-backed
      return;
    }

    // Signed-URL refresh: swap src without audible restarts
    const wasPlaying = !video.paused && !video.ended;
    const resumeTime = video.currentTime;
    video.src = videoUrl;
    const onLoaded = () => {
      if (resumeTime > 0) video.currentTime = resumeTime;
      if (wasPlaying && document.visibilityState === "visible") {
        video.play().catch(() => {});
      }
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [videoUrl]);

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
        {videoUrl ? (
          <StyledVideo ref={videoRef} controls crossOrigin="use-credentials" />
        ) : (
          <GenericPlaceholder>
            <CircularProgress size={32} />
          </GenericPlaceholder>
        )}
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
            <VideocamIcon sx={{ fontSize: 'icon.5xl', opacity: 0.5 }} />
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
            <PlayArrowIcon sx={{ fontSize: 'icon.5xl' }} />
          </IconButton>
        </PlayOverlay>

        <SizeBadge>{formatFileSize(metadata.size)}</SizeBadge>
      </ThumbnailContainer>
    </VideoCard>
  );
};
