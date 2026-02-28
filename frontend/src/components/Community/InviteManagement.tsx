import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  IconButton,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { 
  Delete as DeleteIcon, 
  Add as AddIcon, 
  ContentCopy as CopyIcon,
  Link as LinkIcon 
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  inviteControllerGetInvitesOptions,
  inviteControllerCreateInviteMutation,
  inviteControllerDeleteInviteMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { CreateInviteDto, InstanceInvite } from "../../types/invite.type";
import { copyToClipboard } from "../../utils/clipboard";
import { invalidateInviteQueries } from "../../utils/queryInvalidation";
import { getInstanceUrl } from "../../config/env";
import { logger } from "../../utils/logger";
import ConfirmDialog from "../Common/ConfirmDialog";

interface InviteManagementProps {
  communityId: string;
}

const InviteManagement: React.FC<InviteManagementProps> = ({ communityId }) => {
  const theme = useTheme();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<InstanceInvite | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  // Form state for creating invites
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);
  const [validUntil, setValidUntil] = useState<string>("");

  const queryClient = useQueryClient();

  const {
    data: invites,
    isLoading: loadingInvites,
    error: invitesError,
  } = useQuery(inviteControllerGetInvitesOptions());

  const { mutateAsync: createInvite, isPending: creatingInvite } = useMutation({
    ...inviteControllerCreateInviteMutation(),
    onSuccess: () => invalidateInviteQueries(queryClient),
  });
  const { mutateAsync: deleteInvite, isPending: deletingInvite } = useMutation({
    ...inviteControllerDeleteInviteMutation(),
    onSuccess: () => invalidateInviteQueries(queryClient),
  });

  const { hasPermissions: canCreateInvites } = useUserPermissions({
    resourceType: "INSTANCE",
    actions: ["CREATE_INSTANCE_INVITE"],
  });

  const { hasPermissions: canDeleteInvites } = useUserPermissions({
    resourceType: "INSTANCE",
    actions: ["DELETE_INSTANCE_INVITE"],
  });

  const getInviteUrl = (code: string) => {
    return `${getInstanceUrl()}/#/join/${code}`;
  };

  const handleCopyInvite = async (code: string) => {
    const inviteUrl = getInviteUrl(code);
    try {
      await copyToClipboard(inviteUrl);
      setCopiedInvite(code);
      setTimeout(() => setCopiedInvite(null), 2000);
    } catch (error) {
      logger.error("Failed to copy invite link:", error);
    }
  };

  const handleCreateInvite = async () => {
    try {
      const createInviteDto: CreateInviteDto = {
        communityIds: [communityId],
        maxUses: maxUses || undefined,
        validUntil: validUntil ? new Date(validUntil) : undefined,
      };
      
      await createInvite({ body: createInviteDto });
      setCreateDialogOpen(false);
      setMaxUses(undefined);
      setValidUntil("");
    } catch (error) {
      logger.error("Failed to create invite:", error);
    }
  };

  const handleDeleteInvite = (invite: InstanceInvite) => {
    setInviteToDelete(invite);
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteInvite = async () => {
    if (!inviteToDelete) return;

    try {
      await deleteInvite({ path: { code: inviteToDelete.code } });
    } catch (error) {
      logger.error("Failed to delete invite:", error);
    } finally {
      setConfirmDeleteOpen(false);
      setInviteToDelete(null);
    }
  };

  const cancelDeleteInvite = () => {
    setConfirmDeleteOpen(false);
    setInviteToDelete(null);
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short", 
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isInviteExpired = (invite: InstanceInvite) => {
    if (!invite.validUntil) return false;
    return new Date() > new Date(invite.validUntil);
  };

  const isInviteMaxedOut = (invite: InstanceInvite) => {
    if (!invite.maxUses) return false;
    return invite.uses >= invite.maxUses;
  };

  if (loadingInvites) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (invitesError) {
    return (
      <Alert severity="error">
        Failed to load invites. Please try again.
      </Alert>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/* Current Invites Section */}
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">
              Community Invites ({invites?.length || 0})
            </Typography>
            {canCreateInvites && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
                size="small"
              >
                Create Invite
              </Button>
            )}
          </Box>
          <Divider sx={{ mb: 2 }} />
          
          {invites && invites.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={1}>
              {invites.map((invite) => {
                const expired = isInviteExpired(invite);
                const maxedOut = isInviteMaxedOut(invite);
                const disabled = invite.disabled || expired || maxedOut;
                
                return (
                  <Box
                    key={invite.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={2}
                    sx={{
                      border: 1,
                      borderColor: disabled ? "error.main" : "divider",
                      borderRadius: 1,
                      bgcolor: disabled ? alpha("#f44336", 0.05) : "transparent",
                      "&:hover": {
                        bgcolor: disabled ? alpha("#f44336", 0.1) : theme.palette.semantic.overlay.light,
                      },
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={2} flex={1}>
                      <LinkIcon color={disabled ? "error" : "primary"} />
                      <Box flex={1}>
                        <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                          <Typography 
                            variant="body2" 
                            fontFamily="monospace"
                            fontWeight="medium"
                            color={disabled ? "error.main" : "text.primary"}
                          >
                            {invite.code}
                          </Typography>
                          <Tooltip title={copiedInvite === invite.code ? "Copied!" : "Copy invite link"}>
                            <IconButton
                              size="small"
                              onClick={() => handleCopyInvite(invite.code)}
                              disabled={disabled}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="caption" color="text.secondary">
                            Uses: {invite.uses}{invite.maxUses && `/${invite.maxUses}`}
                          </Typography>
                          {invite.validUntil && (
                            <Typography variant="caption" color="text.secondary">
                              Expires: {formatDate(invite.validUntil)}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            Created: {formatDate(invite.createdAt)}
                          </Typography>
                        </Box>
                      </Box>
                      <Box display="flex" gap={1}>
                        {disabled && (
                          <Chip 
                            label={
                              expired ? "Expired" : 
                              maxedOut ? "Max Uses Reached" : 
                              "Disabled"
                            }
                            size="small" 
                            color="error"
                            variant="outlined"
                          />
                        )}
                        {!disabled && (
                          <Chip 
                            label="Active" 
                            size="small" 
                            color="success"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    </Box>
                    {canDeleteInvites && (
                      <IconButton
                        color="error"
                        onClick={() => handleDeleteInvite(invite)}
                        disabled={deletingInvite}
                        sx={{ ml: 1 }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box 
              display="flex" 
              justifyContent="center" 
              alignItems="center" 
              py={4}
            >
              <Typography variant="body2" color="text.secondary">
                No invites created yet
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Create Invite Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Community Invite</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 3 }}>
            Create a new invite link for users to join this community.
          </DialogContentText>
          
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Max Uses"
              type="number"
              value={maxUses || ""}
              onChange={(e) => setMaxUses(e.target.value ? parseInt(e.target.value) : undefined)}
              helperText="Leave empty for unlimited uses"
              fullWidth
              inputProps={{ min: 1 }}
            />
            
            <TextField
              label="Expires At"
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              helperText="Leave empty for no expiration"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateInvite}
            variant="contained" 
            disabled={creatingInvite}
          >
            {creatingInvite ? <CircularProgress size={20} /> : "Create Invite"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Invite"
        description={
          <DialogContentText>
            Are you sure you want to delete the invite <strong>{inviteToDelete?.code}</strong>?
            This action cannot be undone and the invite link will no longer work.
          </DialogContentText>
        }
        confirmLabel="Delete Invite"
        confirmColor="error"
        isLoading={deletingInvite}
        onConfirm={confirmDeleteInvite}
        onCancel={cancelDeleteInvite}
      />
    </Box>
  );
};

export default InviteManagement;