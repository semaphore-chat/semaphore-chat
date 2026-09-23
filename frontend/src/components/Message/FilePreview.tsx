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
import { TOUCH_TARGETS } from "../../utils/breakpoints";

export interface FilePreviewProps {
  files: File[];
  previews: Map<number, string>;
  onRemoveFile: (index: number) => void;
  /** Smaller thumbnails (e.g. while the on-screen keyboard is open). */
  compact?: boolean;
}

const THUMB_SIZE = 64;
const COMPACT_THUMB_SIZE = 48;
/** Visible size of the remove button on touch; its hit area is extended to 44px. */
const TOUCH_REMOVE_SIZE = 28;
const TOUCH_REMOVE_OUTSET = (TOUCH_TARGETS.MINIMUM - TOUCH_REMOVE_SIZE) / 2;

export const FilePreview: React.FC<FilePreviewProps> = ({
  files,
  previews,
  onRemoveFile,
  compact = false,
}) => {
  if (files.length === 0) return null;
  const thumbSize = compact ? COMPACT_THUMB_SIZE : THUMB_SIZE;

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
                width: thumbSize,
                height: thumbSize,
                borderRadius: 1,
                // Not overflow:hidden — the touch remove button's hit area
                // reaches past the thumbnail's corner (the image rounds itself).
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <img
                src={preview}
                alt={file.name}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: 'inherit',
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
                  // Touch: a bigger button in the corner plus an invisible
                  // outset so the tap target is 44px (TOUCH_TARGETS.MINIMUM).
                  '@media (pointer: coarse)': {
                    top: 0,
                    right: 0,
                    width: TOUCH_REMOVE_SIZE,
                    height: TOUCH_REMOVE_SIZE,
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      inset: -TOUCH_REMOVE_OUTSET,
                    },
                  },
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
