/**
 * NotificationList Component
 *
 * Shared notification list body (mark-all button, loading/empty states, list).
 * Used by both the mobile NotificationsScreen and the desktop NotificationsPage.
 * Navigation is handled via react-router, so it works on mobile (URL-derived
 * screen state) and desktop alike.
 */

import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Badge,
  IconButton,
  CircularProgress,
  Button,
  Divider,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Close as DismissIcon,
  AlternateEmail as MentionIcon,
  Chat as DmIcon,
  Tag as ChannelIcon,
} from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notificationsControllerDismissNotificationMutation } from '../../api-client/@tanstack/react-query.gen';

import { AuthenticatedImage } from '../Common/AuthenticatedImage';
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage';
import { TOUCH_TARGETS } from '../../utils/breakpoints';
import { NotificationType, Notification } from '../../types/notification.type';
import { logger } from '../../utils/logger';
import { useNotifications } from '../../hooks/useNotifications';
import { getMessagePreview, getNotificationTypeLabel, getTimeAgo } from '../../utils/notificationHelpers';

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case NotificationType.USER_MENTION:
    case NotificationType.SPECIAL_MENTION:
      return <MentionIcon />;
    case NotificationType.DIRECT_MESSAGE:
      return <DmIcon />;
    case NotificationType.CHANNEL_MESSAGE:
      return <ChannelIcon />;
    default:
      return <MentionIcon />;
  }
};

const NOTIFICATION_AVATAR_SIZE = 44;
const TYPE_BADGE_SIZE = 20;

/**
 * Author avatar with a small notification-type badge. `author.avatarUrl` is a
 * file id, so it goes through the authenticated file cache
 * (AuthenticatedImage). With no avatar, the type icon itself is the avatar.
 */
const NotificationAvatar: React.FC<{ notification: Notification }> = ({ notification }) => {
  const iconAvatar = (
    <Avatar
      sx={{
        bgcolor: notification.read ? 'grey.500' : 'primary.main',
        width: NOTIFICATION_AVATAR_SIZE,
        height: NOTIFICATION_AVATAR_SIZE,
      }}
    >
      {getNotificationIcon(notification.type)}
    </Avatar>
  );

  const avatarFileId = notification.author?.avatarUrl;
  // Shares AuthenticatedImage's cache entry; only used to hide the type badge
  // when the avatar can't be shown and the type icon is already the avatar.
  const { blobUrl } = useAuthenticatedImage(avatarFileId);
  if (!avatarFileId) {
    return iconAvatar;
  }

  return (
    <Badge
      invisible={!blobUrl}
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      badgeContent={
        <Avatar
          sx={{
            width: TYPE_BADGE_SIZE,
            height: TYPE_BADGE_SIZE,
            bgcolor: notification.read ? 'grey.500' : 'primary.main',
            border: 2,
            borderColor: 'background.paper',
            '& .MuiSvgIcon-root': { fontSize: 12 },
          }}
        >
          {getNotificationIcon(notification.type)}
        </Avatar>
      }
    >
      <AuthenticatedImage
        fileId={avatarFileId}
        alt={notification.author?.displayName || notification.author?.username || 'Author'}
        component="avatar"
        fallback={iconAvatar}
        sx={{ width: NOTIFICATION_AVATAR_SIZE, height: NOTIFICATION_AVATAR_SIZE }}
      />
    </Badge>
  );
};

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onClick: (notification: Notification) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkRead,
  onDismiss,
  onClick,
}) => {
  const preview = getMessagePreview(notification);
  const timeAgo = getTimeAgo(notification.createdAt);

  return (
    <ListItem
      disablePadding
      secondaryAction={
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {!notification.read && (
            <IconButton
              edge="end"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification.id);
              }}
              aria-label="Mark as read"
            >
              <CheckIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton
            edge="end"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(notification.id);
            }}
            aria-label="Dismiss"
          >
            <DismissIcon fontSize="small" />
          </IconButton>
        </Box>
      }
    >
      <ListItemButton
        onClick={() => onClick(notification)}
        sx={{
          minHeight: TOUCH_TARGETS.RECOMMENDED,
          pr: 10, // Room for action buttons
          backgroundColor: notification.read ? 'transparent' : 'action.hover',
        }}
      >
        <ListItemAvatar>
          <NotificationAvatar notification={notification} />
        </ListItemAvatar>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                component="span"
                fontWeight={notification.read ? 400 : 600}
                fontSize="0.9375rem"
              >
                {notification.author?.username || 'Someone'}
              </Typography>
              <Typography component="span" variant="body2" color="text.secondary">
                {getNotificationTypeLabel(notification.type as NotificationType)}
              </Typography>
            </Box>
          }
          secondary={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {preview && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {preview}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {timeAgo}
              </Typography>
            </Box>
          }
        />
      </ListItemButton>
    </ListItem>
  );
};

/**
 * Notification list body — mark-all button, loading/empty states, and the list.
 */
export const NotificationList: React.FC = () => {
  const navigate = useNavigate();

  const {
    notifications,
    unreadCount,
    isLoading,
    isMarkingAllRead,
    refetch,
    handleMarkAsRead,
    handleMarkAllAsRead,
    invalidateNotifications,
  } = useNotifications();

  const { mutateAsync: dismissNotification } = useMutation({
    ...notificationsControllerDismissNotificationMutation(),
    onSuccess: () => invalidateNotifications(),
  });

  const handleDismiss = async (notificationId: string) => {
    try {
      await dismissNotification({ path: { id: notificationId } });
    } catch (error) {
      logger.error('Failed to dismiss notification:', error);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }

    if (notification.communityId && notification.channelId) {
      navigate(`/community/${notification.communityId}/channel/${notification.channelId}`);
    } else if (notification.directMessageGroupId) {
      navigate(`/direct-messages/${notification.directMessageGroupId}`);
    }
  };

  return (
    <>
      {/* Mark all as read button */}
      {unreadCount > 0 && (
        <Box sx={{ px: 2, py: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            onClick={handleMarkAllAsRead}
            disabled={isMarkingAllRead}
            startIcon={isMarkingAllRead ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            Mark all as read
          </Button>
        </Box>
      )}

      {unreadCount > 0 && <Divider />}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress />
        </Box>
      ) : notifications.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: 2,
            p: 3,
          }}
        >
          <Box sx={{ fontSize: 64, opacity: 0.5 }}>🔔</Box>
          <Typography variant="h6" color="text.secondary">
            No notifications
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            You'll see mentions, replies, and direct messages here.
          </Typography>
          <Button variant="outlined" onClick={() => refetch()}>
            Refresh
          </Button>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <List disablePadding>
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={handleMarkAsRead}
                onDismiss={handleDismiss}
                onClick={handleNotificationClick}
              />
            ))}
          </List>
        </Box>
      )}
    </>
  );
};

export default NotificationList;
