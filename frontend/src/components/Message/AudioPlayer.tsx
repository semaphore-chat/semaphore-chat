import { stripBidi } from "../../utils/bidi";
import React from "react";
import { Box, Card, Typography, IconButton, CircularProgress, Alert } from "@mui/material";
import { styled } from "@mui/material/styles";
import DownloadIcon from "@mui/icons-material/Download";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import { useAuthenticatedFile } from "../../hooks/useAuthenticatedFile";
import { FileMetadata } from "../../types/message.type";
import { formatFileSize, downloadBlob } from "../../utils/format";

const AudioCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(2),
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.spacing(1),
  maxWidth: "100%",
}));

const AudioHeader = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(1.5),
  marginBottom: theme.spacing(1.5),
}));

const AudioIconContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: theme.spacing(0.5),
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
}));

const AudioInfo = styled(Box)({
  flex: 1,
  minWidth: 0,
});

const StyledAudio = styled("audio")(({ theme }) => ({
  width: "100%",
  height: 40,
  outline: "none",
  "&::-webkit-media-controls-panel": {
    backgroundColor: theme.palette.background.default,
  },
}));

interface AudioPlayerProps {
  metadata: FileMetadata;
}



export const AudioPlayer: React.FC<AudioPlayerProps> = ({ metadata }) => {
  const { blobUrl, isLoading, error } = useAuthenticatedFile(metadata.id, {
    fetchBlob: true,
    fetchMetadata: false, // We already have metadata!
  });

  const handleDownload = () => {
    if (blobUrl) downloadBlob(blobUrl, metadata.filename);
  };

  if (error) {
    return (
      <AudioCard>
        <Alert severity="error">Failed to load audio file</Alert>
      </AudioCard>
    );
  }

  if (isLoading || !blobUrl) {
    return (
      <AudioCard>
        <Box display="flex" alignItems="center" gap={2}>
          <CircularProgress size={24} />
          <Typography variant="body2" color="text.secondary">
            Loading audio...
          </Typography>
        </Box>
      </AudioCard>
    );
  }

  return (
    <AudioCard>
      <AudioHeader>
        <AudioIconContainer>
          <AudioFileIcon />
        </AudioIconContainer>
        <AudioInfo>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {stripBidi(metadata.filename)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatFileSize(metadata.size)}
          </Typography>
        </AudioInfo>
        <IconButton
          onClick={handleDownload}
          size="small"
          color="primary"
          aria-label="download audio"
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </AudioHeader>
      <StyledAudio controls src={blobUrl}>
        Your browser does not support the audio element.
      </StyledAudio>
    </AudioCard>
  );
};
