import React from "react";
import {
  Box,
  List,
  CircularProgress,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  directMessagesControllerFindUserDmGroupsOptions,
  userControllerGetProfileOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useReadReceipts } from "../../hooks/useReadReceipts";

import DmListItem from "./DmListItem";
import CreateDmDialog from "./CreateDmDialog";
import EmptyState from "../Common/EmptyState";

interface DirectMessageListProps {
  selectedDmGroupId?: string;
  onSelectDmGroup: (dmGroupId: string) => void;
  showCreateDialog: boolean;
  setShowCreateDialog: (show: boolean) => void;
}

const DirectMessageList: React.FC<DirectMessageListProps> = ({
  selectedDmGroupId,
  onSelectDmGroup,
  showCreateDialog,
  setShowCreateDialog,
}) => {
  const { data: dmGroups = [], isLoading } = useQuery(directMessagesControllerFindUserDmGroupsOptions());
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());
  const { state: voiceState } = useVoiceConnection();
  const { unreadCount, mentionCount } = useReadReceipts();

  if (isLoading) {
    return (
      <Box sx={{ p: 2, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <List>
          {dmGroups.map((dmGroup) => (
            <DmListItem
              key={dmGroup.id}
              group={dmGroup}
              currentUserId={currentUser?.id}
              isSelected={selectedDmGroupId === dmGroup.id}
              onClick={() => onSelectDmGroup(dmGroup.id)}
              isInCall={voiceState.isConnected && voiceState.contextType === "dm" && voiceState.currentDmGroupId === dmGroup.id}
              unreadCount={unreadCount(dmGroup.id)}
              mentionCount={mentionCount(dmGroup.id)}
            />
          ))}
          {dmGroups.length === 0 && (
            <EmptyState
              variant="dm"
              action={{
                label: "Start a conversation",
                onClick: () => setShowCreateDialog(true),
              }}
            />
          )}
        </List>
      </Box>

      <CreateDmDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onDmCreated={onSelectDmGroup}
      />
    </>
  );
};

export default DirectMessageList;
