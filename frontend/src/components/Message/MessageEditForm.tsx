/**
 * MessageEditForm Component
 *
 * Inline editing form for messages.
 * Allows editing message text and removing attachments.
 */

import React from "react";
import { Box, TextField, IconButton, Chip } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CancelIcon from "@mui/icons-material/Cancel";
import CloseIcon from "@mui/icons-material/Close";
import type { FileMetadata } from "../../types/message.type";

export interface MessageEditFormProps {
  editText: string;
  editAttachments: FileMetadata[];
  onTextChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

export const MessageEditForm: React.FC<MessageEditFormProps> = ({
  editText,
  editAttachments,
  onTextChange,
  onSave,
  onCancel,
  onRemoveAttachment,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <Box sx={{ mt: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <TextField
          size="small"
          value={editText}
          onChange={(e) => onTextChange(e.target.value)}
          fullWidth
          // eslint-disable-next-line jsx-a11y/no-autofocus -- inline editor the user just opened with Edit; typing must go straight into it
          autoFocus
          multiline
          maxRows={4}
          onKeyDown={handleKeyDown}
        />
        <IconButton
          size="small"
          onClick={onSave}
          disabled={!editText.trim() && editAttachments.length === 0}
          color="primary"
        >
          <CheckIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onCancel}>
          <CancelIcon fontSize="small" />
        </IconButton>
      </Box>
      {editAttachments.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
          {editAttachments.map((attachment) => (
            <Chip
              key={attachment.id}
              label={attachment.filename}
              size="small"
              onDelete={() => onRemoveAttachment(attachment.id)}
              deleteIcon={<CloseIcon />}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};
