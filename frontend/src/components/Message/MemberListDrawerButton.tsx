/**
 * The chat header's "Members" button for the desktop layout in a narrow
 * window (< 1024px, only an Electron window: see `isNarrowDesktop` in
 * useResponsive). There the inline member column doesn't fit next to the
 * community rail and channel sidebar, so MessageContainer leaves it out and
 * this button opens the same list in a drawer from the right. Renders nothing
 * everywhere else: wide desktop keeps the inline column, and the phone and
 * tablet layouts have their own app bar button.
 */
import React from "react";
import { Box, Drawer, IconButton, Tooltip, Typography } from "@mui/material";
import { Close as CloseIcon, People as PeopleIcon } from "@mui/icons-material";
import MemberListContainer from "./MemberListContainer";
import { useResponsive } from "../../hooks/useResponsive";
import type { VoiceSessionType } from "../../contexts/VoiceContext";

interface MemberListDrawerButtonProps {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  isPrivate?: boolean;
}

export const MemberListDrawerButton: React.FC<MemberListDrawerButtonProps> = ({
  contextType,
  contextId,
  communityId,
  isPrivate,
}) => {
  const { isNarrowDesktop } = useResponsive();
  const [open, setOpen] = React.useState(false);

  if (!isNarrowDesktop) return null;

  return (
    <>
      <Tooltip title="Members">
        <IconButton size="small" aria-label="Show members" onClick={() => setOpen(true)}>
          <PeopleIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { width: 280, maxWidth: "85vw" } }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 2,
              py: 1,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
              Members
            </Typography>
            <IconButton size="small" aria-label="Close members" onClick={() => setOpen(false)} sx={{ mr: -1 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, overflow: "auto" }}>
            <MemberListContainer
              contextType={contextType}
              contextId={contextId}
              communityId={communityId}
              isPrivate={isPrivate}
              fullWidth
            />
          </Box>
        </Box>
      </Drawer>
    </>
  );
};

export default MemberListDrawerButton;
