/**
 * TimeoutListPanel Component
 *
 * Displays the list of timed out users in a community.
 * Allows moderators to remove timeouts early.
 */

import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Button,
  Skeleton,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
} from "@mui/material";
import TimerIcon from "@mui/icons-material/Timer";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useTheme } from "@mui/material/styles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  moderationControllerGetTimeoutListOptions,
  moderationControllerRemoveTimeoutMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { CommunityTimeoutDto as CommunityTimeout } from "../../api-client/types.gen";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { invalidateTimeoutQueries } from "../../utils/queryInvalidation";
import UserAvatar from "../Common/UserAvatar";
import { format, isPast, differenceInSeconds } from "date-fns";
import { logger } from "../../utils/logger";

interface TimeoutListPanelProps {
  communityId: string;
}

interface RemoveTimeoutDialogProps {
  open: boolean;
  onClose: () => void;
  timeout: CommunityTimeout | null;
  onRemove: (reason?: string) => Promise<void>;
  isLoading: boolean;
}

const RemoveTimeoutDialog: React.FC<RemoveTimeoutDialogProps> = ({
  open,
  onClose,
  onRemove,
  isLoading,
}) => {
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    await onRemove(reason.trim() || undefined);
    setReason("");
    onClose();
  };

  const handleClose = () => {
    setReason("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Remove Timeout</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to remove this timeout? The user will be able to send messages immediately.
          </Typography>

          <TextField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            rows={2}
            fullWidth
            placeholder="Reason for removing timeout..."
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
          {isLoading ? "Removing..." : "Remove Timeout"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const formatTimeRemaining = (expiresAt: string): string => {
  const seconds = differenceInSeconds(new Date(expiresAt), new Date());
  if (seconds <= 0) return "Expired";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s remaining`;
  }
  return `${secs}s remaining`;
};

const TimeoutListPanel: React.FC<TimeoutListPanelProps> = ({ communityId }) => {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: timeouts, isLoading, error } = useQuery(moderationControllerGetTimeoutListOptions({ path: { communityId } }));
  const { mutateAsync: removeTimeout, isPending: isRemoving } = useMutation({
    ...moderationControllerRemoveTimeoutMutation(),
    onSuccess: () => invalidateTimeoutQueries(queryClient),
  });
  const [selectedTimeout, setSelectedTimeout] = useState<CommunityTimeout | null>(null);
  const [, setTick] = useState(0);

  const canRemoveTimeout = useCanPerformAction("COMMUNITY", communityId, RBAC_ACTIONS.TIMEOUT_USER);

  // Update the display every second to show accurate time remaining
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRemoveTimeout = async (reason?: string) => {
    if (!selectedTimeout) return;

    try {
      await removeTimeout({
        path: { communityId, userId: selectedTimeout.userId },
        body: { reason },
      });
    } catch (err) {
      logger.error("Failed to remove timeout:", err);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Active Timeouts
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
        <Alert severity="error">Failed to load timeout list</Alert>
      </Box>
    );
  }

  // Filter out expired timeouts
  const activeTimeouts = timeouts?.filter(
    timeout => !isPast(new Date(timeout.expiresAt))
  ) || [];

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <TimerIcon sx={{ mr: 1, color: "warning.main" }} />
        <Typography variant="h6">
          Active Timeouts ({activeTimeouts.length})
        </Typography>
      </Box>

      {activeTimeouts.length === 0 ? (
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
            No active timeouts
          </Typography>
        </Box>
      ) : (
        <List disablePadding>
          {activeTimeouts.map((timeout) => (
            <ListItem
              key={timeout.id}
              sx={{
                mb: 1,
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                backgroundColor: theme.palette.semantic.overlay.light,
              }}
              secondaryAction={
                canRemoveTimeout && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="success"
                    onClick={() => setSelectedTimeout(timeout)}
                  >
                    Remove
                  </Button>
                )
              }
            >
              <ListItemAvatar>
                <UserAvatar
                  user={timeout.user ? { id: timeout.userId, username: timeout.user.username, avatarUrl: timeout.user.avatarUrl } : { id: timeout.userId, username: timeout.userId }}
                  size="medium"
                />
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="subtitle2">
                      {timeout.user?.displayName || timeout.user?.username || `User ${timeout.userId.slice(0, 8)}...`}
                    </Typography>
                    <Chip
                      label={formatTimeRemaining(timeout.expiresAt)}
                      color="warning"
                      size="small"
                    />
                  </Box>
                }
                secondary={
                  <Box>
                    {timeout.reason && (
                      <Typography variant="body2" color="text.secondary">
                        Reason: {timeout.reason}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      Started {format(new Date(timeout.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <RemoveTimeoutDialog
        open={!!selectedTimeout}
        onClose={() => setSelectedTimeout(null)}
        timeout={selectedTimeout}
        onRemove={handleRemoveTimeout}
        isLoading={isRemoving}
      />
    </Box>
  );
};

export default TimeoutListPanel;
