/**
 * TabletSidebar Component
 *
 * Always-visible channel list for tablet split view.
 * Shows the shared community header and channel list.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindAllForCommunityOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { LAYOUT_CONSTANTS } from '../../../utils/breakpoints';
import ChannelCategoryList from '../../Channel/ChannelCategoryList';
import CommunityHeader from '../CommunityHeader';

interface TabletSidebarProps {
  communityId: string;
}

/**
 * Tablet sidebar showing community info and channel list
 */
export const TabletSidebar: React.FC<TabletSidebarProps> = ({ communityId }) => {
  const { state, navigateToChat } = useMobileNavigation();
  const {
    data: channels = [],
    isLoading,
    error,
    refetch,
  } = useQuery(channelsControllerFindAllForCommunityOptions({ path: { communityId } }));

  return (
    <Box
      sx={{
        width: LAYOUT_CONSTANTS.CHANNEL_LIST_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        flexShrink: 0,
      }}
    >
      <CommunityHeader communityId={communityId} />

      {/* Channel list */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          pt: 0.5,
          pb: `${LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE}px`,
        }}
      >
        <ChannelCategoryList
          channels={channels}
          communityId={communityId}
          onChannelSelect={(channelId) => navigateToChat(communityId, channelId)}
          selectedChannelId={state.channelId ?? undefined}
          compact
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
        />
      </Box>
    </Box>
  );
};

export default TabletSidebar;
