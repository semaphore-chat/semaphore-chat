/**
 * PendingAttachments
 *
 * The files a message is still uploading, under its text: one tile per file
 * with a thumbnail of the local file (images, videos) or a type icon, its
 * name and size, and determinate progress. A failed file offers Retry and
 * Remove; one still uploading can be cancelled. When a file is attached its
 * tile disappears and the real attachment (MessageAttachments, above)
 * renders instead.
 *
 * The state lives in utils/pendingUploadStore.ts and the uploads run in
 * utils/attachmentSend.ts, outside React: they carry on when this row
 * unmounts, and it shows their current state when it mounts again.
 */

import React, { useEffect, useState } from "react";
import { Box, Button, IconButton, LinearProgress, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { usePendingUpload } from "../../hooks/usePendingUpload";
import { useResponsive } from "../../hooks/useResponsive";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { formatFileSize } from "../../utils/format";
import { isOptimisticMessageId } from "../../utils/messageCacheUpdaters";
import { removeAttachment, retryAttachment, startAttachmentUploads } from "../../utils/attachmentSend";
import type { PendingFile } from "../../utils/pendingUploadStore";
import type { Message } from "../../types/message.type";
import { getFileIcon } from "./fileTypeIcon";

const THUMB_SIZE = 48;

function statusText(file: PendingFile, sendFailed: boolean): string {
  switch (file.status) {
    case "waiting":
      return sendFailed ? "Not uploaded: the message wasn't sent" : "Waiting to upload…";
    case "failed":
      return file.error ? `Upload failed: ${file.error}` : "Upload failed";
    case "attaching":
      return "Finishing…";
    default:
      if (file.progress >= 1) return "Finishing…";
      return `${formatFileSize(file.size * file.progress)} of ${formatFileSize(file.size)}`;
  }
}

const Thumbnail: React.FC<{ file: PendingFile }> = ({ file }) => {
  const type = file.mimeType.toLowerCase();
  let content: React.ReactNode;
  if (file.previewUrl && type.startsWith("image/")) {
    content = (
      <Box component="img" src={file.previewUrl} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    );
  } else if (file.previewUrl && type.startsWith("video/")) {
    content = (
      <>
        <Box
          component="video"
          src={file.previewUrl}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <PlayArrowRoundedIcon
          fontSize="medium"
          sx={{ position: "absolute", color: "common.white", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))" }}
        />
      </>
    );
  } else {
    content = getFileIcon(type, "medium");
  }
  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
        color: "text.secondary",
      }}
    >
      {content}
    </Box>
  );
};

interface PendingAttachmentTileProps {
  clientId: string;
  file: PendingFile;
  sendFailed: boolean;
}

const PendingAttachmentTile: React.FC<PendingAttachmentTileProps> = ({ clientId, file, sendFailed }) => {
  const { shouldUseTouchUI } = useResponsive();
  const [busy, setBusy] = useState(false);
  const failed = file.status === "failed";
  const uploading = file.status === "uploading";
  const percent = file.status === "attaching" ? 100 : Math.round(file.progress * 100);
  const text = statusText(file, sendFailed);
  const buttonSx = shouldUseTouchUI ? { minHeight: TOUCH_TARGETS.MINIMUM } : undefined;
  const iconSize = shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : 32;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      role="listitem"
      data-testid="pending-attachment"
      data-status={file.status}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1,
        minWidth: 0,
        border: 1,
        borderColor: failed ? "error.main" : "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Thumbnail file={file} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap title={file.name} sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
            {file.name}
          </Typography>
          {uploading && percent < 100 && (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {percent}%
            </Typography>
          )}
        </Box>
        <Typography
          variant="caption"
          color={failed ? "error.main" : "text.secondary"}
          noWrap={!failed}
          sx={{ display: "block", overflowWrap: "anywhere" }}
        >
          {text}
        </Typography>
        {failed ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}>
            <Button
              size="small"
              disabled={busy}
              startIcon={<ReplayIcon fontSize="small" />}
              onClick={() => void run(() => retryAttachment(clientId, file.localId))}
              aria-label={`Retry uploading ${file.name}`}
              sx={buttonSx}
            >
              Retry
            </Button>
            <Button
              size="small"
              color="error"
              disabled={busy}
              startIcon={<DeleteOutlineIcon fontSize="small" />}
              onClick={() => void run(() => removeAttachment(clientId, file.localId))}
              aria-label={`Remove ${file.name}`}
              sx={buttonSx}
            >
              Remove
            </Button>
          </Box>
        ) : (
          <LinearProgress
            variant="determinate"
            value={percent}
            aria-label={`Uploading ${file.name}`}
            aria-valuetext={file.status === "waiting" ? text : `${percent}%`}
            sx={{ mt: 0.75, height: 6, borderRadius: 3 }}
          />
        )}
      </Box>
      {uploading && (
        <Tooltip title="Cancel upload">
          <IconButton
            onClick={() => void run(() => removeAttachment(clientId, file.localId))}
            disabled={busy}
            aria-label={`Cancel uploading ${file.name}`}
            sx={{ width: iconSize, height: iconSize, flexShrink: 0 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

interface PendingAttachmentsProps {
  message: Message;
}

export const PendingAttachments: React.FC<PendingAttachmentsProps> = ({ message }) => {
  const entry = usePendingUpload(message);
  const isServerMessage = !message.sendStatus && !isOptimisticMessageId(message.id);

  // The message became real without this entry hearing about it (a late
  // echo reconciled a row whose ack had timed out): start its uploads now.
  useEffect(() => {
    if (entry && !entry.messageId && isServerMessage) {
      startAttachmentUploads(entry.clientId, message.id);
    }
  }, [entry, isServerMessage, message.id]);

  if (!entry) return null;
  const attachedIds = new Set((message.attachments ?? []).map((a) => a.id));
  const files = entry.files.filter(
    (f) => f.status !== "done" && !(f.fileId && attachedIds.has(f.fileId)),
  );
  if (files.length === 0) return null;

  return (
    <Box
      role="list"
      aria-label="Attachments being uploaded"
      data-testid="pending-attachments"
      sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1, maxWidth: 440, minWidth: 0 }}
    >
      {files.map((file) => (
        <PendingAttachmentTile
          key={file.localId}
          clientId={entry.clientId}
          file={file}
          sendFailed={message.sendStatus === "failed"}
        />
      ))}
    </Box>
  );
};

export default PendingAttachments;
