import React from "react";
import { Box, Typography, Tooltip, Avatar } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { directMessagesControllerFindDmGroupOptions } from "../../api-client/@tanstack/react-query.gen";
import { useDmPeerReads } from "../../hooks/useDmPeerReads";
import { ReadStatusIndicator } from "./ReadStatusIndicator";

const MAX_TOOLTIP_READERS = 15;

interface SeenByTooltipProps {
  sentAt: string;
  directMessageGroupId: string;
}

/**
 * Renders a read-status eye icon for own DM messages with a "seen by" tooltip on hover.
 * Uses watermark-based comparison: returns null (no icon) when unread,
 * shows blue eye when at least one peer has read past this message's timestamp.
 */
export const SeenByTooltip: React.FC<SeenByTooltipProps> = ({
  sentAt,
  directMessageGroupId,
}) => {
  const { getReadByCount, getReaderIds } = useDmPeerReads(directMessageGroupId);

  const { data: dmGroup } = useQuery({
    ...directMessagesControllerFindDmGroupOptions({ path: { id: directMessageGroupId } }),
    staleTime: Infinity,
  });

  const readByCount = getReadByCount(sentAt);
  if (readByCount === 0) return null;

  const readerIds = getReaderIds(sentAt);

  // Look up display info from cached DM group members
  const resolvedReaders = readerIds
    .map((id) => dmGroup?.members?.find((m) => m.userId === id)?.user)
    .filter(Boolean) as Array<{ id: string; username: string; displayName?: string | null; avatarUrl?: string | null }>;

  const displayReaders = resolvedReaders.slice(0, MAX_TOOLTIP_READERS);
  const remainingCount = readByCount - displayReaders.length;

  // For 1:1 DMs, show the peer's name if resolved; otherwise fall back to count
  const singleReaderName = readByCount === 1 && displayReaders[0]
    ? (displayReaders[0].displayName || displayReaders[0].username)
    : null;

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
        {singleReaderName
          ? `Seen by ${singleReaderName}`
          : `Seen by ${readByCount}`}
      </Typography>
      {readByCount > 1 && (
        <>
          {displayReaders.map((reader) => (
            <Box
              key={reader.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.25,
              }}
            >
              <Avatar
                src={reader.avatarUrl ?? undefined}
                sx={{ width: 18, height: 18, fontSize: 'scale.2xs' }}
              >
                {(reader.displayName || reader.username)?.[0]?.toUpperCase()}
              </Avatar>
              <Typography variant="body2" sx={{ fontSize: 'scale.sm' }}>
                {reader.displayName || reader.username}
              </Typography>
            </Box>
          ))}
          {remainingCount > 0 && (
            <Typography
              variant="body2"
              sx={{
                fontSize: 'scale.sm',
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
        <ReadStatusIndicator showForDm={true} disableTooltip={true} />
      </span>
    </Tooltip>
  );
};

export default SeenByTooltip;
