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
  Chip,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
} from "@mui/material";
import {
  Search as SearchIcon,
  MoreVert as MoreIcon,
  Block as BanIcon,
  CheckCircle as UnbanIcon,
  Delete as DeleteIcon,
  Star as OwnerIcon,
  Person as UserIcon,
  Security as RolesIcon,
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  userControllerFindAllUsersAdminOptions,
  userControllerUpdateUserRoleMutation,
  userControllerSetBanStatusMutation,
  userControllerDeleteUserMutation,
  rolesControllerGetInstanceRolesOptions,
  rolesControllerAssignInstanceRoleMutation,
  rolesControllerRemoveInstanceRoleMutation,
  rolesControllerGetInstanceRoleUsersOptions,
} from "../../api-client/@tanstack/react-query.gen";

import type { AdminUserEntity as AdminUser, RoleDto as InstanceRole } from "../../api-client/types.gen";
import UserAvatar from "../../components/Common/UserAvatar";
import ConfirmDialog from "../../components/Common/ConfirmDialog";

const AdminUsersPage: React.FC = () => {
  const [search, setSearch] = useState("");
  const [bannedFilter, setBannedFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: "ban" | "unban" | "delete" | "promote" | "demote";
    user: AdminUser | null;
  }>({ open: false, action: "ban", user: null });
  const [roleDialogUser, setRoleDialogUser] = useState<AdminUser | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery(userControllerFindAllUsersAdminOptions({
    query: {
      search: search || undefined,
      banned:
        bannedFilter === "all"
          ? undefined
          : bannedFilter === "banned"
            ? "true"
            : "false",
      role: roleFilter === "all" ? undefined : (roleFilter as "OWNER" | "USER"),
      limit: 100,
    },
  }));

  const { data: instanceRoles } = useQuery(rolesControllerGetInstanceRolesOptions());
  const { mutateAsync: updateRole } = useMutation({
    ...userControllerUpdateUserRoleMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerFindAllUsersAdmin' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetUserByIdAdmin' }] });
    },
  });
  const { mutateAsync: setBanStatus } = useMutation({
    ...userControllerSetBanStatusMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerFindAllUsersAdmin' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetUserByIdAdmin' }] });
    },
  });
  const { mutateAsync: deleteUser } = useMutation({
    ...userControllerDeleteUserMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerFindAllUsersAdmin' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetUserByIdAdmin' }] });
    },
  });
  const { mutateAsync: assignRole } = useMutation({
    ...rolesControllerAssignInstanceRoleMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetInstanceRoles' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetInstanceRoleUsers' }] });
    },
  });
  const { mutateAsync: removeRole } = useMutation({
    ...rolesControllerRemoveInstanceRoleMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetInstanceRoles' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetInstanceRoleUsers' }] });
    },
  });

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, user: AdminUser) => {
    setMenuAnchor(event.currentTarget);
    setSelectedUser(user);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setSelectedUser(null);
  };

  const handleAction = (action: typeof confirmDialog.action) => {
    if (selectedUser) {
      setConfirmDialog({ open: true, action, user: selectedUser });
    }
    handleMenuClose();
  };

  const handleConfirmAction = async () => {
    const { action, user } = confirmDialog;
    if (!user) return;

    try {
      switch (action) {
        case "ban":
          await setBanStatus({ path: { id: user.id }, body: { banned: true } });
          break;
        case "unban":
          await setBanStatus({ path: { id: user.id }, body: { banned: false } });
          break;
        case "delete":
          await deleteUser({ path: { id: user.id } });
          break;
        case "promote":
          await updateRole({ path: { id: user.id }, body: { role: "OWNER" } });
          break;
        case "demote":
          await updateRole({ path: { id: user.id }, body: { role: "USER" } });
          break;
      }
      refetch();
    } catch (error) {
      logger.error("Failed to perform action:", error);
    }

    setConfirmDialog({ open: false, action: "ban", user: null });
  };

  const getActionText = (action: typeof confirmDialog.action) => {
    switch (action) {
      case "ban":
        return "ban this user";
      case "unban":
        return "unban this user";
      case "delete":
        return "permanently delete this user";
      case "promote":
        return "promote this user to Owner";
      case "demote":
        return "demote this user to regular User";
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString();
  };

  // Instance role management handlers
  const handleOpenRoleDialog = (user: AdminUser) => {
    setRoleDialogUser(user);
    handleMenuClose();
  };

  const handleCloseRoleDialog = () => {
    setRoleDialogUser(null);
  };

  const handleToggleRole = async (roleId: string, isAssigned: boolean) => {
    if (!roleDialogUser) return;

    try {
      if (isAssigned) {
        await removeRole({ path: { roleId, userId: roleDialogUser.id } });
      } else {
        await assignRole({ path: { roleId }, body: { userId: roleDialogUser.id } });
      }
      refetch();
    } catch (error) {
      logger.error("Failed to update role:", error);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load users. Please try again.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        User Management
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage instance users, roles, and bans
      </Typography>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <TextField
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 250 }}
              size="small"
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={bannedFilter}
                label="Status"
                onChange={(e: SelectChangeEvent) => setBannedFilter(e.target.value)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="banned">Banned</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Role</InputLabel>
              <Select
                value={roleFilter}
                label="Role"
                onChange={(e: SelectChangeEvent) => setRoleFilter(e.target.value)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="OWNER">Owner</MenuItem>
                <MenuItem value="USER">User</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last Seen</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.users.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <UserAvatar user={user} size="small" />
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          {user.displayName || user.username}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          @{user.username}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={user.role === "OWNER" ? <OwnerIcon /> : <UserIcon />}
                      label={user.role}
                      size="small"
                      color={user.role === "OWNER" ? "primary" : "default"}
                      variant={user.role === "OWNER" ? "filled" : "outlined"}
                    />
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Chip label="Banned" size="small" color="error" />
                    ) : (
                      <Chip label="Active" size="small" color="success" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{formatDate(user.lastSeen)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Actions">
                      <IconButton onClick={(e) => handleMenuOpen(e, user)}>
                        <MoreIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Actions Menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        {selectedUser && !selectedUser.banned && selectedUser.role !== "OWNER" && (
          <MenuItem onClick={() => handleAction("ban")}>
            <ListItemIcon>
              <BanIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Ban User</ListItemText>
          </MenuItem>
        )}
        {selectedUser?.banned && (
          <MenuItem onClick={() => handleAction("unban")}>
            <ListItemIcon>
              <UnbanIcon fontSize="small" color="success" />
            </ListItemIcon>
            <ListItemText>Unban User</ListItemText>
          </MenuItem>
        )}
        {selectedUser?.role === "USER" && (
          <MenuItem onClick={() => handleAction("promote")}>
            <ListItemIcon>
              <OwnerIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>Promote to Owner</ListItemText>
          </MenuItem>
        )}
        {selectedUser?.role === "OWNER" && (
          <MenuItem onClick={() => handleAction("demote")}>
            <ListItemIcon>
              <UserIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Demote to User</ListItemText>
          </MenuItem>
        )}
        {selectedUser && (
          <MenuItem onClick={() => handleOpenRoleDialog(selectedUser)}>
            <ListItemIcon>
              <RolesIcon fontSize="small" color="info" />
            </ListItemIcon>
            <ListItemText>Manage Instance Roles</ListItemText>
          </MenuItem>
        )}
        {selectedUser?.role !== "OWNER" && (
          <MenuItem onClick={() => handleAction("delete")}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>Delete User</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title="Confirm Action"
        description={
          <>
            Are you sure you want to {getActionText(confirmDialog.action)}
            {confirmDialog.user && (
              <strong> {confirmDialog.user.displayName || confirmDialog.user.username}</strong>
            )}
            ?
            {confirmDialog.action === "delete" && (
              <Typography color="error" sx={{ mt: 1 }}>
                This action cannot be undone.
              </Typography>
            )}
          </>
        }
        confirmLabel="Confirm"
        confirmColor={confirmDialog.action === "delete" || confirmDialog.action === "ban" ? "error" : "primary"}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmDialog({ ...confirmDialog, open: false })}
      />

      {/* Instance Role Management Dialog */}
      <Dialog open={!!roleDialogUser} onClose={handleCloseRoleDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          Manage Instance Roles for{" "}
          {roleDialogUser?.displayName || roleDialogUser?.username}
        </DialogTitle>
        <DialogContent>
          {roleDialogUser?.role === "OWNER" && (
            <Alert severity="info" sx={{ mb: 2 }}>
              This user is an instance Owner and automatically has all permissions.
              Assigning additional roles will provide permissions if they are demoted.
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Assign instance-level roles to grant administrative permissions.
          </Typography>
          {instanceRoles?.map((role) => (
            <RoleAssignmentItem
              key={role.id}
              role={role}
              userId={roleDialogUser?.id || ""}
              onToggle={handleToggleRole}
            />
          ))}
          {!instanceRoles?.length && (
            <Typography variant="body2" color="text.secondary">
              No instance roles available. Create roles in the Roles page first.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRoleDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Sub-component to handle individual role assignment with loading state
const RoleAssignmentItem: React.FC<{
  role: InstanceRole;
  userId: string;
  onToggle: (roleId: string, isAssigned: boolean) => Promise<void>;
}> = ({ role, userId, onToggle }) => {
  const { data: roleUsers, isLoading } = useQuery(rolesControllerGetInstanceRoleUsersOptions({ path: { roleId: role.id } }));
  const [toggling, setToggling] = useState(false);

  const isAssigned = roleUsers?.some((u) => u.userId === userId) || false;

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggle(role.id, isAssigned);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        p: 1.5,
        mb: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box>
        <Typography variant="body1" fontWeight="medium">
          {role.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {role.actions.length} permission{role.actions.length !== 1 ? "s" : ""}
        </Typography>
      </Box>
      <Button
        variant={isAssigned ? "outlined" : "contained"}
        color={isAssigned ? "error" : "primary"}
        size="small"
        disabled={isLoading || toggling}
        onClick={handleToggle}
      >
        {toggling ? (
          <CircularProgress size={20} />
        ) : isAssigned ? (
          "Remove"
        ) : (
          "Assign"
        )}
      </Button>
    </Box>
  );
};

export default AdminUsersPage;
