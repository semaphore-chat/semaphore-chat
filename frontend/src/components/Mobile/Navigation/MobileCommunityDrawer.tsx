/**
 * MobileCommunityDrawer Component
 *
 * Swipeable drawer from left edge showing community list.
 * Community picker for mobile.
 */

import React from 'react';
import {
  SwipeableDrawer,
  Badge,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Divider,
  IconButton,
  Skeleton,
} from '@mui/material';
import {
  Add as AddIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useMobileNavigation } from './MobileNavigationContext';
import { useQuery } from '@tanstack/react-query';
import { communityControllerFindAllMineOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { MOBILE_CONSTANTS, TOUCH_TARGETS, MOBILE_ANIMATIONS } from '../../../utils/breakpoints';
import { stringToColor, getCommunityInitials } from '../../../utils/communityHelpers';
import type { Community } from '../../../types/community.type';

// Community list item with authenticated image
const CommunityDrawerItem: React.FC<{
  community: Community;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ community, isSelected, onSelect }) => {
  const { blobUrl: avatarUrl } = useAuthenticatedImage(community.avatar);

  return (
    <ListItem disablePadding>
      <ListItemButton
        selected={isSelected}
        onClick={onSelect}
        sx={{
          minHeight: TOUCH_TARGETS.RECOMMENDED,
          borderRadius: 1,
          mx: 1,
          '&.Mui-selected': {
            backgroundColor: 'action.selected',
            '&:hover': {
              backgroundColor: 'action.selected',
            },
          },
        }}
      >
        <ListItemAvatar>
          <Avatar
            src={avatarUrl || undefined}
            sx={{
              width: 40,
              height: 40,
              bgcolor: !community.avatar ? stringToColor(community.id).bg : undefined,
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {getCommunityInitials(community.name)}
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={community.name}
          secondary={community.description}
          primaryTypographyProps={{
            noWrap: true,
            fontWeight: isSelected ? 600 : 400,
          }}
          secondaryTypographyProps={{
            noWrap: true,
            fontSize: '0.75rem',
          }}
        />
      </ListItemButton>
    </ListItem>
  );
};

// Loading skeleton for community list
const CommunityListSkeleton: React.FC = () => (
  <>
    {[1, 2, 3, 4].map((i) => (
      <ListItem key={i} sx={{ px: 2 }}>
        <ListItemAvatar>
          <Skeleton variant="circular" width={40} height={40} />
        </ListItemAvatar>
        <ListItemText
          primary={<Skeleton width="60%" />}
          secondary={<Skeleton width="40%" />}
        />
      </ListItem>
    ))}
  </>
);

const MobileCommunityDrawer: React.FC = () => {
  const navigate = useNavigate();
  const { state, closeDrawer, navigateToChannels, navigateToDmList } = useMobileNavigation();
  const { data: communities, isLoading } = useQuery(communityControllerFindAllMineOptions());
  const { totalDmUnreadCount: totalDmUnread } = useReadReceipts();

  const handleCommunitySelect = (communityId: string) => {
    navigateToChannels(communityId);
    closeDrawer();
  };

  const handleDmClick = () => {
    navigateToDmList();
    closeDrawer();
  };

  const handleCreateCommunity = () => {
    navigate('/community/create');
    closeDrawer();
  };

  const handleSettings = () => {
    navigate('/settings');
    closeDrawer();
  };

  return (
    <SwipeableDrawer
      anchor="left"
      open={state.isDrawerOpen}
      onClose={closeDrawer}
      onOpen={() => {}} // No-op since we use button to open
      disableSwipeToOpen // Disable edge swipe to avoid Chrome back gesture conflict
      sx={{
        '& .MuiDrawer-paper': {
          width: MOBILE_CONSTANTS.DRAWER_WIDTH,
          maxWidth: MOBILE_CONSTANTS.DRAWER_WIDTH_FULL,
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
        },
      }}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile
      }}
      transitionDuration={MOBILE_ANIMATIONS.SLOW}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          pt: 'env(safe-area-inset-top)',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            px: 2,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            Communities
          </Typography>
          <IconButton onClick={handleSettings} size="small">
            <SettingsIcon />
          </IconButton>
        </Box>

        <Divider />

        {/* Direct Messages shortcut */}
        <List disablePadding sx={{ py: 1 }}>
          <ListItem disablePadding>
            <ListItemButton
              onClick={handleDmClick}
              selected={state.currentScreen === 'dm-list' || state.currentScreen === 'dm-chat'}
              sx={{
                minHeight: TOUCH_TARGETS.RECOMMENDED,
                borderRadius: 1,
                mx: 1,
              }}
            >
              <ListItemAvatar>
                <Badge
                  badgeContent={totalDmUnread}
                  color="error"
                  max={99}
                  overlap="circular"
                >
                  <Avatar sx={{ bgcolor: 'primary.main' }}>
                    <ChatIcon />
                  </Avatar>
                </Badge>
              </ListItemAvatar>
              <ListItemText
                primary="Direct Messages"
                primaryTypographyProps={{ fontWeight: 500 }}
              />
            </ListItemButton>
          </ListItem>
        </List>

        <Divider />

        {/* Community list */}
        <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
          <List disablePadding>
            {isLoading ? (
              <CommunityListSkeleton />
            ) : communities && communities.length > 0 ? (
              communities.map((community) => (
                <CommunityDrawerItem
                  key={community.id}
                  community={community}
                  isSelected={state.communityId === community.id}
                  onSelect={() => handleCommunitySelect(community.id)}
                />
              ))
            ) : (
              <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No communities yet
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Create or join a community to get started
                </Typography>
              </Box>
            )}
          </List>
        </Box>

        <Divider />

        {/* Create community button */}
        <Box sx={{ p: 2, pb: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <ListItemButton
            onClick={handleCreateCommunity}
            sx={{
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              borderStyle: 'dashed',
              justifyContent: 'center',
              gap: 1,
            }}
          >
            <AddIcon color="primary" />
            <Typography color="primary" fontWeight={500}>
              Create Community
            </Typography>
          </ListItemButton>
        </Box>
      </Box>
    </SwipeableDrawer>
  );
};

export default MobileCommunityDrawer;
