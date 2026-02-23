/**
 * MobileMessagesPanel Component
 *
 * Shows list of DM conversations.
 * Uses the new screen-based navigation with MobileAppBar.
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  List,
  Fab,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
  directMessagesControllerFindUserDmGroupsOptions,
  userControllerGetProfileOptions,
} from '../../../api-client/@tanstack/react-query.gen';

import DmListItem from '../../DirectMessages/DmListItem';
import CreateDmDialog from '../../DirectMessages/CreateDmDialog';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { useVoiceConnection } from '../../../hooks/useVoiceConnection';
import { LAYOUT_CONSTANTS } from '../../../utils/breakpoints';
import MobileAppBar from '../MobileAppBar';

/**
 * Messages panel - Shows list of DM conversations
 * Default screen for the Messages tab
 */
export const MobileMessagesPanel: React.FC = () => {
  const { navigateToDmChat } = useMobileNavigation();
  const { data: dmGroups = [], isLoading } = useQuery(directMessagesControllerFindUserDmGroupsOptions());
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());
  const { state: voiceState } = useVoiceConnection();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleDmClick = (dmGroupId: string) => {
    navigateToDmChat(dmGroupId);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* App bar */}
      <MobileAppBar title="Messages" />

      {/* DM list */}
      {isLoading ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
          }}
        >
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: 1,
          }}
        >
          <List>
            {dmGroups.map((dmGroup) => (
              <DmListItem
                key={dmGroup.id}
                group={dmGroup}
                currentUserId={currentUser?.id}
                onClick={() => handleDmClick(dmGroup.id)}
                touchFriendly
                isInCall={voiceState.isConnected && voiceState.contextType === "dm" && voiceState.currentDmGroupId === dmGroup.id}
              />
            ))}
            {dmGroups.length === 0 && (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No messages yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Start a conversation by tapping the + button
                </Typography>
              </Box>
            )}
          </List>
        </Box>
      )}

      {/* FAB for create DM */}
      <Fab
        color="primary"
        aria-label="start conversation"
        onClick={() => setShowCreateDialog(true)}
        sx={{
          position: 'fixed',
          bottom: LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE + 16,
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
