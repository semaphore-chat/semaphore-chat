import React from "react";
import ResponsiveDialog from "../Common/ResponsiveDialog";
import { DialogContent, DialogActions, Button } from "@mui/material";
import { AddFriendFields, SendFriendRequestButton, useAddFriend } from "./AddFriendForm";

interface AddFriendDialogProps {
  open: boolean;
  onClose: () => void;
}

const AddFriendDialog: React.FC<AddFriendDialogProps> = ({ open, onClose }) => {
  const state = useAddFriend(open);

  const handleClose = () => {
    state.reset();
    onClose();
  };

  return (
    <ResponsiveDialog open={open} onClose={handleClose} maxWidth="sm" fullWidth title="Add Friend">
      <DialogContent>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it) */}
        <AddFriendFields state={state} autoFocus />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <SendFriendRequestButton state={state} />
      </DialogActions>
    </ResponsiveDialog>
  );
};

export default AddFriendDialog;
