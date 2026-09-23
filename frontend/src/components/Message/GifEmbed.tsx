import React from "react";
import { Box } from "@mui/material";

interface GifEmbedProps {
  /** The GIF's direct media URL — rendered as-is, natural aspect ratio. */
  url: string;
  /** Called when the image fails to load, so the caller can fall back to
   * the original link-text + link-preview rendering (nothing blank). */
  onError: () => void;
}

/**
 * Discord-style inline GIF embed: the animated GIF itself, no visible URL
 * text and no generic link-preview card alongside it. Clicking opens the
 * GIF's URL in a new tab, same affordance as the link-preview card it
 * replaces.
 */
export const GifEmbed: React.FC<GifEmbedProps> = React.memo(({ url, onError }) => {
  const handleClick = () => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Box
      component="img"
      src={url}
      alt="GIF"
      loading="lazy"
      onClick={handleClick}
      onError={onError}
      sx={{
        display: "block",
        mt: 0.5,
        // Never wider than the message column (phones are < 400px).
        maxWidth: "min(400px, 100%)",
        maxHeight: 300,
        width: "auto",
        height: "auto",
        borderRadius: 1,
        cursor: "pointer",
      }}
    />
  );
});

GifEmbed.displayName = "GifEmbed";
