import React, { useMemo } from "react";
import {
  Box,
  List,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  directMessagesControllerFindUserDmGroupsOptions,
  userControllerGetProfileOptions,
  presenceControllerGetMultipleUserPresenceOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useReadReceipts } from "../../hooks/useReadReceipts";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import { getDmOtherUser } from "../../utils/dmHelpers";

import DmListItem from "./DmListItem";
import CreateDmDialog from "./CreateDmDialog";
import EmptyState from "../Common/EmptyState";
import ListState, { ListSkeleton } from "../Common/ListState";

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
  const { data: dmGroups = [], isLoading, error, refetch } = useQuery(directMessagesControllerFindUserDmGroupsOptions());
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());
  const { state: voiceState } = useVoiceConnection();
  const { unreadCount, mentionCount } = useReadReceipts();

  // Collect unique "other user" IDs from 1:1 DMs for presence query
  const otherUserIds = useMemo(() => {
    if (!currentUser?.id) return [];
    const ids: string[] = [];
    for (const group of dmGroups) {
      if (group.isGroup) continue;
      const otherUser = getDmOtherUser(group, currentUser.id);
      if (otherUser?.id) ids.push(otherUser.id);
    }
    return [...new Set(ids)];
  }, [dmGroups, currentUser?.id]);

  const { data: presenceData } = useQuery({
    ...presenceControllerGetMultipleUserPresenceOptions({ path: { userIds: otherUserIds.join(',') } }),
    enabled: otherUserIds.length > 0,
    staleTime: 60_000,
  });

  return (
    <>
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <ListState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          isEmpty={dmGroups.length === 0}
          skeleton={<ListSkeleton rows={8} label="Loading conversations" />}
          size="compact"
          errorTitle="Couldn't load conversations"
          empty={
            <EmptyState
              variant="dm"
              action={{
                label: "Start a conversation",
                onClick: () => setShowCreateDialog(true),
              }}
            />
          }
        >
          <List>
            {dmGroups.map((dmGroup) => {
              const otherUser = !dmGroup.isGroup ? getDmOtherUser(dmGroup, currentUser?.id) : null;
              const isOnline = otherUser?.id ? presenceData?.presence?.[otherUser.id] ?? false : false;
              return (
                <DmListItem
                  key={dmGroup.id}
                  group={dmGroup}
                  currentUserId={currentUser?.id}
                  isSelected={selectedDmGroupId === dmGroup.id}
                  onClick={() => onSelectDmGroup(dmGroup.id)}
                  isInCall={voiceState.isConnected && voiceState.contextType === VoiceSessionType.Dm && voiceState.currentDmGroupId === dmGroup.id}
                  unreadCount={unreadCount(dmGroup.id)}
                  mentionCount={mentionCount(dmGroup.id)}
                  isOnline={isOnline}
                />
              );
            })}
          </List>
        </ListState>
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
