import React from "react";
import { Box, Card, Typography, IconButton, CircularProgress, Alert } from "@mui/material";
import { styled } from "@mui/material/styles";
import DownloadIcon from "@mui/icons-material/Download";
import { useAuthenticatedFile } from "../../hooks/useAuthenticatedFile";
import { FileMetadata } from "../../types/message.type";
import { formatFileSize, downloadBlob } from "../../utils/format";
import { getFileIcon } from "./fileTypeIcon";

const DownloadCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(2),
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(2),
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.spacing(1),
  maxWidth: "100%",
  cursor: "pointer",
  transition: "background-color 0.2s",
  "&:hover": {
    backgroundColor: theme.palette.action.hover,
  },
}));

const FileIcon = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 48,
  height: 48,
  borderRadius: theme.spacing(0.5),
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
}));

const FileInfo = styled(Box)({
  flex: 1,
  minWidth: 0, // Allow text overflow
});

interface DownloadLinkProps {
  metadata: FileMetadata;
}

export const DownloadLink: React.FC<DownloadLinkProps> = ({ metadata }) => {
  const { blobUrl, isLoading, error } = useAuthenticatedFile(metadata.id, {
    fetchBlob: true,
    fetchMetadata: false, // We already have metadata!
  });

  const handleDownload = () => {
    if (blobUrl) downloadBlob(blobUrl, metadata.filename);
  };

  if (error) {
    return (
      <DownloadCard>
        <Alert severity="error" sx={{ width: "100%" }}>
          Failed to load file
        </Alert>
      </DownloadCard>
    );
  }

  if (isLoading) {
    return (
      <DownloadCard>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">
          Loading file...
        </Typography>
      </DownloadCard>
    );
  }

  return (
    <DownloadCard onClick={handleDownload}>
      <FileIcon>{getFileIcon(metadata.mimeType)}</FileIcon>
      <FileInfo>
        <Typography
          variant="body1"
          sx={{
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {metadata.filename}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatFileSize(metadata.size)}
        </Typography>
      </FileInfo>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          handleDownload();
        }}
        disabled={!blobUrl}
        color="primary"
        aria-label="download file"
      >
        <DownloadIcon />
      </IconButton>
    </DownloadCard>
  );
};
