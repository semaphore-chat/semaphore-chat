/**
 * MobileMessagesPanel Component
 *
 * Shows list of DM conversations.
 * Uses the new screen-based navigation with MobileAppBar.
 */

import React, { useRef, useState } from 'react';
import {
  Box,
  List,
  Fab,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  directMessagesControllerFindUserDmGroupsOptions,
  userControllerGetProfileOptions,
} from '../../../api-client/@tanstack/react-query.gen';

import DmListItem from '../../DirectMessages/DmListItem';
import CreateDmDialog from '../../DirectMessages/CreateDmDialog';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { useVoiceConnection } from '../../../hooks/useVoiceConnection';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { useResponsive } from '../../../hooks/useResponsive';
import { usePullToRefresh } from '../../../hooks/useSwipeGesture';
import { BOTTOM_CHROME_ORDER, useBottomChromeOffset } from '../../../contexts/BottomChromeContext';
import MobileAppBar from '../MobileAppBar';
import ListState, { ListSkeleton } from '../../Common/ListState';
import EmptyState from '../../Common/EmptyState';
import { VoiceSessionType } from '../../../contexts/VoiceContext';

/**
 * Messages panel - Shows list of DM conversations
 * Default screen for the Messages tab
 */
export const MobileMessagesPanel: React.FC = () => {
  const { navigateToDmChat } = useMobileNavigation();
  const { shouldUseTouchUI } = useResponsive();
  const queryClient = useQueryClient();
  const { data: dmGroups = [], isLoading, error, refetch } = useQuery(directMessagesControllerFindUserDmGroupsOptions());
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());
  const { state: voiceState } = useVoiceConnection();
  const { unreadCount, mentionCount } = useReadReceipts();
  // Above the bottom nav and voice bar (whichever are showing), via BottomChromeContext.
  const fabOffset = useBottomChromeOffset(BOTTOM_CHROME_ORDER.FAB);

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Pull-to-refresh: drag down from the top of the DM list to refetch it.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const { onTouchStart, onTouchMove, onTouchEnd, isRefreshing } = usePullToRefresh(
    async () => {
      await queryClient.invalidateQueries({
        queryKey: directMessagesControllerFindUserDmGroupsOptions().queryKey,
      });
    },
    // trackPullDistance off: only isRefreshing is consumed here, and distance
    // updates would re-render the whole DM list on every touchmove.
    { enabled: shouldUseTouchUI, scrollElementRef: listScrollRef, trackPullDistance: false },
  );
  const pullHandlers = shouldUseTouchUI
    ? { onTouchStart, onTouchMove, onTouchEnd }
    : {};

  const handleDmClick = (dmGroupId: string) => {
    navigateToDmChat(dmGroupId);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* App bar */}
      <MobileAppBar title="Messages" />

      {/* DM list — the scroll box stays mounted in every state so
          pull-to-refresh also works from the error and empty states. */}
      <Box
        ref={listScrollRef}
        data-testid="dm-list-scroll"
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 1,
          // Room for the new-DM FAB (56px + 16px gap + 16px) so it never
          // covers the last conversation when scrolled to the end.
          pb: '88px',
          position: 'relative',
        }}
        {...pullHandlers}
      >
        {/* Pull-to-refresh indicator */}
        {isRefreshing && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              py: 1.5,
            }}
          >
            <CircularProgress size={24} />
          </Box>
        )}
        <ListState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          isEmpty={dmGroups.length === 0}
          skeleton={<ListSkeleton rows={9} avatarSize={44} label="Loading conversations" />}
          errorTitle="Couldn't load conversations"
          empty={
            <EmptyState
              variant="dm"
              title="No messages yet"
              description="Start a conversation by tapping the + button."
            />
          }
        >
          <List>
            {dmGroups.map((dmGroup) => (
              <DmListItem
                key={dmGroup.id}
                group={dmGroup}
                currentUserId={currentUser?.id}
                onClick={() => handleDmClick(dmGroup.id)}
                touchFriendly
                isInCall={voiceState.isConnected && voiceState.contextType === VoiceSessionType.Dm && voiceState.currentDmGroupId === dmGroup.id}
                unreadCount={unreadCount(dmGroup.id)}
                mentionCount={mentionCount(dmGroup.id)}
              />
            ))}
          </List>
        </ListState>
      </Box>

      {/* FAB for create DM */}
      <Fab
        color="primary"
        aria-label="start conversation"
        onClick={() => setShowCreateDialog(true)}
        data-chrome-offset={fabOffset.px}
        sx={{
          position: 'fixed',
          bottom: `calc(${fabOffset.css} + 16px)`,
          right: 16,
        }}
      >
        <AddIcon />
      </Fab>

      <CreateDmDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onDmCreated={handleDmClick}
      />
    </Box>
  );
};
