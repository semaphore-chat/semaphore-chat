import React from "react";
import { Box, Typography, IconButton, Skeleton } from "@mui/material";
import { ArrowBack } from "@mui/icons-material";
import { DMVoiceControls } from "../DirectMessage/DMVoiceControls";

interface DMChatHeaderProps {
  dmGroupId: string;
  /** The conversation's name; undefined while it's loading (shows a skeleton). */
  dmGroupName?: string;
  /** The conversation failed to load (403/404/...): say so, and offer no calls. */
  unavailable?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
}

export const DMChatHeader: React.FC<DMChatHeaderProps> = ({
  dmGroupId,
  dmGroupName,
  unavailable = false,
  showBackButton = false,
  onBack,
}) => {
  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
          minHeight: 64,
        }}
      >
        {/* Left side: Back button + Name */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
          {showBackButton && onBack && (
            <IconButton onClick={onBack} size="small" edge="start">
              <ArrowBack />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ fontWeight: 600 }}>
            {unavailable ? (
              "Conversation unavailable"
            ) : (
              dmGroupName ?? (
                <Skeleton
                  role="progressbar"
                  aria-label="Loading conversation"
                  aria-busy="true"
                  width={160}
                  sx={{ maxWidth: "100%" }}
                />
              )
            )}
          </Typography>
        </Box>

        {/* Right side: Voice controls (disabled until the name is known) */}
        {!unavailable && <DMVoiceControls dmGroupId={dmGroupId} dmGroupName={dmGroupName} />}
      </Box>
    </>
  );
};
