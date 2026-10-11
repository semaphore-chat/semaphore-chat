import React, { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  friendsControllerSendFriendRequestMutation,
  friendsControllerGetFriendsOptions,
  friendsControllerGetPendingRequestsOptions,
} from "../../api-client/@tanstack/react-query.gen";
import UserSearchAutocomplete, { UserOption } from "../Common/UserSearchAutocomplete";
import { invalidateFriendQueries } from "../../utils/queryInvalidation";

interface RelationshipInfo {
  label: string;
  color: "success" | "warning" | "info";
}

const FRIENDLY_409_MESSAGES: Record<string, string> = {
  "Already friends with this user": "You are already friends with this user.",
  "Friend request already sent": "You have already sent a friend request to this user.",
};

/**
 * The "add a friend" state shared by AddFriendDialog and the inline form on the
 * wide Friends page: the picked user, who you already know (so they can't be
 * picked again), sending the request and its outcome.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAddFriend(enabled: boolean) {
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { mutateAsync: sendFriendRequest, isPending: isSending } = useMutation({
    ...friendsControllerSendFriendRequestMutation(),
    onSuccess: () => {
      invalidateFriendQueries(queryClient);
    },
  });

  const { data: friends = [] } = useQuery({ ...friendsControllerGetFriendsOptions(), enabled });
  const { data: pendingRequests } = useQuery({ ...friendsControllerGetPendingRequestsOptions(), enabled });

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

  const send = async () => {
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
          errorMessage = FRIENDLY_409_MESSAGES[errorObj.message ?? ""] ?? errorObj.message ?? errorMessage;
          // Invalidate caches to refresh relationship data (handles race conditions)
          invalidateFriendQueries(queryClient);
        } else if (errorObj.message) {
          errorMessage = errorObj.message;
        }
      }
      setError(errorMessage);
    }
  };

  const reset = () => {
    setSelectedUser(null);
    setSuccess(false);
    setError(null);
  };

  return { selectedUser, setSelectedUser, relationshipMap, send, isSending, success, setSuccess, error, setError, reset };
}

export type AddFriendState = ReturnType<typeof useAddFriend>;

/** The outcome alerts and the user search of the add-friend form. */
export const AddFriendFields: React.FC<{ state: AddFriendState; autoFocus?: boolean }> = ({ state, autoFocus }) => (
  <>
    {state.success && (
      <Alert severity="success" sx={{ mb: 2 }} onClose={() => state.setSuccess(false)}>
        Friend request sent!
      </Alert>
    )}
    {state.error && (
      <Alert severity="error" sx={{ mb: 2 }} onClose={() => state.setError(null)}>
        {state.error}
      </Alert>
    )}
    <Box sx={{ mb: 2 }}>
      <UserSearchAutocomplete
        value={state.selectedUser}
        onChange={(value) => state.setSelectedUser(value as UserOption | null)}
        label="Search for a user"
        placeholder="Type to search users..."
        // eslint-disable-next-line jsx-a11y/no-autofocus -- only the dialog asks for it: the first field of a dialog the user just opened (WAI-ARIA dialog pattern)
        autoFocus={autoFocus}
        getOptionDisabled={(user) => state.relationshipMap.has(user.id)}
        renderOptionExtra={(user) => {
          const info = state.relationshipMap.get(user.id);
          if (!info) return null;
          return <Chip label={info.label} color={info.color} size="small" />;
        }}
      />
    </Box>
  </>
);

export const SendFriendRequestButton: React.FC<{ state: AddFriendState; fullWidth?: boolean }> = ({
  state,
  fullWidth,
}) => (
  <Button
    onClick={state.send}
    disabled={!state.selectedUser || state.isSending}
    variant="contained"
    fullWidth={fullWidth}
  >
    {state.isSending ? <CircularProgress size={20} /> : "Send Friend Request"}
  </Button>
);

/** Add friend inline (the wide Friends page's side panel), without a dialog. */
const AddFriendForm: React.FC = () => {
  const state = useAddFriend(true);
  return (
    <Box role="group" aria-label="Add friend">
      <AddFriendFields state={state} />
      <SendFriendRequestButton state={state} fullWidth />
    </Box>
  );
};

export default AddFriendForm;
