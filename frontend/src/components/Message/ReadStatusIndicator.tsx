import React from "react";
import { Box, Tooltip } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";

interface ReadStatusIndicatorProps {
  /** Only shown in DMs for own messages */
  showForDm?: boolean;
  /** Disable the built-in tooltip (when wrapped by an outer tooltip) */
  disableTooltip?: boolean;
}

/**
 * Read status indicator for DM messages.
 * Always renders a blue eye icon (only rendered when message is read).
 */
export const ReadStatusIndicator: React.FC<ReadStatusIndicatorProps> = ({
  showForDm = true,
  disableTooltip = false,
}) => {
  if (!showForDm) return null;

  const content = (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        color: "primary.main",
        ml: 0.5,
      }}
    >
      <VisibilityIcon sx={{ fontSize: 14, color: "primary.main" }} />
    </Box>
  );

  if (disableTooltip) {
    return content;
  }

  return (
    <Tooltip title="Seen" placement="top" arrow>
      {content}
    </Tooltip>
  );
};

export default ReadStatusIndicator;
