import React, { useMemo, useState } from "react";
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
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Delete as DeleteIcon, PersonAdd as PersonAddIcon, Settings as SettingsIcon } from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  membershipControllerCreateMutation,
  membershipControllerRemoveMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { useAllCommunityMembers } from "../../hooks/useAllCommunityMembers";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { userControllerFindAllUsersOptions } from "../../api-client/@tanstack/react-query.gen";
import type { UserControllerFindAllUsersData } from "../../api-client/types.gen";
import UserAvatar from "../Common/UserAvatar";
import RoleAssignmentDialog from "./RoleAssignmentDialog";
import ConfirmDialog from "../Common/ConfirmDialog";
import { invalidateMemberQueries } from "../../utils/queryInvalidation";
import { logger } from "../../utils/logger";

/** From this card width (the wide community settings column) each row shows when the member joined. */
const MEMBERS_JOINED_MIN_PX = 800;

const formatJoined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

interface MemberManagementProps {
  communityId: string;
}

const MemberManagement: React.FC<MemberManagementProps> = ({ communityId }) => {
  const theme = useTheme();
  const usersPerPage = 10;
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{id: string, name: string} | null>(null);
  const [roleAssignmentOpen, setRoleAssignmentOpen] = useState(false);
  const [userForRoleAssignment, setUserForRoleAssignment] = useState<{id: string, name: string} | null>(null);

  const queryClient = useQueryClient();

  const {
    data: members,
    isLoading: loadingMembers,
    error: membersError,
  } = useAllCommunityMembers(communityId);

  const {
    data: usersData,
    isLoading: loadingUsers,
    error: usersError,
  } = useQuery(
    userControllerFindAllUsersOptions({
      // The generated spec marks `continuationToken` as required, but the backend
      // controller treats it as an optional query param (first page when omitted).
      query: { limit: usersPerPage } as UserControllerFindAllUsersData['query'],
    }),
  );

  const { mutateAsync: createMembership, isPending: addingMember } = useMutation({
    ...membershipControllerCreateMutation(),
    onSuccess: () => invalidateMemberQueries(queryClient),
  });
  const { mutateAsync: removeMembership, isPending: removingMember } = useMutation({
    ...membershipControllerRemoveMutation(),
    onSuccess: () => invalidateMemberQueries(queryClient),
  });

  const { hasPermissions: canCreateMembers } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["CREATE_MEMBER"],
  });

  const { hasPermissions: canDeleteMembers } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["DELETE_MEMBER"],
  });

  const { hasPermissions: canManageRoles } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["UPDATE_MEMBER"],
  });

  const memberUserIds = useMemo(() => new Set(members?.map(member => member.userId || null) || []), [members]);

  const handleAddMember = async (userId: string) => {
    try {
      await createMembership({
        body: { userId, communityId },
      });
    } catch (error) {
      logger.error("Failed to add member:", error);
    }
  };

  const handleRemoveMember = (userId: string, username: string) => {
    setUserToRemove({ id: userId, name: username });
    setConfirmRemoveOpen(true);
  };

  const confirmRemoveMember = async () => {
    if (!userToRemove) return;

    try {
      await removeMembership({ path: { userId: userToRemove.id, communityId } });
    } catch (error) {
      logger.error("Failed to remove member:", error);
    } finally {
      setConfirmRemoveOpen(false);
      setUserToRemove(null);
    }
  };

  const cancelRemoveMember = () => {
    setConfirmRemoveOpen(false);
    setUserToRemove(null);
  };

  const handleManageRoles = (userId: string, username: string) => {
    setUserForRoleAssignment({ id: userId, name: username });
    setRoleAssignmentOpen(true);
  };

  const handleCloseRoleAssignment = () => {
    setRoleAssignmentOpen(false);
    setUserForRoleAssignment(null);
  };

  if (loadingMembers) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (membersError) {
    return (
      <Alert severity="error">
        Failed to load members. Please try again.
      </Alert>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/* Current Members Section (a size container: wide tables show "Joined") */}
      <Card sx={{ containerType: "inline-size", containerName: "members" }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Current Members ({members?.length || 0})
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          {members && members.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={1}>
              {members.map((member) => (
                <Box
                  key={member.id}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  p={2}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    "&:hover": {
                      bgcolor: theme.palette.semantic.overlay.light,
                    },
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <UserAvatar userId={member.userId} size="medium" />
                    <Box>
                      <Typography variant="body1" fontWeight="medium">
                        {member.user?.username}
                      </Typography>
                      {member.user?.displayName && (
                        <Typography 
                          variant="body2" 
                          color="text.secondary"
                          sx={{ mt: -0.5 }}
                        >
                          {member.user.displayName}
                        </Typography>
                      )}
                    </Box>
                    <Chip 
                      label="Member" 
                      size="small" 
                      variant="outlined"
                      color="primary"
                    />
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    {member.joinedAt && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        data-testid="member-joined"
                        sx={{
                          display: "none",
                          mr: 2,
                          whiteSpace: "nowrap",
                          [`@container members (min-width: ${MEMBERS_JOINED_MIN_PX}px)`]: { display: "block" },
                        }}
                      >
                        Joined {formatJoined(member.joinedAt)}
                      </Typography>
                    )}
                    {canManageRoles && (
                      <IconButton
                        color="primary"
                        onClick={() => handleManageRoles(member.userId, member.user?.username || 'Unknown User')}
                        sx={{ ml: 1 }}
                        title="Manage roles"
                      >
                        <SettingsIcon />
                      </IconButton>
                    )}
                    {canDeleteMembers && (
                      <IconButton
                        color="error"
                        onClick={() => handleRemoveMember(member.userId, member.user?.username || 'Unknown User')}
                        disabled={removingMember}
                        sx={{ ml: 1 }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          ) : (
            <Box 
              display="flex" 
              justifyContent="center" 
              alignItems="center" 
              py={4}
            >
              <Typography variant="body2" color="text.secondary">
                No members yet
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Add Members Section */}
      {canCreateMembers && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Add New Members
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            {loadingUsers ? (
              <Box display="flex" justifyContent="center" p={2}>
                <CircularProgress />
              </Box>
            ) : usersError ? (
              <Alert severity="error">
                Failed to load users. Please try again.
              </Alert>
            ) : (
              <>
                <Box display="flex" flexDirection="column" gap={1}>
                  {usersData?.users?.map((user) => {
                    const isAlreadyMember = memberUserIds.has(user.id);
                    
                    return (
                      <Box
                        key={user.id}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        p={2}
                        sx={{
                          border: 1,
                          borderColor: "divider",
                          borderRadius: 1,
                          opacity: isAlreadyMember ? 0.5 : 1,
                          "&:hover": !isAlreadyMember ? {
                            bgcolor: theme.palette.semantic.overlay.light,
                          } : {},
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={2}>
                          <UserAvatar userId={user.id} size="medium" />
                          <Box>
                            <Typography 
                              variant="body1" 
                              fontWeight="medium"
                              color={isAlreadyMember ? "text.secondary" : "text.primary"}
                            >
                              {user.username}
                            </Typography>
                            {user.displayName && (
                              <Typography 
                                variant="body2" 
                                color="text.secondary"
                                sx={{ mt: -0.5 }}
                              >
                                {user.displayName}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                        {isAlreadyMember ? (
                          <Button
                            variant="outlined"
                            size="small"
                            disabled
                            sx={{ 
                              color: 'text.secondary',
                              borderColor: 'text.disabled'
                            }}
                          >
                            Already Member
                          </Button>
                        ) : (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<PersonAddIcon />}
                            onClick={() => handleAddMember(user.id)}
                            disabled={addingMember}
                          >
                            {addingMember ? <CircularProgress size={16} /> : "Add"}
                          </Button>
                        )}
                      </Box>
                    );
                  })}
                </Box>
                
                {usersData?.users && usersData.users.length === 0 && (
                  <Box 
                    display="flex" 
                    justifyContent="center" 
                    alignItems="center" 
                    py={4}
                  >
                    <Typography variant="body2" color="text.secondary">
                      No users found
                    </Typography>
                  </Box>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmRemoveOpen}
        title="Remove Member"
        description={<>Are you sure you want to remove <strong>{userToRemove?.name}</strong> from this community? This action cannot be undone.</>}
        confirmLabel="Remove Member"
        confirmColor="error"
        isLoading={removingMember}
        onConfirm={confirmRemoveMember}
        onCancel={cancelRemoveMember}
      />

      {/* Role Assignment Dialog */}
      {userForRoleAssignment && (
        <RoleAssignmentDialog
          open={roleAssignmentOpen}
          onClose={handleCloseRoleAssignment}
          communityId={communityId}
          userId={userForRoleAssignment.id}
          userName={userForRoleAssignment.name}
        />
      )}
    </Box>
  );
};

export default MemberManagement;
