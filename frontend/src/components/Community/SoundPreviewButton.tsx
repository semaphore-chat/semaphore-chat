import React, { useRef, useState, useCallback } from "react";
import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import {
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
} from "@mui/icons-material";
import { useAuthenticatedFile } from "../../hooks/useAuthenticatedFile";

interface SoundPreviewButtonProps {
  fileId: string;
}

/**
 * Plays a soundboard clip locally (management preview only — does NOT publish to
 * a voice channel). Fetches the authenticated blob lazily on first play.
 */
export const SoundPreviewButton: React.FC<SoundPreviewButtonProps> = ({
  fileId,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { blobUrl, isLoading, error } = useAuthenticatedFile(fileId, {
    fetchBlob: true,
  });

  const handleToggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      el.currentTime = 0;
      setIsPlaying(false);
    } else {
      el.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [isPlaying]);

  if (isLoading) {
    return <CircularProgress size={18} />;
  }

  return (
    <>
      <Tooltip title={error ? "Failed to load" : isPlaying ? "Stop" : "Preview"}>
        <span>
          <IconButton
            size="small"
            onClick={handleToggle}
            disabled={!blobUrl || Boolean(error)}
            aria-label={isPlaying ? "Stop preview" : "Play preview"}
          >
            {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
          </IconButton>
        </span>
      </Tooltip>
      {blobUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- hidden player for a short soundboard sound effect; no speech to caption
        <audio
          ref={audioRef}
          src={blobUrl}
          onEnded={() => setIsPlaying(false)}
          hidden
        />
      )}
    </>
  );
};

export default SoundPreviewButton;
