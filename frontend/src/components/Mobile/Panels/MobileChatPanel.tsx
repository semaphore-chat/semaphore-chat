/**
 * MobileChatPanel Component
 *
 * Chat view for channels and DMs.
 * Uses the new screen-based navigation with MobileAppBar.
 */

import React, { Suspense, lazy } from 'react';
import {
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  SwipeableDrawer,
  IconButton,
  Typography,
  Badge,
} from '@mui/material';
import {
  People as PeopleIcon,
  Settings as SettingsIcon,
  Close as CloseIcon,
  PushPin as PushPinIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  channelsControllerFindOneOptions,
  directMessagesControllerFindDmGroupOptions,
  moderationControllerGetPinnedMessagesOptions,
} from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { useResponsive } from '../../../hooks/useResponsive';
import { useSwipeGesture } from '../../../hooks/useSwipeGesture';
import { isSwipeExemptTarget } from '../../../utils/swipeExempt';
import { MOBILE_CONSTANTS } from '../../../utils/breakpoints';
import { ChannelType } from '../../../types/channel.type';
import ChannelMessageContainer from '../../Channel/ChannelMessageContainer';
import DirectMessageContainer from '../../DirectMessages/DirectMessageContainer';
import { VoiceChannelJoinButton } from '../../Voice/VoiceChannelJoinButton';
import { useVoiceConnection } from '../../../hooks/useVoiceConnection';
import { ErrorBoundary } from '../../ErrorBoundary';
import MobileAppBar from '../MobileAppBar';
import MemberListContainer from '../../Message/MemberListContainer';
import { PinnedMessagesPanel } from '../../Moderation';
import { VoiceSessionType } from '../../../contexts/VoiceContext';

// VideoTiles pulls in livekit-client runtime enums; lazy-load it so it's
// only fetched once the user is actually connected to this voice channel
// (see PR-11 bundle splitting).
const VideoTiles = lazy(() => import('../../Voice/VideoTiles').then((m) => ({ default: m.VideoTiles })));

interface MobileChatPanelProps {
  communityId?: string;
  channelId?: string;
  dmGroupId?: string;
}

/**
 * Chat panel - Shows messages for a selected channel or DM
 * Detail screen that slides in from the right
 */
export const MobileChatPanel: React.FC<MobileChatPanelProps> = ({
  communityId,
  channelId,
  dmGroupId,
}) => {
  const { goBack } = useMobileNavigation();
  const navigate = useNavigate();
  const { shouldUseTouchUI, isMobile } = useResponsive();
  const { state: voiceState } = useVoiceConnection();

  // Fetch channel or DM data
  const { data: channel } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: channelId || '' } }),
    enabled: !!channelId,
  });
  const { data: dmGroup } = useQuery({
    ...directMessagesControllerFindDmGroupOptions({ path: { id: dmGroupId || '' } }),
    enabled: !!dmGroupId,
  });

  const [menuAnchor, setMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [showMemberDrawer, setShowMemberDrawer] = React.useState(false);
  const [showPinnedDrawer, setShowPinnedDrawer] = React.useState(false);

  // Fetch pinned messages count for badge
  const { data: pinnedMessages = [] } = useQuery({
    ...moderationControllerGetPinnedMessagesOptions({ path: { channelId: channelId || '' } }),
    enabled: !!channelId,
  });

  const isVoiceChannel = channel?.type === ChannelType.VOICE;
  const isConnectedToThisChannel =
    voiceState.isConnected && voiceState.currentChannelId === channelId;

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleShowMembers = () => {
    setShowMemberDrawer(true);
    handleMenuClose();
  };

  // Community that owns this channel (prop takes precedence, fall back to the
  // channel's own communityId). Undefined for DMs.
  const effectiveCommunityId = communityId || channel?.communityId;

  const handleChannelSettings = () => {
    handleMenuClose();
    if (effectiveCommunityId) {
      navigate(`/community/${effectiveCommunityId}/edit`);
    }
  };

  // Swipe navigation on the chat surface (touch UI only):
  //  - Swipe RIGHT on phone → go back (channel chat → channel list,
  //    dm-chat → dm list; both handled by the nav context's goBack()). On
  //    tablet the channel list is already visible in the split-view sidebar
  //    (TabletContentArea), so swipe-right must NOT navigate there.
  //  - Swipe LEFT → open the members drawer (channel chat only). Keeps
  //    working on tablet as well as phone.
  // Gestures starting within the edge back-gesture zone, on exempt content
  // (inputs, code blocks, horizontally scrollable widgets), or that are mostly
  // vertical (scrolling) are ignored. The SwipeableDrawers render in portals, so
  // touches on them never reach this surface.
  const { onTouchStart, onTouchMove, onTouchEnd } = useSwipeGesture({
    enabled: shouldUseTouchUI,
    onSwipeRight: isMobile ? () => goBack() : undefined,
    onSwipeLeft: () => {
      if (channelId) setShowMemberDrawer(true);
    },
    isExempt: isSwipeExemptTarget,
    ignoreEdgeSwipes: true,
    edgeZone: MOBILE_CONSTANTS.EDGE_BACK_GESTURE_ZONE,
    // Require horizontal displacement to clearly dominate vertical so ordinary
    // vertical scrolling never navigates.
    directionRatio: 1.5,
  });
  const swipeHandlers = { onTouchStart, onTouchMove, onTouchEnd };

  // Determine title
  let title = '';
  if (channel) {
    const prefix = channel.type === ChannelType.VOICE ? '🔊 ' : '# ';
    title = `${prefix}${channel.name}`;
  } else if (dmGroup) {
    title = dmGroup.name || 'Direct Message';
  }

  // Render content based on channel type
  const renderContent = () => {
    if (isVoiceChannel) {
      if (isConnectedToThisChannel) {
        return (
          <Box sx={{ height: '100%', width: '100%' }}>
            <ErrorBoundary>
              <Suspense fallback={null}>
                <VideoTiles />
              </Suspense>
            </ErrorBoundary>
          </Box>
        );
      }

      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            px: 3,
            textAlign: 'center',
            gap: 3,
          }}
        >
          <Box sx={{ fontSize: 64 }}>🔊</Box>
          <Box>
            <Box sx={{ fontSize: '1.25rem', fontWeight: 600, mb: 1 }}>
              {channel?.name}
            </Box>
            <Box sx={{ color: 'text.secondary', mb: 3 }}>
              This is a voice channel. Join to start talking!
            </Box>
            {channel && <VoiceChannelJoinButton channel={channel} />}
          </Box>
        </Box>
      );
    }

    // Text channel or DM
    if (dmGroupId) {
      return <DirectMessageContainer dmGroupId={dmGroupId} />;
    }
    const contextId = channelId || '';
    return <ChannelMessageContainer channelId={contextId} communityId={communityId} hideHeader />;
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* App bar with back button */}
      <MobileAppBar
        title={title}
        showBack
        onBack={goBack}
        showMembers={channel?.type === ChannelType.TEXT}
        onMembersClick={handleShowMembers}
        showMore
        onMoreClick={handleMenuOpen}
        actions={
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={handleMenuClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {channelId && (
              <MenuItem onClick={handleShowMembers}>
                <ListItemIcon>
                  <PeopleIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>View Members</ListItemText>
              </MenuItem>
            )}
            {channelId && (
              <MenuItem onClick={() => { setShowPinnedDrawer(true); handleMenuClose(); }}>
                <ListItemIcon>
                  <Badge badgeContent={pinnedMessages.length} color="primary" max={99}>
                    <PushPinIcon fontSize="small" />
                  </Badge>
                </ListItemIcon>
                <ListItemText>Pinned Messages</ListItemText>
              </MenuItem>
            )}
            {effectiveCommunityId && (
              <MenuItem onClick={handleChannelSettings}>
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Community Settings</ListItemText>
              </MenuItem>
            )}
          </Menu>
        }
      />

      {/* Content */}
      <Box
        sx={{ flex: 1, overflow: 'hidden' }}
        {...(shouldUseTouchUI ? swipeHandlers : {})}
      >
        {renderContent()}
      </Box>

      {/* Member drawer - slides in from right */}
      <SwipeableDrawer
        anchor="right"
        open={showMemberDrawer}
        onClose={() => setShowMemberDrawer(false)}
        onOpen={() => setShowMemberDrawer(true)}
        disableSwipeToOpen
        sx={{
          '& .MuiDrawer-paper': {
            width: 280,
            maxWidth: '85vw',
          },
        }}
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
              Members
            </Typography>
            <IconButton
              onClick={() => setShowMemberDrawer(false)}
              size="small"
              aria-label="Close members"
            >
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Member list */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {channelId && channel?.communityId && (
              <MemberListContainer
                contextType={VoiceSessionType.Channel}
                contextId={channelId}
                communityId={channel.communityId}
                isPrivate={channel.isPrivate}
              />
            )}
            {dmGroupId && (
              <MemberListContainer
                contextType={VoiceSessionType.Dm}
                contextId={dmGroupId}
              />
            )}
          </Box>
        </Box>
      </SwipeableDrawer>

      {/* Pinned messages drawer - slides in from right */}
      <SwipeableDrawer
        anchor="right"
        open={showPinnedDrawer}
        onClose={() => setShowPinnedDrawer(false)}
        onOpen={() => setShowPinnedDrawer(true)}
        disableSwipeToOpen
        sx={{
          '& .MuiDrawer-paper': {
            width: 320,
            maxWidth: '90vw',
          },
        }}
      >
        {channelId && channel?.communityId && (
          <PinnedMessagesPanel
            channelId={channelId}
            communityId={channel.communityId}
            onClose={() => setShowPinnedDrawer(false)}
          />
        )}
      </SwipeableDrawer>
    </Box>
  );
};
