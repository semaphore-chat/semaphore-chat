/**
 * TabletSidebar Component
 *
 * Always-visible sidebar for the tablet split view: the tablet's navigation
 * (TabletNavHeader — Home, Messages, Notifications, Profile; tablet has no
 * bottom nav), then the shared community header and channel list, or a prompt
 * to pick a community when none is selected.
 */

import React from 'react';
import { Box, Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindAllForCommunityOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from '../../../utils/breakpoints';
import ChannelCategoryList from '../../Channel/ChannelCategoryList';
import CommunityHeader from '../CommunityHeader';
import { TabletNavHeader } from './TabletNavHeader';

interface TabletSidebarProps {
  communityId?: string | null;
}

/**
 * Tablet sidebar: navigation header, then community info and channel list
 */
export const TabletSidebar: React.FC<TabletSidebarProps> = ({ communityId }) => {
  const { state, navigateToChat, openDrawer } = useMobileNavigation();
  const {
    data: channels = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...channelsControllerFindAllForCommunityOptions({ path: { communityId: communityId ?? '' } }),
    enabled: !!communityId,
  });

  return (
    <Box
      data-testid="tablet-sidebar"
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
      <TabletNavHeader />

      {communityId ? (
        <>
          <CommunityHeader communityId={communityId} />

          {/* Channel list */}
          <Box sx={{ flex: 1, overflowY: 'auto', pt: 0.5 }}>
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
        </>
      ) : (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
            textAlign: 'center',
          }}
        >
          <Button
            variant="outlined"
            onClick={openDrawer}
            sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}
          >
            Choose a community
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default TabletSidebar;
