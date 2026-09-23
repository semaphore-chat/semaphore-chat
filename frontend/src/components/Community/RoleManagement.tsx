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
  DialogContent,
  DialogActions,
  Tooltip,
} from "@mui/material";
import ResponsiveDialog from "../Common/ResponsiveDialog";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  People as PeopleIcon,
  Security as SecurityIcon,
  RestartAlt as RestartAltIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
} from "@mui/icons-material";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rolesControllerGetCommunityRolesOptions,
  rolesControllerCreateCommunityRoleMutation,
  rolesControllerUpdateRoleMutation,
  rolesControllerDeleteRoleMutation,
  rolesControllerGetUsersForRoleOptions,
  rolesControllerResetDefaultCommunityRolesMutation,
  rolesControllerReorderRolesMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { CreateRoleDto, RoleDto, UpdateRoleDto } from "../../api-client/types.gen";
import { invalidateRoleQueries, invalidateAllRoleQueries } from "../../utils/queryInvalidation";
import ConfirmDialog from "../Common/ConfirmDialog";
import RoleEditor from "./RoleEditor";
import { ACTION_LABELS } from "../../constants/rbacActions";

interface RoleManagementProps {
  communityId: string;
}

const RoleManagement: React.FC<RoleManagementProps> = ({ communityId }) => {
  const [editingRole, setEditingRole] = useState<RoleDto | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<RoleDto | null>(null);
  const [viewingRoleUsers, setViewingRoleUsers] = useState<string | null>(null);

  const { hasPermissions: canReadRoles } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["READ_ROLE"],
  });

  const { hasPermissions: canCreateRoles } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["CREATE_ROLE"],
  });

  const { hasPermissions: canUpdateRoles } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["UPDATE_ROLE"],
  });

  const { hasPermissions: canDeleteRoles } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["DELETE_ROLE"],
  });

  const queryClient = useQueryClient();

  const {
    data: communityRoles,
    isLoading: loadingRoles,
    error: rolesError,
  } = useQuery({
    ...rolesControllerGetCommunityRolesOptions({ path: { communityId } }),
    enabled: canReadRoles,
  });

  const {
    data: roleUsers,
    isLoading: loadingRoleUsers,
  } = useQuery({
    ...rolesControllerGetUsersForRoleOptions({ path: { communityId, roleId: viewingRoleUsers! } }),
    enabled: !!viewingRoleUsers,
  });

  const { mutateAsync: createRole, isPending: creatingRoleLoading, error: createRoleError } = useMutation({
    ...rolesControllerCreateCommunityRoleMutation(),
    onSuccess: () => invalidateRoleQueries(queryClient),
  });

  const { mutateAsync: updateRole, isPending: updatingRoleLoading, error: updateRoleError } = useMutation({
    ...rolesControllerUpdateRoleMutation(),
    onSuccess: () => invalidateRoleQueries(queryClient),
  });

  const { mutateAsync: deleteRole, isPending: deletingRoleLoading } = useMutation({
    ...rolesControllerDeleteRoleMutation(),
    onSuccess: () => invalidateRoleQueries(queryClient),
  });

  const { mutateAsync: resetDefaults, isPending: resettingDefaults } = useMutation({
    ...rolesControllerResetDefaultCommunityRolesMutation(),
    onSuccess: () => invalidateAllRoleQueries(queryClient),
  });

  const { mutateAsync: reorderRoles } = useMutation({
    ...rolesControllerReorderRolesMutation(),
    onSuccess: () => invalidateAllRoleQueries(queryClient),
  });

  const handleCreateRole = useCallback(async (data: { name?: string; actions: string[] }) => {
    try {
      await createRole({
        path: { communityId },
        body: {
          name: data.name!, // name is required for creating new roles
          // RoleEditor tracks actions as plain strings; the backend validates
          // them against its RbacActions enum.
          actions: data.actions as CreateRoleDto["actions"],
        },
      });
      setCreatingRole(false);
    } catch {
      // Error handled by RTK Query
    }
  }, [communityId, createRole]);

  const handleUpdateRole = useCallback(async (data: { name?: string; actions: string[] }) => {
    if (!editingRole) return;

    try {
      await updateRole({
        path: { communityId, roleId: editingRole.id },
        body: {
          name: data.name,
          // RoleEditor tracks actions as plain strings; the backend validates
          // them against its RbacActions enum.
          actions: data.actions as UpdateRoleDto["actions"],
        },
      });
      setEditingRole(null);
    } catch {
      // Error handled by RTK Query
    }
  }, [editingRole, updateRole, communityId]);

  const handleDeleteRole = useCallback(async () => {
    if (!roleToDelete) return;

    try {
      await deleteRole({ path: { communityId, roleId: roleToDelete.id } });
      setDeleteConfirmOpen(false);
      setRoleToDelete(null);
    } catch {
      // Error handled by mutation
    }
  }, [roleToDelete, deleteRole, communityId]);

  const handleResetDefaults = useCallback(async () => {
    try {
      await resetDefaults({ path: { communityId } });
      setResetConfirmOpen(false);
    } catch {
      // Error handled by mutation
    }
  }, [communityId, resetDefaults]);

  const handleMoveRole = useCallback(async (roleId: string, direction: "up" | "down") => {
    if (!communityRoles) return;
    const roles = communityRoles.roles;
    const currentIndex = roles.findIndex((r) => r.id === roleId);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= roles.length) return;

    // Don't allow swapping with the Member default role
    const targetRole = roles[targetIndex];
    if (targetRole.isDefault && targetRole.name === "Member") return;

    // Build new order (excluding Member role)
    const reorderedIds = roles
      .filter((r) => !(r.isDefault && r.name === "Member"))
      .map((r) => r.id);

    const fromIdx = reorderedIds.indexOf(roleId);
    const swapIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
    if (swapIdx < 0 || swapIdx >= reorderedIds.length) return;

    // Swap
    [reorderedIds[fromIdx], reorderedIds[swapIdx]] = [reorderedIds[swapIdx], reorderedIds[fromIdx]];

    try {
      await reorderRoles({
        path: { communityId },
        body: { roleIds: reorderedIds },
      });
    } catch {
      // Error handled by mutation
    }
  }, [communityRoles, communityId, reorderRoles]);

  const handleCancelEdit = useCallback(() => {
    setCreatingRole(false);
    setEditingRole(null);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setDeleteConfirmOpen(false);
  }, []);

  const handleOpenDeleteDialog = useCallback((role: RoleDto) => {
    setRoleToDelete(role);
    setDeleteConfirmOpen(true);
  }, []);

  const handleCloseUsersDialog = useCallback(() => {
    setViewingRoleUsers(null);
  }, []);


  if (!canReadRoles) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Role Management
          </Typography>
          <Alert severity="info">
            You don't have permission to view roles in this community.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (creatingRole || editingRole) {
    return (
      <RoleEditor
        role={editingRole || undefined}
        onSave={editingRole ? handleUpdateRole : handleCreateRole}
        onCancel={handleCancelEdit}
        isLoading={creatingRoleLoading || updatingRoleLoading}
        error={
          createRoleError
            ? `Failed to create role: ${(createRoleError as { data?: { message?: string } })?.data?.message || 'Unknown error'}`
            : updateRoleError
            ? `Failed to update role: ${(updateRoleError as { data?: { message?: string } })?.data?.message || 'Unknown error'}`
            : undefined
        }
      />
    );
  }

  if (loadingRoles) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (rolesError) {
    return (
      <Alert severity="error">
        Failed to load roles. Please try again.
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6">
              Role Management
            </Typography>
            <Box display="flex" gap={1}>
              {canUpdateRoles && (
                <Button
                  variant="outlined"
                  startIcon={<RestartAltIcon />}
                  onClick={() => setResetConfirmOpen(true)}
                >
                  Reset Defaults
                </Button>
              )}
              {canCreateRoles && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreatingRole(true)}
                >
                  Create Role
                </Button>
              )}
            </Box>
          </Box>

          {communityRoles && communityRoles.roles.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    {canUpdateRoles && <TableCell sx={{ width: 80 }}>Order</TableCell>}
                    <TableCell>Role Name</TableCell>
                    <TableCell>Permissions</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {communityRoles.roles.map((role, index) => {
                    const isMemberRole = role.isDefault && role.name === "Member";
                    const isFirst = index === 0;
                    const isLastBeforeMember = index === communityRoles.roles.length - 2 && communityRoles.roles[communityRoles.roles.length - 1]?.isDefault && communityRoles.roles[communityRoles.roles.length - 1]?.name === "Member";
                    const isLast = index === communityRoles.roles.length - 1;

                    return (
                    <TableRow key={role.id}>
                      {canUpdateRoles && (
                        <TableCell>
                          {!isMemberRole && (
                            <Box display="flex" gap={0}>
                              <IconButton
                                size="small"
                                disabled={isFirst}
                                onClick={() => handleMoveRole(role.id, "up")}
                                aria-label={`Move ${role.name} up`}
                              >
                                <ArrowUpIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                disabled={isLastBeforeMember || (isLast && !isMemberRole && communityRoles.roles.length === 1)}
                                onClick={() => handleMoveRole(role.id, "down")}
                                aria-label={`Move ${role.name} down`}
                              >
                                <ArrowDownIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <SecurityIcon color="action" fontSize="small" />
                          <Typography variant="body2" fontWeight="medium">
                            {role.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          {role.actions.slice(0, 3).map((action) => (
                            <Chip
                              key={action}
                              label={ACTION_LABELS[action] || action}
                              size="small"
                              variant="outlined"
                            />
                          ))}
                          {role.actions.length > 3 && (
                            <Chip
                              label={`+${role.actions.length - 3} more`}
                              size="small"
                              variant="outlined"
                              color="primary"
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={role.isDefault ? "Default" : "Custom"}
                          size="small"
                          color={role.isDefault ? "default" : "primary"}
                          variant={role.isDefault ? "filled" : "outlined"}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(role.createdAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Box display="flex" gap={0.5}>
                          <Tooltip title="View assigned users">
                            <IconButton
                              size="small"
                              onClick={() => setViewingRoleUsers(role.id)}
                            >
                              <PeopleIcon />
                            </IconButton>
                          </Tooltip>
                          
                          {canUpdateRoles && (
                            <Tooltip title="Edit role">
                              <IconButton
                                size="small"
                                onClick={() => setEditingRole(role)}
                              >
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                          
                          {canDeleteRoles && !role.isDefault && (
                            <Tooltip title="Delete role">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleOpenDeleteDialog(role)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                    );
                  })}
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
              <SecurityIcon sx={{ fontSize: 'icon.5xl', color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No custom roles yet
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center" mb={3}>
                Create custom roles to manage member permissions more granularly.
                Default roles (Admin, Moderator, Member) are created automatically.
              </Typography>
              {canCreateRoles && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreatingRole(true)}
                >
                  Create Your First Role
                </Button>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Role"
        description={<>Are you sure you want to delete the role <strong>{roleToDelete?.name}</strong>? This action cannot be undone and will remove the role from all users who have it assigned.</>}
        confirmLabel="Delete Role"
        confirmColor="error"
        isLoading={deletingRoleLoading}
        onConfirm={handleDeleteRole}
        onCancel={handleCloseDeleteDialog}
      />

      <ConfirmDialog
        open={resetConfirmOpen}
        title="Reset Default Roles"
        description="This will restore the default roles (Community Admin, Moderator, Member) to their original permissions. Missing default roles will be recreated. Custom roles and user assignments will not be affected."
        confirmLabel="Reset Defaults"
        confirmColor="primary"
        isLoading={resettingDefaults}
        onConfirm={handleResetDefaults}
        onCancel={() => setResetConfirmOpen(false)}
      />

      {/* Role Users Dialog */}
      <ResponsiveDialog
        open={Boolean(viewingRoleUsers)}
        onClose={handleCloseUsersDialog}
        maxWidth="md"
        fullWidth
        title={`Role Members: ${communityRoles?.roles.find(r => r.id === viewingRoleUsers)?.name ?? ""}`}
      >
        <DialogContent>
          {loadingRoleUsers ? (
            <Box display="flex" justifyContent="center" p={2}>
              <CircularProgress />
            </Box>
          ) : roleUsers && roleUsers.length > 0 ? (
            <Box>
              {roleUsers.map((user) => (
                <Box
                  key={user.userId}
                  display="flex"
                  alignItems="center"
                  gap={2}
                  p={2}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    mb: 1,
                  }}
                >
                  <Typography variant="body1">{user.username}</Typography>
                  {user.displayName && (
                    <Typography variant="body2" color="text.secondary">
                      ({user.displayName})
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary">
              No users are currently assigned to this role.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUsersDialog}>
            Close
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
};

export default RoleManagement;
