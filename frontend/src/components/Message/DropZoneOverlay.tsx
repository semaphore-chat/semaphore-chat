import React from "react";
import { Box, Typography } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useTheme } from "@mui/material/styles";

interface DropZoneOverlayProps {
  visible: boolean;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({ visible }) => {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(25, 118, 210, 0.15)"
            : "rgba(25, 118, 210, 0.08)",
        border: `2px dashed ${theme.palette.primary.main}`,
        borderRadius: "8px",
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      <UploadFileIcon
        sx={{ fontSize: 'icon.4xl', color: theme.palette.primary.main, mb: 1 }}
      />
      <Typography variant="body2" color="primary" fontWeight={600}>
        Drop files to upload
      </Typography>
    </Box>
  );
};
