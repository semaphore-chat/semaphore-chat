import React, { useState } from "react";
import { logger } from "../../utils/logger";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Tooltip,
  Avatar,
} from "@mui/material";
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenIcon,
} from "@mui/icons-material";
import ConfirmDialog from "../../components/Common/ConfirmDialog";
import { AuthenticatedImage } from "../../components/Common/AuthenticatedImage";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  communityControllerFindAllWithStatsOptions,
  communityControllerForceRemoveMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { invalidateCommunityQueries } from "../../utils/queryInvalidation";

import type { CommunityStatsDto as AdminCommunity } from "../../api-client/types.gen";

const AdminCommunitiesPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    community: AdminCommunity | null;
  }>({ open: false, community: null });

  const { data, isLoading, error, refetch } = useQuery(communityControllerFindAllWithStatsOptions({
    query: { search: search || undefined, limit: 100 } as { search: string; limit: number; continuationToken: string },
  }));

  const { mutateAsync: forceDeleteCommunity } = useMutation({
    ...communityControllerForceRemoveMutation(),
    onSuccess: () => invalidateCommunityQueries(queryClient),
  });

  const handleDelete = (community: AdminCommunity) => {
    setConfirmDialog({ open: true, community });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDialog.community) return;

    try {
      await forceDeleteCommunity({ path: { id: confirmDialog.community.id } });
      refetch();
    } catch (error) {
      logger.error("Failed to delete community:", error);
    }

    setConfirmDialog({ open: false, community: null });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load communities. Please try again.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Community Management
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        View and manage all communities on this instance
      </Typography>

      {/* Search */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <TextField
            placeholder="Search communities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 300 }}
            size="small"
          />
        </CardContent>
      </Card>

      {/* Communities Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Community</TableCell>
                <TableCell align="right">Members</TableCell>
                <TableCell align="right">Channels</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.communities.map((community) => (
                <TableRow key={community.id} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      {/* community.avatar is a file id — resolve it through the authenticated file cache */}
                      <AuthenticatedImage
                        fileId={community.avatar}
                        alt={community.name}
                        component="avatar"
                        sx={{ width: 40, height: 40, flexShrink: 0 }}
                        fallback={
                          <Avatar sx={{ width: 40, height: 40, flexShrink: 0 }}>
                            {community.name.charAt(0).toUpperCase()}
                          </Avatar>
                        }
                      />
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          {community.name}
                        </Typography>
                        {community.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 1,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              maxWidth: 300,
                            }}
                          >
                            {community.description}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {community.memberCount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {community.channelCount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatDate(community.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Open Community">
                      <IconButton
                        onClick={() => navigate(`/community/${community.id}`)}
                        size="small"
                      >
                        <OpenIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete Community">
                      <IconButton
                        onClick={() => handleDelete(community)}
                        size="small"
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Empty State */}
      {data?.communities.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography color="text.secondary">
            {search ? "No communities match your search" : "No communities found"}
          </Typography>
        </Box>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title="Delete Community"
        description={
          <>
            Are you sure you want to delete{" "}
            <strong>{confirmDialog.community?.name}</strong>? This will permanently
            remove all channels, messages, and members from this community.
            <Typography color="error" sx={{ mt: 2 }}>
              This action cannot be undone.
            </Typography>
          </>
        }
        confirmLabel="Delete Community"
        confirmColor="error"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDialog({ open: false, community: null })}
      />
    </Box>
  );
};

export default AdminCommunitiesPage;
