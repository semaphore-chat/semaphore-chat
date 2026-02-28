import React, { useState, useEffect } from "react";
import { logger } from "../utils/logger";
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Grid,
  alpha,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Checkbox,
  FormControlLabel,
  FormGroup,
  FormLabel,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Link as LinkIcon,
  FilterList as FilterIcon,
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  inviteControllerGetInvitesOptions,
  inviteControllerCreateInviteMutation,
  inviteControllerDeleteInviteMutation,
  communityControllerFindAllMineOptions,
} from "../api-client/@tanstack/react-query.gen";

import ConfirmDialog from "../components/Common/ConfirmDialog";
import { copyToClipboard } from "../utils/clipboard";
import { getInstanceUrl } from "../config/env";
import { invalidateInviteQueries } from "../utils/queryInvalidation";
import { useUserPermissions } from "../features/roles/useUserPermissions";
import { CreateInviteDto, InstanceInvite } from "../types/invite.type";

interface InviteFilters {
  status: 'all' | 'active' | 'expired' | 'disabled';
  usage: 'all' | 'unused' | 'partial' | 'exhausted';
}

const AdminInvitePage: React.FC = () => {
  const theme = useTheme();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<InstanceInvite | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);
  const [filters, setFilters] = useState<InviteFilters>({ status: 'all', usage: 'all' });

  // Form state for creating invites
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);
  const [validUntil, setValidUntil] = useState<string>("");
  const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);

  const queryClient = useQueryClient();

  const {
    data: invites = [],
    isLoading: loadingInvites,
    error: invitesError,
    refetch,
  } = useQuery(inviteControllerGetInvitesOptions());

  const {
    data: communities = [],
    isLoading: loadingCommunities,
  } = useQuery(communityControllerFindAllMineOptions());

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

  // Auto-select communities when dialog opens
  useEffect(() => {
    if (createDialogOpen && communities.length > 0 && selectedCommunities.length === 0) {
      // Auto-select the "default" community if it exists, otherwise select all communities
      const defaultCommunity = communities.find(c => c.name.toLowerCase() === 'default');
      if (defaultCommunity) {
        setSelectedCommunities([defaultCommunity.id]);
      } else {
        // If no default community, select all communities (assuming user wants to be inclusive)
        setSelectedCommunities(communities.map(c => c.id));
      }
    }
  }, [createDialogOpen, communities, selectedCommunities.length]);

  const { hasPermissions: canViewInvites } = useUserPermissions({
    resourceType: "INSTANCE", 
    actions: ["READ_INSTANCE_INVITE"],
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
        communityIds: selectedCommunities.length > 0 ? selectedCommunities : [],
        maxUses: maxUses || undefined,
        validUntil: validUntil ? new Date(validUntil) : undefined,
      };
      
      const newInvite = await createInvite({ body: createInviteDto });
      
      // Auto-copy the new invite link
      await handleCopyInvite(newInvite.code);
      
      setCreateDialogOpen(false);
      setMaxUses(undefined);
      setValidUntil("");
      setSelectedCommunities([]);
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

  const isInviteExhausted = (invite: InstanceInvite) => {
    if (!invite.maxUses) return false;
    return invite.uses >= invite.maxUses;
  };

  const getInviteStatus = (invite: InstanceInvite) => {
    if (invite.disabled) return 'disabled';
    if (isInviteExpired(invite)) return 'expired';
    if (isInviteExhausted(invite)) return 'exhausted';
    return 'active';
  };

  const getUsageStatus = (invite: InstanceInvite) => {
    if (invite.uses === 0) return 'unused';
    if (invite.maxUses && invite.uses >= invite.maxUses) return 'exhausted';
    return 'partial';
  };

  const filteredInvites = invites.filter(invite => {
    const status = getInviteStatus(invite);
    const usage = getUsageStatus(invite);
    
    if (filters.status !== 'all' && status !== filters.status && 
        !(filters.status === 'active' && status === 'active')) return false;
    if (filters.usage !== 'all' && usage !== filters.usage) return false;
    
    return true;
  });

  const handleFilterChange = (type: keyof InviteFilters) => (event: SelectChangeEvent) => {
    setFilters(prev => ({ ...prev, [type]: event.target.value }));
  };

  const handleCommunityToggle = (communityId: string) => {
    setSelectedCommunities(prev => 
      prev.includes(communityId)
        ? prev.filter(id => id !== communityId)
        : [...prev, communityId]
    );
  };

  // Calculate stats
  const stats = {
    total: invites.length,
    active: invites.filter(i => getInviteStatus(i) === 'active').length,
    expired: invites.filter(i => getInviteStatus(i) === 'expired').length,
    totalUses: invites.reduce((sum, i) => sum + i.uses, 0),
  };

  if (!canViewInvites) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">
          You don't have permission to view instance invites.
        </Alert>
      </Container>
    );
  }

  if (loadingInvites) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (invitesError) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" action={
          <Button onClick={() => refetch()}>Retry</Button>
        }>
          Failed to load invites. Please try again.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box mb={4}>
        <Typography variant="h4" gutterBottom>
          Instance Invites
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Manage invitation codes that allow new users to register and join your Kraken instance.
        </Typography>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary">{stats.total}</Typography>
            <Typography variant="body2" color="text.secondary">Total Invites</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main">{stats.active}</Typography>
            <Typography variant="body2" color="text.secondary">Active Invites</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="error.main">{stats.expired}</Typography>
            <Typography variant="body2" color="text.secondary">Expired</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="info.main">{stats.totalUses}</Typography>
            <Typography variant="body2" color="text.secondary">Total Uses</Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Main Content Card */}
      <Card>
        <CardContent>
          {/* Actions Bar */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <Typography variant="h6">
                Invites ({filteredInvites.length})
              </Typography>
              <FilterIcon color="action" />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Status</InputLabel>
                <Select value={filters.status} onChange={handleFilterChange('status')} label="Status">
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="expired">Expired</MenuItem>
                  <MenuItem value="disabled">Disabled</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Usage</InputLabel>
                <Select value={filters.usage} onChange={handleFilterChange('usage')} label="Usage">
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="unused">Unused</MenuItem>
                  <MenuItem value="partial">Partial</MenuItem>
                  <MenuItem value="exhausted">Exhausted</MenuItem>
                </Select>
              </FormControl>
            </Box>
            {canCreateInvites && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
              >
                Create Invite
              </Button>
            )}
          </Box>
          
          <Divider sx={{ mb: 2 }} />
          
          {/* Invites List */}
          {filteredInvites.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={1}>
              {filteredInvites.map((invite) => {
                const status = getInviteStatus(invite);
                const isDisabled = status !== 'active';
                
                return (
                  <Box
                    key={invite.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={2}
                    sx={{
                      border: 1,
                      borderColor: isDisabled ? "error.main" : "divider",
                      borderRadius: 1,
                      bgcolor: isDisabled ? alpha("#f44336", 0.05) : "transparent",
                      "&:hover": {
                        bgcolor: isDisabled ? alpha("#f44336", 0.1) : theme.palette.semantic.overlay.light,
                      },
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={2} flex={1}>
                      <LinkIcon color={isDisabled ? "error" : "primary"} />
                      <Box flex={1}>
                        <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                          <Typography 
                            variant="body2" 
                            fontFamily="monospace"
                            fontWeight="medium"
                            color={isDisabled ? "error.main" : "text.primary"}
                          >
                            {invite.code}
                          </Typography>
                          <Tooltip title={copiedInvite === invite.code ? "Copied!" : "Copy invite link"}>
                            <IconButton
                              size="small"
                              onClick={() => handleCopyInvite(invite.code)}
                              disabled={isDisabled}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Box display="flex" gap={1} alignItems="center" flexWrap="wrap" mb={1}>
                          <Typography variant="caption" color="text.secondary">
                            Uses: {invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ' (unlimited)'}
                          </Typography>
                          {invite.validUntil && (
                            <Typography variant="caption" color="text.secondary">
                              • Expires: {formatDate(invite.validUntil)}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            • Created: {formatDate(invite.createdAt)}
                          </Typography>
                        </Box>
                        {invite.defaultCommunityId.length > 0 && (
                          <Box display="flex" gap={0.5} alignItems="center" flexWrap="wrap">
                            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                              Communities:
                            </Typography>
                            {invite.defaultCommunityId.map(id => {
                              const community = communities.find(c => c.id === id);
                              return (
                                <Chip
                                  key={id}
                                  label={community?.name || 'Unknown'}
                                  size="small"
                                  variant="outlined"
                                  sx={{ 
                                    height: 20, 
                                    fontSize: '0.7rem',
                                    bgcolor: isDisabled ? 'transparent' : 'primary.50',
                                    borderColor: isDisabled ? 'error.main' : 'primary.main',
                                    color: isDisabled ? 'error.main' : 'primary.main',
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      </Box>
                      <Box display="flex" gap={1}>
                        <Chip 
                          label={
                            status === 'active' ? 'Active' :
                            status === 'expired' ? 'Expired' :
                            status === 'exhausted' ? 'Exhausted' :
                            'Disabled'
                          }
                          size="small"
                          color={status === 'active' ? 'success' : 'error'}
                          variant="outlined"
                        />
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
          ) : invites.length === 0 ? (
            <Box 
              display="flex" 
              flexDirection="column"
              justifyContent="center" 
              alignItems="center" 
              py={6}
            >
              <LinkIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No invites created yet
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create your first invite to allow new users to join your instance.
              </Typography>
              {canCreateInvites && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create Your First Invite
                </Button>
              )}
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" py={4}>
              <Typography variant="body2" color="text.secondary">
                No invites match the selected filters
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
        <DialogTitle>Create Instance Invite</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 3 }}>
            Create a new invite link for users to join your Kraken instance.
            The invite will be automatically copied to your clipboard.
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

            {/* Community Selection */}
            <Box>
              <FormLabel component="legend" sx={{ mb: 1 }}>
                Communities to Auto-Join
              </FormLabel>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                New users will automatically join the selected communities
              </Typography>
              {loadingCommunities ? (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">Loading communities...</Typography>
                </Box>
              ) : (
                <FormGroup>
                  {communities.map((community) => (
                    <FormControlLabel
                      key={community.id}
                      control={
                        <Checkbox
                          checked={selectedCommunities.includes(community.id)}
                          onChange={() => handleCommunityToggle(community.id)}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">{community.name}</Typography>
                          {community.description && (
                            <Typography variant="caption" color="text.secondary">
                              {community.description}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  ))}
                  {communities.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      No communities available. Users will only join the instance.
                    </Typography>
                  )}
                </FormGroup>
              )}
            </Box>

            {/* Quick presets */}
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Quick presets:
              </Typography>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setMaxUses(1);
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setValidUntil(tomorrow.toISOString().slice(0, 16));
                  }}
                >
                  1 Use, 24h
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setMaxUses(10);
                    const nextWeek = new Date();
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    setValidUntil(nextWeek.toISOString().slice(0, 16));
                  }}
                >
                  10 Uses, 1 Week
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setMaxUses(undefined);
                    setValidUntil("");
                  }}
                >
                  Unlimited
                </Button>
              </Box>
            </Box>
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
          <>
            Are you sure you want to delete the invite <strong>{inviteToDelete?.code}</strong>?{" "}
            This action cannot be undone and the invite link will no longer work.
            {inviteToDelete && inviteToDelete.uses > 0 && (
              <Box component="span" sx={{ color: 'warning.main', fontWeight: 'medium' }}>
                <br /><br />This invite has been used {inviteToDelete.uses} time(s).
              </Box>
            )}
          </>
        }
        confirmLabel="Delete Invite"
        confirmColor="error"
        isLoading={deletingInvite}
        onConfirm={confirmDeleteInvite}
        onCancel={cancelDeleteInvite}
      />
    </Container>
  );
};

export default AdminInvitePage;