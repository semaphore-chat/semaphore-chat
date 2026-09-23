import React, { useState, useCallback, useEffect } from "react";
import {
  IconButton,
  Tooltip,
  Popover,
  Box,
  Typography,
  CircularProgress,
  Button,
} from "@mui/material";
import { LibraryMusic as LibraryMusicIcon } from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import { soundboardControllerListCommunitySoundsOptions } from "../../api-client/@tanstack/react-query.gen";
import { useRoom } from "../../hooks/useRoom";
import { soundboardPlayer } from "../../features/voice/soundboardPlayer";
import { logger } from "../../utils/logger";

interface SoundboardButtonProps {
  communityId: string;
  /** Publishes the given sound to everyone in the voice channel. */
  onPlay: (fileId: string) => Promise<void> | void;
  isMobile?: boolean;
}

/**
 * Bottom-bar soundboard control: a popover grid of the community's sounds.
 * Clicking a sound triggers playback (published to the whole voice channel).
 */
export const SoundboardButton: React.FC<SoundboardButtonProps> = ({
  communityId,
  onPlay,
  isMobile = false,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const { room } = useRoom();

  // Eager-publish the (silent) soundboard track as soon as the button mounts
  // (i.e. connected to community voice) so remote clients have already
  // subscribed before the first clip plays — a lazy publish on first play
  // races remote subscription (~100-500ms) and clips the sound. Disposal
  // stays with the leave actions (leaveVoiceChannel/leaveDmVoice), not here.
  useEffect(() => {
    if (!room) return;
    void soundboardPlayer.warmup(room);
  }, [room]);

  const { data: sounds, isLoading } = useQuery({
    ...soundboardControllerListCommunitySoundsOptions({
      path: { communityId },
    }),
    enabled: open, // only fetch when the popover is opened
  });

  const handlePlay = useCallback(
    async (fileId: string) => {
      try {
        await onPlay(fileId);
      } catch (err) {
        logger.error("[SoundboardButton] Failed to play sound", err);
      }
    },
    [onPlay]
  );

  return (
    <>
      <Tooltip title="Soundboard" arrow={!isMobile}>
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          size="medium"
          aria-label="Open soundboard"
          sx={{
            minWidth: isMobile ? 48 : "auto",
            minHeight: isMobile ? 48 : "auto",
            "&:hover": { backgroundColor: "action.hover" },
          }}
        >
          <LibraryMusicIcon />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Box sx={{ p: 2, maxWidth: 320 }}>
          <Typography variant="subtitle2" gutterBottom>
            Soundboard
          </Typography>

          {isLoading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={24} />
            </Box>
          ) : sounds && sounds.length > 0 ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 1,
              }}
            >
              {sounds.map((sound) => (
                <Button
                  key={sound.id}
                  variant="outlined"
                  size="small"
                  onClick={() => handlePlay(sound.fileId)}
                  sx={{
                    flexDirection: "column",
                    textTransform: "none",
                    minWidth: 0,
                    px: 1,
                  }}
                >
                  <Box component="span" aria-hidden sx={{ fontSize: "icon.xl" }}>
                    {sound.emoji || "🔊"}
                  </Box>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ maxWidth: 80 }}
                    title={sound.name}
                  >
                    {sound.name}
                  </Typography>
                </Button>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No sounds yet. An admin can add some in community settings.
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default SoundboardButton;
