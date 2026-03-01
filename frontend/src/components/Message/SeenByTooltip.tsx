import React, { useState } from "react";
import { Box, Typography, Tooltip, Avatar, CircularProgress } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { readReceiptsControllerGetMessageReadersOptions } from "../../api-client/@tanstack/react-query.gen";
import type { MessageReader } from "../../types/read-receipt.type";
import { ReadStatusIndicator } from "./ReadStatusIndicator";

interface SeenByTooltipProps {
  messageId: string;
  directMessageGroupId: string;
}

/**
 * Renders a read-status icon for DM messages with a "seen by" tooltip on hover.
 * - Shows a check icon (sent) by default
 * - After hovering and fetching readers, switches to eye icon (seen) if anyone has read it
 * - The "seen by" list never includes the current user (filtered by the backend)
 */
export const SeenByTooltip: React.FC<SeenByTooltipProps> = ({
  messageId,
  directMessageGroupId,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const { data: readersData, isLoading, isFetching } = useQuery({
    ...readReceiptsControllerGetMessageReadersOptions({
      path: { messageId },
      query: { channelId: '', directMessageGroupId },
    }),
    staleTime: 30_000,
  });
  const readers = (readersData as MessageReader[] | undefined) ?? undefined;

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  // Determine read status from fetched readers
  const hasSeen = (readers?.length ?? 0) > 0;
  const readStatus = hasSeen ? "read" as const : "sent" as const;

  const displayReaders = readers?.slice(0, 15) ?? [];
  const remainingCount = (readers?.length ?? 0) - displayReaders.length;

  const tooltipContent = (
    <Box sx={{ minWidth: 150, maxWidth: 250, p: 0.5 }}>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          color: "text.secondary",
          display: "block",
          mb: 0.5,
        }}
      >
        {hasSeen ? "Seen by" : "Sent"}
      </Typography>
      {isLoading || isFetching ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
          <CircularProgress size={16} />
        </Box>
      ) : displayReaders.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
          Not seen yet
        </Typography>
      ) : (
        <>
          {displayReaders.map((reader: MessageReader) => (
            <Box
              key={reader.userId}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.25,
              }}
            >
              <Avatar
                src={reader.avatarUrl}
                sx={{ width: 18, height: 18, fontSize: 10 }}
              >
                {(reader.displayName || reader.username)?.[0]?.toUpperCase()}
              </Avatar>
              <Typography variant="body2" sx={{ fontSize: 12 }}>
                {reader.displayName || reader.username}
              </Typography>
            </Box>
          ))}
          {remainingCount > 0 && (
            <Typography
              variant="body2"
              sx={{
                fontSize: 12,
                fontStyle: "italic",
                color: "text.secondary",
                mt: 0.5,
              }}
            >
              +{remainingCount} more
            </Typography>
          )}
        </>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={tooltipContent}
      placement="top"
      open={isOpen}
      onOpen={handleOpen}
      onClose={handleClose}
      componentsProps={{
        tooltip: {
          sx: {
            backgroundColor: "background.paper",
            color: "text.primary",
            boxShadow: 3,
            border: 1,
            borderColor: "divider",
            maxWidth: "none",
          },
        },
      }}
    >
      <span>
        <ReadStatusIndicator
          status={readStatus}
          showForDm={true}
          disableTooltip={true}
        />
      </span>
    </Tooltip>
  );
};

export default SeenByTooltip;
