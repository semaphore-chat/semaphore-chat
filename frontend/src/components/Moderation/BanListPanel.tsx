/**
 * BanListPanel Component
 *
 * Displays the list of banned users in a community.
 * Allows moderators to unban users.
 */

import React, { useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Skeleton,
  Alert,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useTheme } from "@mui/material/styles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  moderationControllerGetBanListOptions,
  moderationControllerUnbanUserMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { CommunityBanDto as CommunityBan } from "../../api-client/types.gen";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { invalidateModerationQueries } from "../../utils/queryInvalidation";
import UserAvatar from "../Common/UserAvatar";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { logger } from "../../utils/logger";

interface BanListPanelProps {
  communityId: string;
}

interface UnbanDialogProps {
  open: boolean;
  onClose: () => void;
  ban: CommunityBan | null;
  onUnban: (reason?: string) => Promise<void>;
  isLoading: boolean;
}

const UnbanDialog: React.FC<UnbanDialogProps> = ({
  open,
  onClose,
  ban: _ban,
  onUnban,
  isLoading,
}) => {
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    await onUnban(reason.trim() || undefined);
    setReason("");
    onClose();
  };

  const handleClose = () => {
    setReason("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Unban User</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to unban this user? They will be able to rejoin the community.
          </Typography>

          <TextField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            rows={2}
            fullWidth
            placeholder="Reason for unbanning..."
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="success"
          disabled={isLoading}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading ? "Unbanning..." : "Unban User"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const BanListPanel: React.FC<BanListPanelProps> = ({ communityId }) => {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: bans, isLoading, error } = useQuery(moderationControllerGetBanListOptions({ path: { communityId } }));
  const { mutateAsync: unbanUser, isPending: isUnbanning } = useMutation({
    ...moderationControllerUnbanUserMutation(),
    onSuccess: () => invalidateModerationQueries(queryClient),
  });
  const [selectedBan, setSelectedBan] = useState<CommunityBan | null>(null);

  const canUnban = useCanPerformAction("COMMUNITY", communityId, RBAC_ACTIONS.UNBAN_USER);

  const handleUnban = async (reason?: string) => {
    if (!selectedBan) return;

    try {
      await unbanUser({
        path: { communityId, userId: selectedBan.userId },
        body: { reason },
      });
    } catch (err) {
      logger.error("Failed to unban user:", err);
    }
  };

  const getBanStatus = (ban: CommunityBan) => {
    if (!ban.expiresAt) {
      return { label: "Permanent", color: "error" as const };
    }
    if (isPast(new Date(ban.expiresAt))) {
      return { label: "Expired", color: "default" as const };
    }
    return {
      label: `Expires ${formatDistanceToNow(new Date(ban.expiresAt), { addSuffix: true })}`,
      color: "warning" as const,
    };
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Ban List
        </Typography>
        {[1, 2, 3].map((i) => (
          <Box key={i} sx={{ mb: 2 }}>
            <Skeleton variant="rectangular" height={72} sx={{ borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load ban list</Alert>
      </Box>
    );
  }

  const activeBans = bans?.filter(ban => ban.active) || [];

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <BlockIcon sx={{ mr: 1, color: "error.main" }} />
        <Typography variant="h6">
          Ban List ({activeBans.length})
        </Typography>
      </Box>

      {activeBans.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 4,
            px: 2,
            borderRadius: 1,
            backgroundColor: theme.palette.semantic.overlay.light,
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 48, color: "success.main", mb: 2 }} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            No banned users
          </Typography>
        </Box>
      ) : (
        <List disablePadding>
          {activeBans.map((ban) => {
            const status = getBanStatus(ban);
            return (
              <ListItem
                key={ban.id}
                sx={{
                  mb: 1,
                  borderRadius: 1,
                  border: 1,
                  borderColor: "divider",
                  backgroundColor: theme.palette.semantic.overlay.light,
                }}
                secondaryAction={
                  canUnban && (
                    <Button
                      size="small"
                      variant="outlined"
                      color="success"
                      onClick={() => setSelectedBan(ban)}
                    >
                      Unban
                    </Button>
                  )
                }
              >
                <ListItemAvatar>
                  <UserAvatar
                    user={ban.user ? { id: ban.userId, username: ban.user.username, avatarUrl: ban.user.avatarUrl } : { id: ban.userId, username: ban.userId }}
                    size="medium"
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="subtitle2">
                        {ban.user?.displayName || ban.user?.username || `User ${ban.userId.slice(0, 8)}...`}
                      </Typography>
                      <Chip
                        label={status.label}
                        color={status.color}
                        size="small"
                      />
                    </Box>
                  }
                  secondary={
                    <Box>
                      {ban.reason && (
                        <Typography variant="body2" color="text.secondary">
                          Reason: {ban.reason}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Banned {format(new Date(ban.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      )}

      <UnbanDialog
        open={!!selectedBan}
        onClose={() => setSelectedBan(null)}
        ban={selectedBan}
        onUnban={handleUnban}
        isLoading={isUnbanning}
      />
    </Box>
  );
};

export default BanListPanel;
