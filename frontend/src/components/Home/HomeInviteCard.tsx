import React, { useState } from "react";
import { Box, Button, CircularProgress, IconButton, Paper, Snackbar, Tooltip, Typography } from "@mui/material";
import {
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  PersonAdd as PersonAddIcon,
  Settings as SettingsIcon,
} from "@mui/icons-material";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteControllerCreateInviteMutation } from "../../api-client/@tanstack/react-query.gen";
import type { CommunityResponseDto } from "../../api-client/types.gen";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { invalidateInviteQueries } from "../../utils/queryInvalidation";
import { copyToClipboard } from "../../utils/clipboard";
import { getInstanceUrl } from "../../config/env";
import { logger } from "../../utils/logger";
import type { CreateInviteDto } from "../../types/invite.type";

export const INVITE_CARD_DISMISSED_KEY = "semaphore:home:inviteCardDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INVITE_CARD_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(INVITE_CARD_DISMISSED_KEY, "1");
  } catch {
    // Storage unavailable (private window, blocked site data): hide for this visit only.
  }
}

const inviteUrl = (code: string) => `${getInstanceUrl()}/#/join/${code}`;

/** "Invite people" for users who may create instance invites; dismissible per browser. */
const HomeInviteCard: React.FC<{ communities: CommunityResponseDto[] }> = ({ communities }) => {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const { hasPermissions: canCreateInvites } = useUserPermissions({
    resourceType: "INSTANCE",
    actions: ["CREATE_INSTANCE_INVITE"],
  });
  const { hasPermissions: canViewInvites } = useUserPermissions({
    resourceType: "INSTANCE",
    actions: ["READ_INSTANCE_INVITE"],
  });

  const { mutateAsync: createInvite, isPending } = useMutation({
    ...inviteControllerCreateInviteMutation(),
    onSuccess: () => invalidateInviteQueries(queryClient),
  });

  if (!canCreateInvites || dismissed) return null;

  const handleQuickInvite = async () => {
    try {
      // Prefer a community called "default", else every community you're in.
      const defaultCommunity = communities.find((c) => c.name.toLowerCase() === "default");
      const body: CreateInviteDto = {
        communityIds: defaultCommunity ? [defaultCommunity.id] : communities.map((c) => c.id),
        maxUses: 10,
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const invite = await createInvite({ body });
      setLastCode(invite.code);
      await copyToClipboard(inviteUrl(invite.code));
      setSnackbarOpen(true);
    } catch (error) {
      logger.error("Failed to create invite:", error);
    }
  };

  const handleCopy = async () => {
    if (!lastCode) return;
    try {
      await copyToClipboard(inviteUrl(lastCode));
      setSnackbarOpen(true);
    } catch (error) {
      logger.error("Failed to copy invite link:", error);
    }
  };

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <Paper
      variant="outlined"
      data-testid="home-invite-card"
      sx={{ p: 2, borderRadius: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}
    >
      <PersonAddIcon color="primary" sx={{ fontSize: "icon.2xl" }} />
      <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
        <Typography variant="subtitle2">Invite people</Typography>
        <Typography variant="body2" color="text.secondary">
          Create a 7-day invite link and copy it to your clipboard.
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {lastCode && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {lastCode}
            </Typography>
            <Tooltip title="Copy invite link">
              <IconButton size="small" onClick={handleCopy} aria-label="Copy invite link">
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <Button variant="contained" size="small" onClick={handleQuickInvite} disabled={isPending}>
          {isPending ? <CircularProgress size={18} color="inherit" /> : "Quick invite"}
        </Button>
        {canViewInvites && (
          <Button component={Link} to="/admin/invites" size="small" startIcon={<SettingsIcon />}>
            Manage
          </Button>
        )}
        <Tooltip title="Dismiss">
          <IconButton size="small" onClick={handleDismiss} aria-label="Dismiss invite card">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message="Invite link copied to clipboard!"
      />
    </Paper>
  );
};

export default HomeInviteCard;
