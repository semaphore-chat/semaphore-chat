import React from "react";
import {
  Box,
  List,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  friendsControllerGetFriendsOptions,
  friendsControllerRemoveFriendMutation,
  directMessagesControllerCreateDmGroupMutation,
} from "../../api-client/@tanstack/react-query.gen";

import FriendCard from "./FriendCard";
import EmptyState from "../Common/EmptyState";
import { logger } from "../../utils/logger";

interface FriendListProps {
  onSelectDmGroup?: (dmGroupId: string) => void;
}

const FriendList: React.FC<FriendListProps> = ({ onSelectDmGroup }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: friends = [], isLoading, error } = useQuery(friendsControllerGetFriendsOptions());
  const { mutateAsync: removeFriend } = useMutation({
    ...friendsControllerRemoveFriendMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'friendsControllerGetFriends' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'friendsControllerGetPendingRequests' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'friendsControllerGetFriendshipStatus' }] });
    },
  });
  const { mutateAsync: createDmGroup } = useMutation({
    ...directMessagesControllerCreateDmGroupMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'directMessagesControllerFindUserDmGroups' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'directMessagesControllerFindDmGroup' }] });
    },
  });

  const handleMessage = async (userId: string) => {
    try {
      // Create or get existing DM with this user
      const result = await createDmGroup({
        body: { userIds: [userId], isGroup: false },
      });

      if (onSelectDmGroup) {
        onSelectDmGroup(result.id);
      } else {
        // Navigate to DM view if no callback
        navigate(`/direct-messages?group=${result.id}`);
      }
    } catch (err) {
      logger.error("Failed to create DM:", err);
    }
  };

  const handleRemove = async (friendshipId: string) => {
    try {
      await removeFriend({ path: { id: friendshipId } });
    } catch (err) {
      logger.error("Failed to remove friend:", err);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load friends</Alert>
      </Box>
    );
  }

  if (friends.length === 0) {
    return (
      <EmptyState
        variant="dm"
        title="No friends yet"
        description="Add friends to see them here"
      />
    );
  }

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ px: 2, py: 1, display: "block", textTransform: "uppercase" }}
      >
        All Friends - {friends.length}
      </Typography>
      <List>
        {friends.map((friend) => (
          <FriendCard
            key={friend.id}
            friend={friend}
            friendshipId={friend.friendshipId}
            onMessage={handleMessage}
            onRemove={handleRemove}
          />
        ))}
      </List>
    </Box>
  );
};

export default FriendList;
