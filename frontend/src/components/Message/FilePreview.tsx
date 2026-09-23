/**
 * FilePreview Component
 *
 * Displays file attachments with previews for images and chips for other file types.
 * Used by MessageInput components to show selected files before sending.
 *
 * Files sit in one framed, horizontally scrolling tray so any number of them
 * costs a single row of composer height; long names truncate with an ellipsis
 * (full name in the tooltip).
 */

import React from "react";
import { Box, IconButton, Chip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

export interface FilePreviewProps {
  files: File[];
  previews: Map<number, string>;
  onRemoveFile: (index: number) => void;
}

const THUMB_SIZE = 64;

export const FilePreview: React.FC<FilePreviewProps> = ({
  files,
  previews,
  onRemoveFile,
}) => {
  if (files.length === 0) return null;

  return (
    <Box
      role="list"
      aria-label="Attachments"
      data-testid="composer-file-tray"
      style={{ overflowX: "auto", flexWrap: "nowrap" }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        mx: 1,
        mb: 0.5,
        p: 1,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        backgroundColor: "action.hover",
        overflowY: "hidden",
        overscrollBehaviorX: "contain",
        // The nowrap row must scroll, not widen the chat column.
        contain: "inline-size",
        scrollbarWidth: "thin",
      }}
    >
      {files.map((file, index) => {
        const preview = previews.get(index);
        const isImage = file.type.startsWith('image/');

        if (isImage && preview) {
          return (
            <Box
              key={index}
              role="listitem"
              title={file.name}
              sx={{
                position: 'relative',
                flexShrink: 0,
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: 1,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <img
                src={preview}
                alt={file.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
              <IconButton
                onClick={() => onRemoveFile(index)}
                size="small"
                aria-label={`remove ${file.name}`}
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  },
                  width: 22,
                  height: 22,
                }}
              >
                <CloseIcon sx={{ fontSize: 'icon.sm' }} />
              </IconButton>
            </Box>
          );
        }

        return (
          <Box key={index} role="listitem" sx={{ flexShrink: 0, maxWidth: 200, minWidth: 0 }}>
            <Chip
              title={file.name}
              icon={<InsertDriveFileOutlinedIcon />}
              label={file.name}
              onDelete={() => onRemoveFile(index)}
              deleteIcon={<CloseIcon />}
              sx={{
                maxWidth: "100%",
                "& .MuiChip-label": {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
};
