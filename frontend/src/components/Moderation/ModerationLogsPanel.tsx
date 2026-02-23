/**
 * ModerationLogsPanel Component
 *
 * Displays the audit log of all moderation actions in a community.
 * Supports filtering by action type and pagination.
 */

import React, { useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Skeleton,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Pagination,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import BlockIcon from "@mui/icons-material/Block";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import TimerIcon from "@mui/icons-material/Timer";
import TimerOffIcon from "@mui/icons-material/TimerOff";
import DeleteIcon from "@mui/icons-material/Delete";
import PushPinIcon from "@mui/icons-material/PushPin";
import { alpha, useTheme } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { moderationControllerGetModerationLogsOptions } from "../../api-client/@tanstack/react-query.gen";
import type { ModerationLogDto } from "../../api-client/types.gen";
type ModerationAction = ModerationLogDto['action'];
type ModerationLog = ModerationLogDto;
import { format } from "date-fns";

interface ModerationLogsPanelProps {
  communityId: string;
}

const PAGE_SIZE = 20;

type ActionColorKey = 'error' | 'success' | 'warning' | 'primary' | 'secondary';

const ACTION_CONFIG: Record<ModerationAction, { icon: React.ReactNode; label: string; colorKey: ActionColorKey }> = {
  BAN_USER: { icon: <BlockIcon />, label: "Ban User", colorKey: "error" },
  UNBAN_USER: { icon: <LockOpenIcon />, label: "Unban User", colorKey: "success" },
  KICK_USER: { icon: <PersonRemoveIcon />, label: "Kick User", colorKey: "warning" },
  TIMEOUT_USER: { icon: <TimerIcon />, label: "Timeout User", colorKey: "warning" },
  REMOVE_TIMEOUT: { icon: <TimerOffIcon />, label: "Remove Timeout", colorKey: "success" },
  DELETE_MESSAGE: { icon: <DeleteIcon />, label: "Delete Message", colorKey: "error" },
  PIN_MESSAGE: { icon: <PushPinIcon />, label: "Pin Message", colorKey: "primary" },
  UNPIN_MESSAGE: { icon: <PushPinIcon />, label: "Unpin Message", colorKey: "secondary" },
};

const ModerationLogsPanel: React.FC<ModerationLogsPanelProps> = ({ communityId }) => {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<ModerationAction | "">("");
  const theme = useTheme();

  const { data, isLoading, error } = useQuery(moderationControllerGetModerationLogsOptions({
    path: { communityId },
    query: {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      action: actionFilter || undefined,
    },
  }));

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleFilterChange = (value: ModerationAction | "") => {
    setActionFilter(value);
    setPage(1); // Reset to first page when filter changes
  };

  const getActionDisplay = (action: ModerationAction) => {
    const config = ACTION_CONFIG[action] || { icon: <HistoryIcon />, label: action, colorKey: "primary" as ActionColorKey };
    // Resolve the actual color from the theme
    const color = theme.palette[config.colorKey].main;
    return { ...config, color };
  };

  const formatLogEntry = (log: ModerationLog): string => {
    const parts: string[] = [];

    if (log.targetUserId) {
      const targetName = log.targetUser?.displayName || log.targetUser?.username || `${log.targetUserId.slice(0, 8)}...`;
      parts.push(`Target: ${targetName}`);
    }
    if (log.targetMessageId) {
      parts.push(`Message: ${log.targetMessageId.slice(0, 8)}...`);
    }
    if (log.reason) {
      parts.push(`Reason: ${log.reason}`);
    }

    return parts.join(" • ") || "No additional details";
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Moderation Logs
        </Typography>
        {[1, 2, 3, 4, 5].map((i) => (
          <Box key={i} sx={{ mb: 1 }}>
            <Skeleton variant="rectangular" height={64} sx={{ borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load moderation logs</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <HistoryIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">
            Moderation Logs
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Filter by Action</InputLabel>
          <Select
            value={actionFilter}
            label="Filter by Action"
            onChange={(e) => handleFilterChange(e.target.value as ModerationAction | "")}
          >
            <MenuItem value="">All Actions</MenuItem>
            {Object.entries(ACTION_CONFIG).map(([action, config]) => (
              <MenuItem key={action} value={action}>
                {config.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {!data?.logs || data.logs.length === 0 ? (
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
          <HistoryIcon sx={{ fontSize: 48, color: "text.disabled", mb: 2 }} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            No moderation logs found
          </Typography>
        </Box>
      ) : (
        <>
          <List disablePadding>
            {data.logs.map((log) => {
              const actionDisplay = getActionDisplay(log.action);
              return (
                <ListItem
                  key={log.id}
                  sx={{
                    mb: 1,
                    borderRadius: 1,
                    border: 1,
                    borderColor: "divider",
                    backgroundColor: theme.palette.semantic.overlay.light,
                  }}
                >
                  <ListItemIcon sx={{ color: actionDisplay.color }}>
                    {actionDisplay.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Chip
                          label={actionDisplay.label}
                          size="small"
                          sx={{
                            backgroundColor: alpha(actionDisplay.color, 0.1),
                            color: actionDisplay.color,
                          }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          by {log.moderator?.displayName || log.moderator?.username || `${log.moderatorId.slice(0, 8)}...`}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {formatLogEntry(log)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {format(new Date(log.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItem>
              );
            })}
          </List>

          {totalPages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default ModerationLogsPanel;
