import React, { useState, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Tooltip,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Group as GroupIcon,
} from "@mui/icons-material";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  aliasGroupsControllerGetCommunityAliasGroupsOptions,
  aliasGroupsControllerDeleteAliasGroupMutation,
} from "../../api-client/@tanstack/react-query.gen";
export interface AliasGroupSummary {
  id: string;
  name: string;
  memberCount: number;
}
import AliasGroupEditor from "./AliasGroupEditor";
import { invalidateAliasGroupQueries } from "../../utils/queryInvalidation";
import ConfirmDialog from "../Common/ConfirmDialog";

interface AliasGroupManagementProps {
  communityId: string;
}

const AliasGroupManagement: React.FC<AliasGroupManagementProps> = ({ communityId }) => {
  const [editingGroup, setEditingGroup] = useState<AliasGroupSummary | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AliasGroupSummary | null>(null);

  const { hasPermissions: canReadGroups } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["READ_ALIAS_GROUP"],
  });

  const { hasPermissions: canCreateGroups } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["CREATE_ALIAS_GROUP"],
  });

  const { hasPermissions: canUpdateGroups } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["UPDATE_ALIAS_GROUP"],
  });

  const { hasPermissions: canDeleteGroups } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["DELETE_ALIAS_GROUP"],
  });

  const queryClient = useQueryClient();
  const {
    data: aliasGroups,
    isLoading: loadingGroups,
    error: groupsError,
  } = useQuery({
    ...aliasGroupsControllerGetCommunityAliasGroupsOptions({ path: { communityId } }),
    enabled: canReadGroups,
  });

  const { mutateAsync: deleteGroup, isPending: deletingGroupLoading } = useMutation({
    ...aliasGroupsControllerDeleteAliasGroupMutation(),
    onSuccess: () => invalidateAliasGroupQueries(queryClient),
  });

  const handleDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;

    try {
      await deleteGroup({
        path: { groupId: groupToDelete.id },
      });
      setDeleteConfirmOpen(false);
      setGroupToDelete(null);
    } catch {
      // Error handled by RTK Query
    }
  }, [groupToDelete, deleteGroup]);

  const handleCancelEdit = useCallback(() => {
    setCreatingGroup(false);
    setEditingGroup(null);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setDeleteConfirmOpen(false);
  }, []);

  const handleOpenDeleteDialog = useCallback((group: AliasGroupSummary) => {
    setGroupToDelete(group);
    setDeleteConfirmOpen(true);
  }, []);

  const handleEditComplete = useCallback(() => {
    setCreatingGroup(false);
    setEditingGroup(null);
  }, []);

  if (!canReadGroups) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Mention Groups
          </Typography>
          <Alert severity="info">
            You don't have permission to view mention groups in this community.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (creatingGroup || editingGroup) {
    return (
      <AliasGroupEditor
        communityId={communityId}
        group={editingGroup || undefined}
        onComplete={handleEditComplete}
        onCancel={handleCancelEdit}
      />
    );
  }

  if (loadingGroups) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (groupsError) {
    return (
      <Alert severity="error">
        Failed to load mention groups. Please try again.
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Box>
              <Typography variant="h6">
                Mention Groups
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create groups that can be mentioned with @groupname to notify all members at once.
              </Typography>
            </Box>
            {canCreateGroups && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreatingGroup(true)}
              >
                Create Group
              </Button>
            )}
          </Box>

          {aliasGroups && aliasGroups.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Group Name</TableCell>
                    <TableCell>Members</TableCell>
                    <TableCell>Mention</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {aliasGroups.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <GroupIcon color="action" fontSize="small" />
                          <Typography variant="body2" fontWeight="medium">
                            {group.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`${group.memberCount} member${group.memberCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`@${group.name}`}
                          size="small"
                          color="warning"
                          sx={{ fontFamily: 'monospace' }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Box display="flex" gap={0.5} justifyContent="flex-end">
                          {canUpdateGroups && (
                            <Tooltip title="Edit group">
                              <IconButton
                                size="small"
                                onClick={() => setEditingGroup(group)}
                              >
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                          )}

                          {canDeleteGroups && (
                            <Tooltip title="Delete group">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleOpenDeleteDialog(group)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              py={4}
            >
              <GroupIcon sx={{ fontSize: 'icon.5xl', color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No mention groups yet
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center" mb={3}>
                Create mention groups to easily notify teams or groups of members.
                Use @groupname in messages to mention everyone in the group.
              </Typography>
              {canCreateGroups && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreatingGroup(true)}
                >
                  Create Your First Group
                </Button>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Mention Group"
        description={<>Are you sure you want to delete the group <strong>@{groupToDelete?.name}</strong>? This action cannot be undone and the group will no longer be available for mentions.</>}
        confirmLabel="Delete Group"
        confirmColor="error"
        isLoading={deletingGroupLoading}
        onConfirm={handleDeleteGroup}
        onCancel={handleCloseDeleteDialog}
      />
    </>
  );
};

export default AliasGroupManagement;
