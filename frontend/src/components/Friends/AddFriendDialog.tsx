import React, { useState, useMemo } from "react";
import ResponsiveDialog from "../Common/ResponsiveDialog";
import {
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
  Alert,
  Chip,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  friendsControllerSendFriendRequestMutation,
  friendsControllerGetFriendsOptions,
  friendsControllerGetPendingRequestsOptions,
} from "../../api-client/@tanstack/react-query.gen";

import UserSearchAutocomplete, { UserOption } from "../Common/UserSearchAutocomplete";
import { invalidateFriendQueries } from "../../utils/queryInvalidation";

interface AddFriendDialogProps {
  open: boolean;
  onClose: () => void;
}

interface RelationshipInfo {
  label: string;
  color: "success" | "warning" | "info";
}

const FRIENDLY_409_MESSAGES: Record<string, string> = {
  "Already friends with this user": "You are already friends with this user.",
  "Friend request already sent": "You have already sent a friend request to this user.",
};

const AddFriendDialog: React.FC<AddFriendDialogProps> = ({ open, onClose }) => {
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const queryClient = useQueryClient();
  const { mutateAsync: sendFriendRequest, isPending: isSending } = useMutation({
    ...friendsControllerSendFriendRequestMutation(),
    onSuccess: () => {
      invalidateFriendQueries(queryClient);
    },
  });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: friends = [] } = useQuery({
    ...friendsControllerGetFriendsOptions(),
    enabled: open,
  });

  const { data: pendingRequests } = useQuery({
    ...friendsControllerGetPendingRequestsOptions(),
    enabled: open,
  });

  const relationshipMap = useMemo(() => {
    const map = new Map<string, RelationshipInfo>();

    for (const friend of friends) {
      map.set(friend.id, { label: "Friends", color: "success" });
    }

    if (pendingRequests) {
      for (const req of pendingRequests.sent) {
        map.set(req.userB.id, { label: "Request Sent", color: "warning" });
      }
      for (const req of pendingRequests.received) {
        map.set(req.userA.id, { label: "Request Received", color: "info" });
      }
    }

    return map;
  }, [friends, pendingRequests]);

  const handleSendRequest = async () => {
    if (!selectedUser) return;

    try {
      setError(null);
      await sendFriendRequest({ path: { userId: selectedUser.id } });
      setSuccess(true);
      setSelectedUser(null);
    } catch (err: unknown) {
      let errorMessage = "Failed to send friend request";

      if (err && typeof err === "object") {
        const errorObj = err as { statusCode?: number; message?: string };
        if (errorObj.statusCode === 409) {
          errorMessage =
            FRIENDLY_409_MESSAGES[errorObj.message ?? ""] ?? errorObj.message ?? errorMessage;
          // Invalidate caches to refresh relationship data (handles race conditions)
          invalidateFriendQueries(queryClient);
        } else if (errorObj.message) {
          errorMessage = errorObj.message;
        }
      }

      setError(errorMessage);
    }
  };

  const handleClose = () => {
    setSelectedUser(null);
    setSuccess(false);
    setError(null);
    onClose();
  };

  return (
    <ResponsiveDialog open={open} onClose={handleClose} maxWidth="sm" fullWidth title="Add Friend">
      <DialogContent>
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>
            Friend request sent!
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 2 }}>
          <UserSearchAutocomplete
            value={selectedUser}
            onChange={(value) => setSelectedUser(value as UserOption | null)}
            label="Search for a user"
            placeholder="Type to search users..."
            // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
            autoFocus
            getOptionDisabled={(user) => relationshipMap.has(user.id)}
            renderOptionExtra={(user) => {
              const info = relationshipMap.get(user.id);
              if (!info) return null;
              return <Chip label={info.label} color={info.color} size="small" />;
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSendRequest}
          disabled={!selectedUser || isSending}
          variant="contained"
        >
          {isSending ? <CircularProgress size={20} /> : "Send Friend Request"}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
};

export default AddFriendDialog;
