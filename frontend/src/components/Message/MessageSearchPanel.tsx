/**
 * Message search as a docked side panel (wide desktop): a header with a close
 * button over the shared search body. Opening a result jumps to it and keeps
 * the panel open, so you can step through several results.
 */
import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { MessageSearchBody } from "./MessageSearch";

interface MessageSearchPanelProps {
  channelId: string;
  communityId: string;
  onClose: () => void;
}

export const MessageSearchPanel: React.FC<MessageSearchPanelProps> = ({ channelId, communityId, onClose }) => (
  <Box data-testid="message-search-panel" sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        p: 2,
        flexShrink: 0,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <SearchIcon sx={{ color: "primary.main" }} />
        <Typography variant="h6">Search</Typography>
      </Box>
      <IconButton size="small" onClick={onClose} aria-label="Close search">
        <CloseIcon />
      </IconButton>
    </Box>
    <MessageSearchBody channelId={channelId} communityId={communityId} active onClose={onClose} fillHeight />
  </Box>
);

export default MessageSearchPanel;
