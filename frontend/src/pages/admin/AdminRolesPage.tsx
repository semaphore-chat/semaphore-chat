import React, { useState } from "react";
import { logger } from "../../utils/logger";
import {
  Box,
  Typography,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Snackbar,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Person as PersonIcon,
  PersonRemove as PersonRemoveIcon,
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rolesControllerGetInstanceRolesOptions,
  rolesControllerCreateInstanceRoleMutation,
  rolesControllerUpdateInstanceRoleMutation,
  rolesControllerDeleteInstanceRoleMutation,
  rolesControllerGetInstanceRoleUsersOptions,
  rolesControllerRemoveInstanceRoleMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { invalidateInstanceRoleQueries } from "../../utils/queryInvalidation";
import ConfirmDialog from "../../components/Common/ConfirmDialog";

import type { RoleDto as InstanceRole } from "../../api-client/types.gen";

// All valid instance-level actions (must match backend)
type InstanceAction = InstanceRole["actions"][number];

const INSTANCE_ACTIONS: { key: InstanceAction; label: string; category: string }[] = [
  { key: "READ_INSTANCE_SETTINGS", label: "View Instance Settings", category: "Settings" },
  { key: "UPDATE_INSTANCE_SETTINGS", label: "Update Instance Settings", category: "Settings" },
  { key: "READ_INSTANCE_STATS", label: "View Instance Statistics", category: "Settings" },
  { key: "MANAGE_USER_STORAGE", label: "Manage User Storage", category: "Storage" },
  { key: "READ_USER", label: "View Users", category: "Users" },
  { key: "UPDATE_USER", label: "Update Users", category: "Users" },
  { key: "BAN_USER", label: "Ban Users", category: "Users" },
  { key: "DELETE_USER", label: "Delete Users", category: "Users" },
  { key: "READ_INSTANCE_INVITE", label: "View Instance Invites", category: "Invites" },
  { key: "CREATE_INSTANCE_INVITE", label: "Create Instance Invites", category: "Invites" },
  { key: "DELETE_INSTANCE_INVITE", label: "Delete Instance Invites", category: "Invites" },
  { key: "UPDATE_INSTANCE_INVITE", label: "Update Instance Invites", category: "Invites" },
];

const ACTION_CATEGORIES = ["Settings", "Storage", "Users", "Invites"];

interface RoleFormData {
  name: string;
  actions: InstanceAction[];
}

const AdminRolesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: roles, isLoading, error, refetch } = useQuery(rolesControllerGetInstanceRolesOptions());
  const { mutateAsync: createRole } = useMutation({
    ...rolesControllerCreateInstanceRoleMutation(),
    onSuccess: () => invalidateInstanceRoleQueries(queryClient),
  });
  const { mutateAsync: updateRole } = useMutation({
    ...rolesControllerUpdateInstanceRoleMutation(),
    onSuccess: () => invalidateInstanceRoleQueries(queryClient),
  });
  const { mutateAsync: deleteRole } = useMutation({
    ...rolesControllerDeleteInstanceRoleMutation(),
    onSuccess: () => invalidateInstanceRoleQueries(queryClient),
  });

  const [expandedRole, setExpandedRole] = useState<string | false>(false);
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<InstanceRole | null>(null);
  const [formData, setFormData] = useState<RoleFormData>({ name: "", actions: [] });
  const [deleteConfirm, setDeleteConfirm] = useState<InstanceRole | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const handleAccordionChange = (roleId: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedRole(isExpanded ? roleId : false);
  };

  const openCreateDialog = () => {
    setEditingRole(null);
    setFormData({ name: "", actions: [] });
    setRoleFormOpen(true);
  };

  const openEditDialog = (role: InstanceRole) => {
    setEditingRole(role);
    setFormData({ name: role.name, actions: [...role.actions] });
    setRoleFormOpen(true);
  };

  const closeDialog = () => {
    setRoleFormOpen(false);
    setEditingRole(null);
    setFormData({ name: "", actions: [] });
  };

  const handleActionToggle = (action: InstanceAction) => {
    setFormData((prev) => ({
      ...prev,
      actions: prev.actions.includes(action)
        ? prev.actions.filter((a) => a !== action)
        : [...prev.actions, action],
    }));
  };

  const handleSelectCategory = (category: string, selected: boolean) => {
    const categoryActions = INSTANCE_ACTIONS.filter((a) => a.category === category).map((a) => a.key);
    setFormData((prev) => ({
      ...prev,
      actions: selected
        ? [...new Set([...prev.actions, ...categoryActions])]
        : prev.actions.filter((a) => !categoryActions.includes(a)),
    }));
  };

  const handleSaveRole = async () => {
    try {
      if (editingRole) {
        await updateRole({
          path: { roleId: editingRole.id },
          body: { name: formData.name, actions: formData.actions },
        });
        setSnackbar({ open: true, message: "Role updated successfully", severity: "success" });
      } else {
        await createRole({ body: { name: formData.name, actions: formData.actions } });
        setSnackbar({ open: true, message: "Role created successfully", severity: "success" });
      }
      closeDialog();
      refetch();
    } catch {
      setSnackbar({
        open: true,
        message: `Failed to ${editingRole ? "update" : "create"} role`,
        severity: "error",
      });
    }
  };

  const handleDeleteRole = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteRole({ path: { roleId: deleteConfirm.id } });
      setSnackbar({ open: true, message: "Role deleted successfully", severity: "success" });
      setDeleteConfirm(null);
      refetch();
    } catch {
      setSnackbar({ open: true, message: "Failed to delete role", severity: "error" });
    }
  };

  const isDefaultRole = (role: InstanceRole) => role.name === "Instance Admin";

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Failed to load instance roles. Please check your permissions.
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Instance Roles</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
          Create Role
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" mb={3}>
        Manage instance-level roles that can be assigned to users. These roles grant administrative
        permissions across the entire instance.
      </Typography>

      {roles?.length === 0 ? (
        <Alert severity="info">
          No instance roles found. Create a role to delegate admin permissions to users.
        </Alert>
      ) : (
        roles?.map((role) => (
          <Accordion
            key={role.id}
            expanded={expandedRole === role.id}
            onChange={handleAccordionChange(role.id)}
            sx={{ mb: 1 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box display="flex" alignItems="center" gap={2} flex={1}>
                <Typography variant="subtitle1" fontWeight="medium">
                  {role.name}
                </Typography>
                {isDefaultRole(role) && (
                  <Chip label="Default" size="small" color="primary" variant="outlined" />
                )}
                <Chip
                  label={`${role.actions.length} permissions`}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Box display="flex" gap={1} mr={2}>
                <Tooltip title="Edit Role">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditDialog(role);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {!isDefaultRole(role) && (
                  <Tooltip title="Delete Role">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(role);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Box mb={2}>
                <Typography variant="subtitle2" gutterBottom>
                  Permissions:
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={0.5}>
                  {role.actions.map((action) => {
                    const actionInfo = INSTANCE_ACTIONS.find((a) => a.key === action);
                    return (
                      <Chip
                        key={action}
                        label={actionInfo?.label || action}
                        size="small"
                        variant="outlined"
                      />
                    );
                  })}
                </Box>
              </Box>
              <RoleUsers roleId={role.id} onRemoveUser={refetch} />
            </AccordionDetails>
          </Accordion>
        ))
      )}

      {/* Create/Edit Role Dialog */}
      <Dialog open={roleFormOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRole ? "Edit Role" : "Create Instance Role"}</DialogTitle>
        <DialogContent>
          <TextField
            // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
            autoFocus
            margin="dense"
            label="Role Name"
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            disabled={!!editingRole && isDefaultRole(editingRole)}
            sx={{ mb: 3 }}
          />
          <Typography variant="subtitle2" gutterBottom>
            Permissions:
          </Typography>
          {ACTION_CATEGORIES.map((category) => {
            const categoryActions = INSTANCE_ACTIONS.filter((a) => a.category === category);
            const selectedCount = categoryActions.filter((a) => formData.actions.includes(a.key)).length;
            const allSelected = selectedCount === categoryActions.length;
            const someSelected = selectedCount > 0 && !allSelected;

            return (
              <Box key={category} mb={2}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={(e) => handleSelectCategory(category, e.target.checked)}
                    />
                  }
                  label={<Typography fontWeight="medium">{category}</Typography>}
                />
                <Box pl={4}>
                  <FormGroup>
                    {categoryActions.map((action) => (
                      <FormControlLabel
                        key={action.key}
                        control={
                          <Checkbox
                            checked={formData.actions.includes(action.key)}
                            onChange={() => handleActionToggle(action.key)}
                            size="small"
                          />
                        }
                        label={action.label}
                      />
                    ))}
                  </FormGroup>
                </Box>
              </Box>
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            onClick={handleSaveRole}
            variant="contained"
            disabled={!formData.name.trim() || formData.actions.length === 0}
          >
            {editingRole ? "Save Changes" : "Create Role"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete Role"
        description={`Are you sure you want to delete the role "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDeleteRole}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

// Sub-component to display users assigned to a role
const RoleUsers: React.FC<{ roleId: string; onRemoveUser: () => void }> = ({
  roleId,
  onRemoveUser,
}) => {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery(rolesControllerGetInstanceRoleUsersOptions({ path: { roleId } }));
  const { mutateAsync: removeUser } = useMutation({
    ...rolesControllerRemoveInstanceRoleMutation(),
    onSuccess: () => invalidateInstanceRoleQueries(queryClient),
  });
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemoveUser = async (userId: string) => {
    setRemoving(userId);
    try {
      await removeUser({ path: { roleId, userId } });
      onRemoveUser();
    } catch (err) {
      logger.error("Failed to remove user from role:", err);
    } finally {
      setRemoving(null);
    }
  };

  if (isLoading) {
    return <CircularProgress size={20} />;
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Assigned Users ({users?.length || 0}):
      </Typography>
      {users?.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No users assigned to this role.
        </Typography>
      ) : (
        <List dense>
          {users?.map((user) => (
            <ListItem key={user.userId}>
              <PersonIcon sx={{ mr: 1, color: "text.secondary" }} />
              <ListItemText
                primary={user.displayName || user.username}
                secondary={user.displayName ? `@${user.username}` : undefined}
              />
              <ListItemSecondaryAction>
                <Tooltip title="Remove from role">
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => handleRemoveUser(user.userId)}
                    disabled={removing === user.userId}
                  >
                    {removing === user.userId ? (
                      <CircularProgress size={20} />
                    ) : (
                      <PersonRemoveIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default AdminRolesPage;
