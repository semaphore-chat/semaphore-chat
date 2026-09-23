/**
 * MobileChannelsPanel Component
 *
 * Shows channels for a selected community on phone.
 * Uses the new screen-based navigation.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindAllForCommunityOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import ChannelCategoryList from '../../Channel/ChannelCategoryList';
import CommunityHeader from '../CommunityHeader';

interface MobileChannelsPanelProps {
  communityId: string;
}

/**
 * Channels panel - Shows channels for a selected community
 * This is the default screen for the Home tab when a community is selected
 */
export const MobileChannelsPanel: React.FC<MobileChannelsPanelProps> = ({
  communityId,
}) => {
  const { navigateToChat } = useMobileNavigation();
  const {
    data: channels = [],
    isLoading,
    error,
    refetch,
  } = useQuery(channelsControllerFindAllForCommunityOptions({ path: { communityId } }));

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CommunityHeader communityId={communityId} />

      {/* Channel list */}
      <Box sx={{ flex: 1, overflowY: 'auto', py: 0.5 }}>
        <ChannelCategoryList
          channels={channels}
          communityId={communityId}
          onChannelSelect={(channelId) => navigateToChat(communityId, channelId)}
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
        />
      </Box>
    </Box>
  );
};
